<script module lang="ts">
	/** Quick emoji palette for the reply toolbar. */
	export const REPLY_EMOJIS = [
		'😀',
		'😂',
		'🤣',
		'😊',
		'😍',
		'🥰',
		'😘',
		'😎',
		'🤔',
		'🥳',
		'😴',
		'🤯',
		'🥺',
		'😭',
		'😢',
		'😡',
		'👍',
		'👎',
		'👏',
		'🙌',
		'🙏',
		'💪',
		'🫂',
		'👀',
		'❤️',
		'🔥',
		'✨',
		'⚡',
		'🎉',
		'💯',
		'💩',
		'🐮'
	];
</script>

<script lang="ts">
	/**
	 * Rich reply composer used under feed notes (and for nested comment replies).
	 *
	 * Brings the main Composer's affordances into threaded replies:
	 *  - multiline auto-grow textarea (⌘/Ctrl+Enter to post, Esc to cancel)
	 *  - @mention autocomplete (NIP-27 `nostr:npub1…` inserted + p-tag added)
	 *  - image / video upload via the configured media provider
	 *  - GIF picker (Giphy) embedded as a content URL
	 *  - quick emoji palette
	 *  - attachment previews with remove
	 *  - circular character meter
	 *
	 * Submitting calls `feed.reply(parent, text, { attachments })`.
	 */
	import { onMount, untrack } from 'svelte';
	import { npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import GifPicker from './GifPicker.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { media, providerLabel } from '$lib/stores/media.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { rewriteMentions } from '$lib/utils/nip27';
	import { shortKey } from '$lib/utils/format';
	import type { FeedNote } from '$lib/nostr/types';
	import type { UploadedMedia } from '$lib/media/uploaders';

	type MentionCandidate = {
		pubkey: string;
		name: string;
		picture?: string;
		npub: string;
	};
	type Attachment = Pick<UploadedMedia, 'url' | 'kind' | 'mimeType' | 'bytes'> & {
		source?: string;
	};

	let {
		parent,
		placeholder = 'Write a reply…',
		autofocus = false,
		focusTick = 0,
		initialMention,
		onSubmitted,
		onCancel
	}: {
		parent: FeedNote;
		placeholder?: string;
		autofocus?: boolean;
		/** Bump this number to programmatically focus the textarea. */
		focusTick?: number;
		/** Pre-fill the editor with an @mention (e.g. when replying to a comment). */
		initialMention?: { pubkey: string; name: string };
		onSubmitted?: () => void;
		onCancel?: () => void;
	} = $props();

	const instanceId = 'rc-' + Math.random().toString(36).slice(2, 8);
	const emojiMenuId = `${instanceId}-emoji`;
	const gifMenuId = `${instanceId}-gif`;

	const SOFT_LIMIT = 280;
	const HARD_LIMIT = 16_000;

	let text = $state('');
	let attachments = $state<Attachment[]>([]);
	let posting = $state(false);
	let uploading = $state(false);
	let textareaEl = $state<HTMLTextAreaElement | undefined>(undefined);
	let imageInput = $state<HTMLInputElement | null>(null);
	let videoInput = $state<HTMLInputElement | null>(null);

	// Mention autocomplete state.
	let mention = $state<{ start: number; query: string } | null>(null);
	let mentionIndex = $state(0);
	/** @-mentions picked from autocomplete, rewritten to nostr:npub on submit. */
	type TrackedMention = { name: string; npub: string };
	let mentions = $state<TrackedMention[]>([]);

	let lastFocusTick = untrack(() => focusTick);

	const me = $derived(identity.current);
	const canComment = $derived(
		!!me && !posting && !uploading && privacyNotificationSettings.canCommentOn(parent.pubkey)
	);
	const overSoft = $derived(text.length > SOFT_LIMIT);
	const overHard = $derived(text.length > HARD_LIMIT);
	const canPost = $derived(
		canComment && !overHard && (text.trim().length > 0 || attachments.length > 0)
	);

	// Circular character meter.
	const RING_R = 12;
	const RING_C = 2 * Math.PI * RING_R;
	const ringProgress = $derived(Math.min(text.length / SOFT_LIMIT, 1));
	const ringOffset = $derived(RING_C * (1 - ringProgress));
	const ringStroke = $derived(
		overHard
			? 'var(--tone-error-text)'
			: overSoft
				? 'var(--color-warm-500)'
				: 'var(--ui-color-primary-500)'
	);
	const remaining = $derived(HARD_LIMIT - text.length);

	const providerLabelValue = $derived(providerLabel(media.state.defaultProvider));

	/** Searchable people: note participants first, then follows, then cached. */
	const candidates = $derived.by<MentionCandidate[]>(() => {
		const map: Record<string, MentionCandidate> = {};
		const add = (pubkey: string) => {
			if (!pubkey || pubkey === me?.pk || map[pubkey]) return;
			const profile = profiles.get(pubkey);
			map[pubkey] = {
				pubkey,
				name: profile?.display_name || profile?.name || shortKey(pubkey),
				picture: profile?.picture,
				npub: npubEncode(pubkey)
			};
		};
		add(parent.pubkey);
		for (const tag of parent.tags) if (tag[0] === 'p' && tag[1]) add(tag[1]);
		for (const pubkey of contacts.following) add(pubkey);
		for (const pubkey of Object.keys(profiles.byPubkey)) add(pubkey);
		return Object.values(map);
	});

	const filteredMentions = $derived.by(() => {
		if (!mention) return [];
		const q = mention.query.toLowerCase().trim();
		const list = q
			? candidates.filter(
					(c) => c.name.toLowerCase().includes(q) || c.npub.toLowerCase().includes(q)
				)
			: candidates;
		return list.slice(0, 8);
	});

	$effect(() => {
		// Reset the highlighted row whenever the result set changes.
		void filteredMentions.length;
		mentionIndex = 0;
	});

	$effect(() => {
		// Keep profiles fresh for everyone we might mention.
		if (me) profiles.ensure([me.pk, ...contacts.following]);
	});

	$effect(() => {
		if (focusTick !== lastFocusTick) {
			lastFocusTick = focusTick;
			textareaEl?.focus();
		}
	});

	onMount(() => {
		// Pre-fill an @mention when replying to a specific comment (e.g. tapping
		// "Reply" on someone's comment). Tracked so it serializes to nostr:npub.
		if (initialMention) {
			text = `@${initialMention.name} `;
			mentions = [{ name: initialMention.name, npub: npubEncode(initialMention.pubkey) }];
		}
		if (autofocus) setTimeout(() => textareaEl?.focus(), 0);
	});

	function syncMention() {
		const el = textareaEl;
		if (!el) return;
		const pos = el.selectionStart ?? text.length;
		const before = text.slice(0, pos);
		const at = before.lastIndexOf('@');
		if (at < 0) {
			mention = null;
			return;
		}
		if (at > 0 && !/\s/.test(before[at - 1])) {
			mention = null;
			return;
		}
		const query = before.slice(at + 1);
		if (query.length > 40 || /\s/.test(query)) {
			mention = null;
			return;
		}
		// Keyboard navigation also fires `keyup`; avoid replacing an unchanged
		// mention state there, which would reset the highlighted candidate.
		if (mention?.start !== at || mention.query !== query) {
			mention = { start: at, query };
		}
	}

	function selectMention(candidate: MentionCandidate) {
		if (!mention) return;
		const before = text.slice(0, mention.start);
		const after = text.slice(mention.start + 1 + mention.query.length);
		// Insert a readable `@name` chip in the editor; on submit we rewrite it
		// back to `nostr:npub1…` so the note stays NIP-27-compliant.
		const insert = `@${candidate.name} `;
		text = before + insert + after;
		mentions = [...mentions, { name: candidate.name, npub: candidate.npub }];
		mention = null;
		const pos = before.length + insert.length;
		queueMicrotask(() => {
			textareaEl?.focus();
			textareaEl?.setSelectionRange(pos, pos);
		});
	}

	function escapeRegExp(value: string) {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function mentionTokenRegex(name: string) {
		return new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=$|\\s|[^\\p{L}\\p{N}_-])`, 'iu');
	}

	function ensureMentionTracking(
		content: string,
		tracked: TrackedMention[],
		candidatesList: MentionCandidate[]
	): TrackedMention[] {
		const map = new Map(tracked.map((m) => [m.name, m]));
		for (const candidate of candidatesList) {
			if (map.has(candidate.name)) continue;
			if (mentionTokenRegex(candidate.name).test(content)) {
				map.set(candidate.name, { name: candidate.name, npub: candidate.npub });
			}
		}
		return [...map.values()];
	}

	function insertAtCursor(value: string) {
		const el = textareaEl;
		if (!el) {
			text += value;
			return;
		}
		const start = el.selectionStart ?? text.length;
		const end = el.selectionEnd ?? text.length;
		text = text.slice(0, start) + value + text.slice(end);
		const pos = start + value.length;
		queueMicrotask(() => {
			textareaEl?.focus();
			textareaEl?.setSelectionRange(pos, pos);
		});
	}

	function onKey(e: KeyboardEvent) {
		if (mention && filteredMentions.length) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				mentionIndex = (mentionIndex + 1) % filteredMentions.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				mentionIndex = (mentionIndex - 1 + filteredMentions.length) % filteredMentions.length;
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				selectMention(filteredMentions[mentionIndex]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				mention = null;
				return;
			}
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
			return;
		}
		// Enter (no modifier) sends; Shift+Enter inserts a new line.
		if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
			e.preventDefault();
			void submit();
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submit();
		}
	}

	async function handleFiles(files: FileList | null) {
		if (!files || !files.length || !me) return;
		uploading = true;
		let ok = 0;
		try {
			for (const file of Array.from(files)) {
				try {
					const uploaded = await media.upload(file, undefined, {
						pubkey: me.pk,
						purpose: 'note'
					});
					attachments = [
						...attachments,
						{
							url: uploaded.url,
							kind: uploaded.kind,
							mimeType: uploaded.mimeType,
							bytes: uploaded.bytes,
							source: 'upload'
						}
					];
					ok++;
				} catch (e) {
					toasts.error(`${file.name}: ${(e as Error).message}`);
				}
			}
			if (ok) toasts.success(`Uploaded ${ok} ${ok === 1 ? 'file' : 'files'}`);
		} finally {
			uploading = false;
		}
	}

	function onFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		void handleFiles(input.files);
		input.value = '';
	}

	function pickGif(gif: { url: string; preview: string }) {
		attachments = [
			...attachments,
			{ url: gif.url, kind: 'image', mimeType: 'image/gif', bytes: 0, source: 'gif' }
		];
	}

	function removeAttachment(index: number) {
		attachments = attachments.filter((_, i) => i !== index);
	}

	function reset() {
		text = '';
		attachments = [];
		mention = null;
		mentions = [];
	}

	function cancel() {
		reset();
		onCancel?.();
	}

	async function submit() {
		if (!canPost || posting || !me) return;
		posting = true;
		try {
			const allMentions = ensureMentionTracking(text, mentions, candidates);
			const body = rewriteMentions(text, allMentions);
			await feed.reply(parent, body, {
				attachments: attachments.map((a) => ({
					url: a.url,
					kind: a.kind,
					mimeType: a.mimeType,
					bytes: a.bytes
				}))
			});
			reset();
			onSubmitted?.();
			toasts.success('Reply posted');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			posting = false;
		}
	}
</script>

<div class="flex items-start gap-2">
	{#if me}
		<Avatar
			pubkey={me.pk}
			name={me.profile?.display_name || me.profile?.name || 'You'}
			picture={me.profile?.picture}
			size={28}
			class="mt-0.5 shrink-0"
		/>
	{/if}

	<div class="relative min-w-0 flex-1">
		<textarea
			bind:this={textareaEl}
			bind:value={text}
			rows="1"
			placeholder={me ? placeholder : 'Create or import a key to reply'}
			disabled={!me || posting}
			onkeydown={onKey}
			oninput={syncMention}
			onclick={syncMention}
			onkeyup={syncMention}
			onblur={() => setTimeout(() => (mention = null), 120)}
			class="max-h-40 min-h-[36px] w-full resize-none rounded-2xl bg-[var(--ui-bg-muted)] px-3.5 py-2 text-[13px] leading-relaxed text-[var(--ui-text)] transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60"
		></textarea>

		<!-- @mention dropdown -->
		{#if mention && filteredMentions.length}
			<div
				class="absolute bottom-full left-0 z-40 mb-1 w-64 max-w-full overflow-hidden rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] shadow-[var(--shadow-pop)]"
				role="listbox"
			>
				{#each filteredMentions as candidate, i (candidate.pubkey)}
					<button
						type="button"
						onpointerdown={(event) => {
							event.preventDefault();
							selectMention(candidate);
						}}
						onclick={() => selectMention(candidate)}
						onmouseenter={() => (mentionIndex = i)}
						class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors {i ===
						mentionIndex
							? 'bg-[var(--interactive-hover-bg)]'
							: ''}"
						role="option"
						aria-selected={i === mentionIndex}
					>
						<Avatar
							pubkey={candidate.pubkey}
							name={candidate.name}
							picture={candidate.picture}
							size={22}
							class="shrink-0"
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[12.5px] font-bold text-[var(--ui-text)]">
								{candidate.name}
							</span>
							<span class="block truncate font-mono text-[10px] text-[var(--ui-text-dimmed)]">
								{shortKey(candidate.npub, 10, 6)}
							</span>
						</span>
						{#if i === mentionIndex}
							<Icon
								name="i-lucide-corner-down-left"
								class="size-3.5 text-[var(--ui-text-dimmed)]"
							/>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Attachment previews -->
		{#if attachments.length}
			<div class="mt-2 flex flex-wrap gap-2">
				{#each attachments as attachment, i (`${attachment.url}-${i}`)}
					<div
						class="group relative size-16 overflow-hidden rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]"
					>
						{#if attachment.kind === 'image'}
							<img src={attachment.url} alt="" class="size-full object-cover" />
						{:else if attachment.kind === 'video'}
							<video src={attachment.url} class="size-full object-cover" muted></video>
							<div class="pointer-events-none absolute inset-0 grid place-items-center bg-black/25">
								<Icon name="i-lucide-play" class="size-5 text-white/90" />
							</div>
						{:else}
							<div class="grid size-full place-items-center text-[var(--ui-text-dimmed)]">
								<Icon name="i-lucide-file" class="size-5" />
							</div>
						{/if}
						{#if attachment.source === 'gif'}
							<span
								class="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 text-[8px] font-bold tracking-wide text-white uppercase"
								>GIF</span
							>
						{/if}
						<button
							type="button"
							onclick={() => removeAttachment(i)}
							class="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-black/65 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-black/85"
							aria-label="Remove attachment"
						>
							<Icon name="i-lucide-x" class="size-3" />
						</button>
					</div>
				{/each}
			</div>
		{/if}

		{#if uploading}
			<p class="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary-500">
				<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
				Uploading…
			</p>
		{/if}

		<!-- Toolbar -->
		<div class="mt-2 flex items-center justify-between gap-1.5">
			<div class="flex items-center gap-0.5">
				<button
					type="button"
					onclick={() => imageInput?.click()}
					disabled={!me || uploading}
					title="Photo"
					aria-label="Add photo"
					class="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-primary-500 disabled:opacity-40"
				>
					<Icon
						name={uploading ? 'i-lucide-loader-circle' : 'i-lucide-image'}
						class="size-[17px] {uploading ? 'animate-spin' : ''}"
					/>
				</button>
				<button
					type="button"
					onclick={() => videoInput?.click()}
					disabled={!me || uploading}
					title="Video"
					aria-label="Add video"
					class="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-accent-500 disabled:opacity-40"
				>
					<Icon name="i-lucide-video" class="size-[17px]" />
				</button>

				<Popover
					id={gifMenuId}
					placement="top-start"
					width="auto"
					class="w-72 max-w-[80vw] p-0 sm:w-80"
					label="Pick a GIF"
					triggerClass="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-warm-500"
					triggerActiveClass="bg-primary-500/10 text-primary-600"
				>
					{#snippet trigger()}
						<Icon name="i-lucide-film" class="size-[17px]" />
						<span class="sr-only">GIF</span>
					{/snippet}
					<GifPicker
						onpick={(gif) => {
							pickGif(gif);
						}}
					/>
				</Popover>

				<Popover
					id={emojiMenuId}
					placement="top-start"
					width="auto"
					class="w-60 p-1"
					label="Add emoji"
					triggerClass="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-ink"
					triggerActiveClass="bg-primary-500/10 text-primary-600"
				>
					{#snippet trigger()}
						<Icon name="i-lucide-smile" class="size-[17px]" />
						<span class="sr-only">Emoji</span>
					{/snippet}
					<div class="grid grid-cols-8 gap-0.5">
						{#each REPLY_EMOJIS as emoji (emoji)}
							<button
								type="button"
								onclick={() => {
									insertAtCursor(emoji);
								}}
								class="grid size-7 place-items-center rounded-md text-[16px] transition hover:bg-[var(--interactive-hover-bg)]"
							>
								{emoji}
							</button>
						{/each}
					</div>
				</Popover>

				<span
					class="ml-1 hidden items-center gap-1 text-[10px] text-[var(--ui-text-dimmed)] sm:inline-flex"
				>
					<Icon name="i-lucide-cloud-upload" class="size-3" />
					{providerLabelValue}
				</span>
			</div>

			<div class="flex items-center gap-1.5">
				{#if text.length > 0}
					<div
						class="relative grid size-7 place-items-center"
						title={`${text.length.toLocaleString()} characters`}
					>
						<svg class="size-7 -rotate-90" viewBox="0 0 28 28" fill="none" aria-hidden="true">
							<circle
								cx="14"
								cy="14"
								r={RING_R}
								stroke="var(--ui-border-accented)"
								stroke-width="2.5"
							/>
							<circle
								cx="14"
								cy="14"
								r={RING_R}
								stroke={ringStroke}
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-dasharray={RING_C}
								stroke-dashoffset={ringOffset}
								class="transition-[stroke-dashoffset] duration-300 ease-out"
							/>
						</svg>
						{#if remaining <= 999}
							<span
								class="absolute text-[9px] font-bold tabular-nums {overHard
									? 'text-[var(--tone-error-text)]'
									: overSoft
										? 'text-warm-500'
										: 'text-primary-500'}">{remaining}</span
							>
						{/if}
					</div>
				{/if}
				<button
					type="button"
					onclick={() => void submit()}
					disabled={!canPost}
					class="grid size-8 shrink-0 place-items-center rounded-full bg-primary-500 text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-40"
					aria-label="Post reply"
					title="Enter to send · Shift+Enter for new line"
				>
					<Icon
						name={posting ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
						class="size-4 {posting ? 'animate-spin' : ''}"
					/>
				</button>
			</div>
		</div>
	</div>

	<input
		bind:this={imageInput}
		type="file"
		accept="image/*"
		multiple
		class="hidden"
		onchange={onFileInput}
	/>
	<input
		bind:this={videoInput}
		type="file"
		accept="video/*"
		multiple
		class="hidden"
		onchange={onFileInput}
	/>
</div>
