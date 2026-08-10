<script lang="ts">
	import { npubEncode } from 'nostr-tools/nip19';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { media, MEDIA_PROVIDERS, providerLabel } from '$lib/stores/media.svelte';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import type { UploadedMedia } from '$lib/media/uploaders';
	import { humanBytes } from '$lib/media/uploaders';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import { shortKey } from '$lib/utils/format';
import { rewriteMentions } from '$lib/utils/nip27';
import StoryRing from './StoryRing.svelte';
import PollComposer from './PollComposer.svelte';

	type MentionCandidate = { pubkey: string; name: string; picture?: string; npub: string };

	let text = $state('');
	let posting = $state(false);
	let uploading = $state(false);
	let attachments = $state<UploadedMedia[]>([]);
	let sensitive = $state(false);

	// Per-post provider selection. Defaults to the configured default and stays
	// valid as the user toggles providers in Settings.
	let selectedProvider = $state<MediaProviderId | 'none'>(media.state.defaultProvider);

	let imageInput = $state<HTMLInputElement | null>(null);
	let videoInput = $state<HTMLInputElement | null>(null);
	let pollOpen = $state(false);
	let composerEl = $state<HTMLElement | undefined>(undefined);
	let expanded = $state(false);
	let providerInitialized = $state(false);
	let mention = $state<{ start: number; query: string } | null>(null);
	let mentionIndex = $state(0);
	type TrackedMention = { name: string; npub: string };
	let mentions = $state<TrackedMention[]>([]);

	function onTextareaFocus() {
		expanded = true;
	}
	function onTextareaBlur(e: FocusEvent) {
		setTimeout(() => (mention = null), 120);
		// Stay expanded while focus moves between controls inside the composer
		// (e.g. tapping Upload / Provider / Post). Collapse only when focus truly
		// leaves and there is nothing drafted.
		const next = e.relatedTarget as Node | null;
		if (next && composerEl && composerEl.contains(next)) return;
		if (!text.trim() && attachments.length === 0) expanded = false;
	}

	const attachMenuId = 'composer-attach-menu';
	const providerMenuId = 'composer-provider-menu';

	const me = $derived(identity.current);
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const SOFT_LIMIT = 4_000;
	const HARD_LIMIT = 16_000;
	const remaining = $derived(HARD_LIMIT - text.length);
	const overSoftLimit = $derived(text.length > SOFT_LIMIT);
	const overHardLimit = $derived(text.length > HARD_LIMIT);
	const countLabel = $derived(
		text.length <= SOFT_LIMIT
			? `${text.length.toLocaleString()} / ${SOFT_LIMIT.toLocaleString()}`
			: `${text.length.toLocaleString()} / ${HARD_LIMIT.toLocaleString()}`
	);

	const candidates = $derived.by(() => {
		const map: Record<string, { pubkey: string; name: string; picture?: string; npub: string }> =
			{};
		for (const pubkey of [...contacts.following, ...Object.keys(profiles.byPubkey)]) {
			if (!pubkey || pubkey === me?.pk || map[pubkey]) continue;
			const profile = profiles.get(pubkey);
			map[pubkey] = {
				pubkey,
				name: profile?.display_name || profile?.name || shortKey(pubkey),
				picture: profile?.picture,
				npub: npubEncode(pubkey)
			};
		}
		return Object.values(map);
	});
	const filteredMentions = $derived.by(() => {
		if (!mention) return [];
		const query = mention.query.toLowerCase().trim();
		return (
			query
				? candidates.filter(
						(c) => c.name.toLowerCase().includes(query) || c.npub.toLowerCase().includes(query)
					)
				: candidates
		).slice(0, 8);
	});

	$effect(() => {
		void filteredMentions.length;
		mentionIndex = 0;
	});

	function textareaElement() {
		return document.getElementById('composer-input') as HTMLTextAreaElement | null;
	}

	function syncMention() {
		const el = textareaElement();
		if (!el) return;
		const before = text.slice(0, el.selectionStart ?? text.length);
		const at = before.lastIndexOf('@');
		if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) {
			mention = null;
			return;
		}
		const query = before.slice(at + 1);
		const nextMention = query.length <= 40 && !/\s/.test(query) ? { start: at, query } : null;
		// Arrow navigation also fires keyup; preserve the same mention state so
		// the reactive result reset does not move the highlight back to the top.
		if (mention?.start !== nextMention?.start || mention?.query !== nextMention?.query) {
			mention = nextMention;
		}
	}

	function selectMention(candidate: (typeof candidates)[number]) {
		if (!mention) return;
		const before = text.slice(0, mention.start);
		const after = text.slice(mention.start + 1 + mention.query.length);
		const insert = `@${candidate.name} `;
		text = before + insert + after;
		mentions = [...mentions, { name: candidate.name, npub: candidate.npub }];
		mention = null;
		const pos = before.length + insert.length;
		queueMicrotask(() => textareaElement()?.setSelectionRange(pos, pos));
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

	// Circular character meter (Twitter-style): fills to the soft limit, then
	// shifts warm → red as the post crosses the soft / hard thresholds.
	const RING_R = 14;
	const RING_C = 2 * Math.PI * RING_R;
	const ringProgress = $derived(Math.min(text.length / SOFT_LIMIT, 1));
	const ringOffset = $derived(RING_C * (1 - ringProgress));
	const ringStroke = $derived(
		overHardLimit
			? 'var(--tone-error-text)'
			: overSoftLimit
				? 'var(--color-warm-500)'
				: 'var(--ui-color-primary-500)'
	);
	const ringTextClass = $derived(
		overHardLimit
			? 'text-[var(--tone-error-text)]'
			: overSoftLimit
				? 'text-warm-500'
				: 'text-primary-500'
	);

	const configuredProviders = $derived(MEDIA_PROVIDERS.filter((p) => media.isConfigured(p.id)));
	const selectedProviderLabel = $derived(
		providerLabel(selectedProvider === 'none' ? 'server' : selectedProvider)
	);
	const canPost = $derived(
		(posting || uploading || overHardLimit || (!text.trim() && attachments.length === 0)) === false
	);

	// Keep the selection valid whenever providers/defaults change.
	$effect(() => {
		const current = selectedProvider;
		const valid = (id: MediaProviderId | 'none') => id === 'none' || media.isConfigured(id);
		if (!providerInitialized) {
			providerInitialized = true;
			const def = media.state.defaultProvider;
			if (def !== 'none' && media.isConfigured(def)) {
				selectedProvider = def;
				return;
			}
		}
		if (valid(current)) {
			return;
		}
		const def = media.state.defaultProvider;
		if (def !== 'none' && media.isConfigured(def)) {
			selectedProvider = def;
			return;
		}
		selectedProvider = configuredProviders[0]?.id ?? 'none';
	});

	$effect(() => {
		if (me) profiles.ensure([me.pk]);
	});

	const mediaActions = [
		{
			icon: 'i-lucide-image',
			label: 'Photo',
			color: 'text-primary-500',
			pick: () => imageInput?.click()
		},
		{
			icon: 'i-lucide-video',
			label: 'Video',
			color: 'text-accent-500',
			pick: () => videoInput?.click()
		}
	];

	const stubActions = [
		{ icon: 'i-lucide-circle-play', label: 'Bits', color: 'text-warm-500', toast: 'Bits creator' },
		{
			icon: 'i-lucide-bar-chart-3',
			label: 'Poll',
			color: 'text-ink',
			onClick: () => (pollOpen = true)
		}
	];

	async function handleFiles(files: FileList | null) {
		if (!files || !files.length) return;
		const provider = selectedProvider;
		uploading = true;
		let ok = 0;
		try {
			for (const file of Array.from(files)) {
				try {
					const uploaded = await media.upload(file, provider === 'none' ? undefined : provider, {
						pubkey: me?.pk,
						purpose: 'note'
					});
					attachments = [...attachments, uploaded];
					ok++;
				} catch (e) {
					toasts.error(`${file.name}: ${(e as Error).message}`);
				}
			}
			if (ok)
				toasts.success(
					`Uploaded ${ok} ${ok === 1 ? 'file' : 'files'} via ${providerLabel(provider === 'none' ? 'server' : provider)}`
				);
		} finally {
			uploading = false;
		}
	}

	function onImageInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		void handleFiles(input.files);
		input.value = '';
	}

	function removeAttachment(idx: number) {
		attachments = attachments.filter((_, i) => i !== idx);
	}

	async function submit() {
		if (!canPost || posting) return;
		posting = true;
		try {
			const allMentions = ensureMentionTracking(text, mentions, candidates);
			await feed.post(rewriteMentions(text, allMentions), { sensitive, attachments });
			text = '';
			mentions = [];
			mention = null;
			attachments = [];
			sensitive = false;
			expanded = false;
			toasts.success('Posted to Nostr');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			posting = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (mention && filteredMentions.length) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				mentionIndex =
					(mentionIndex + (e.key === 'ArrowDown' ? 1 : -1) + filteredMentions.length) %
					filteredMentions.length;
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
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
</script>

{#if me}
	<div
		bind:this={composerEl}
		class="post-card p-4 transition-all duration-200 {expanded
			? 'border-[var(--ui-border)] shadow-[var(--shadow-card-hover)] ring-1 ring-primary-500/15'
			: ''}"
	>
		<div class="flex items-start gap-3">
			<StoryRing pubkey={me.pk} interactive={false}>
				<Avatar pubkey={me.pk} name={displayName} picture={myProfile?.picture} size={40} />
			</StoryRing>
			<div class="relative min-w-0 flex-1">
				<Textarea
					id="composer-input"
					bind:value={text}
					autoGrow
					rows={2}
					placeholder="What's happening on Nostr?"
					onkeydown={onKey}
					onfocus={onTextareaFocus}
					onblur={onTextareaBlur}
					maxlength={HARD_LIMIT + 1000}
					oninput={syncMention}
					onclick={syncMention}
					onkeyup={syncMention}
					class="min-h-[56px] border-transparent bg-transparent px-1 py-1.5 text-[15px] leading-relaxed placeholder:text-[var(--ui-text-dimmed)] focus:border-transparent"
				/>
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
								/>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-[12.5px] font-bold text-[var(--ui-text)]"
										>{candidate.name}</span
									>
									<span class="block truncate font-mono text-[10px] text-[var(--ui-text-dimmed)]"
										>{shortKey(candidate.npub, 10, 6)}</span
									>
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
				{#if overSoftLimit}
					<p
						class="mt-2 flex items-center gap-1.5 text-[11.5px] {overHardLimit
							? 'text-[var(--tone-error-text)]'
							: 'text-warm-500'}"
					>
						<Icon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
						{#if overHardLimit}
							Too long for a normal note — shorten it or save it for a long-form article.
						{:else}
							Long note. Most relays accept it, but shorter posts render best.
						{/if}
					</p>
				{/if}

				<!-- Attachment previews -->
				{#if attachments.length}
					<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
						{#each attachments as a, i (a.url)}
							<div
								class="group relative aspect-square overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]"
							>
								{#if a.kind === 'image'}
									<img
										src={a.url}
										alt=""
										class="size-full object-cover transition duration-300 group-hover:scale-105"
									/>
								{:else if a.kind === 'video'}
									<video src={a.url} class="size-full object-cover" muted></video>
									<div
										class="pointer-events-none absolute inset-0 grid place-items-center bg-black/25"
									>
										<Icon name="i-lucide-play" class="size-7 text-white/90" />
									</div>
								{:else}
									<div class="grid size-full place-items-center p-2 text-center">
										<div>
											<Icon
												name="i-lucide-file"
												class="mx-auto size-6 text-[var(--ui-text-dimmed)]"
											/>
											<p class="mt-1 text-[10px] break-all text-[var(--ui-text-muted)]">
												{humanBytes(a.bytes)}
											</p>
										</div>
									</div>
								{/if}
								<div
									class="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 transition group-hover:opacity-100"
								></div>
								<button
									type="button"
									onclick={() => removeAttachment(i)}
									class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/65 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-black/85 focus:opacity-100"
									aria-label="Remove attachment"
								>
									<Icon name="i-lucide-x" class="size-3.5" />
								</button>
								<span
									class="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white uppercase backdrop-blur"
								>
									{providerLabel(a.provider)}
								</span>
							</div>
						{/each}
					</div>
				{/if}
				{#if uploading}
					<p class="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-primary-500">
						<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
						Uploading via {providerLabel(
							selectedProvider === 'none' ? 'server' : selectedProvider
						)}…
					</p>
				{/if}
			</div>
		</div>

		<!-- Hidden file pickers -->
		<input
			bind:this={imageInput}
			type="file"
			accept="image/*"
			multiple
			class="hidden"
			onchange={onImageInput}
		/>
		<input
			bind:this={videoInput}
			type="file"
			accept="video/*"
			multiple
			class="hidden"
			onchange={onImageInput}
		/>

		<!-- Toolbar -->
		<div
			class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ui-border-muted)] pt-3"
		>
			<div class="flex flex-wrap items-center gap-1">
				{#each mediaActions as a (a.label)}
					<button
						type="button"
						onclick={a.pick}
						disabled={uploading}
						title={`${a.label} · via ${selectedProviderLabel}`}
						aria-label={a.label}
						class="grid size-9 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:pointer-events-none disabled:opacity-40"
					>
						<Icon
							name={uploading ? 'i-lucide-loader-circle' : a.icon}
							class="size-[18px] {uploading ? 'animate-spin text-primary-500' : a.color}"
						/>
					</button>
				{/each}
				<Popover
					id={attachMenuId}
					placement="top-start"
					width="md"
					label="More actions"
					triggerClass="grid size-9 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
					triggerActiveClass="bg-primary-500/10 text-primary-600"
				>
					{#snippet trigger()}
						<Icon name="i-lucide-plus" class="size-[18px] text-primary-500" />
						<span class="sr-only">More</span>
					{/snippet}
					{#each stubActions as a (a.label)}
						<MenuItem
							icon={a.icon}
							onclick={a.onClick ?? (() => toasts.info(a.toast))}
							iconClass={`size-4 shrink-0 ${a.color}`}
						>
							{a.label}
						</MenuItem>
					{/each}
				</Popover>
			</div>

			<div class="flex flex-wrap items-center justify-end gap-1.5">
				<button
					type="button"
					onclick={() => (sensitive = !sensitive)}
					aria-pressed={sensitive}
					title="Mark as sensitive content"
					class="grid size-9 place-items-center rounded-full transition {sensitive
						? 'bg-warm-500/15 text-warm-500'
						: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
				>
					<Icon name="i-lucide-eye-off" class="size-[18px]" />
				</button>
				<Popover
					id={providerMenuId}
					placement="top-end"
					width="lg"
					label="Upload provider"
					triggerClass="flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
					triggerActiveClass="bg-primary-500/10 text-primary-600"
				>
					{#snippet trigger()}
						<Icon name="i-lucide-cloud-upload" class="size-[15px] text-primary-500" />
						<span class="hidden max-w-[120px] truncate sm:inline">{selectedProviderLabel}</span>
					{/snippet}

					<MenuItem
						icon="i-lucide-hard-drive-upload"
						onclick={() => (selectedProvider = 'none')}
						tone={selectedProvider === 'none' ? 'accent' : 'default'}
					>
						BitOS uploads
						{#snippet trailing()}
							{#if selectedProvider === 'none'}
								<Icon name="i-lucide-check" class="size-4 shrink-0" />
							{/if}
						{/snippet}
					</MenuItem>
					<MenuDivider />
					{#each MEDIA_PROVIDERS as provider (provider.id)}
						<MenuItem
							icon={provider.icon}
							disabled={!media.isConfigured(provider.id)}
							tone={selectedProvider === provider.id ? 'accent' : 'default'}
							onclick={() => (selectedProvider = provider.id)}
						>
							<div class="min-w-0">
								<div>{provider.label}</div>
								<div class="text-[11px] font-medium text-[var(--ui-text-dimmed)]">
									{media.isConfigured(provider.id)
										? provider.description
										: 'Configure this provider in Settings first'}
								</div>
							</div>
							{#snippet trailing()}
								{#if selectedProvider === provider.id}
									<Icon name="i-lucide-check" class="size-4 shrink-0" />
								{/if}
							{/snippet}
						</MenuItem>
					{/each}
				</Popover>

				{#if expanded && text.length > 0}
					<div class="relative grid size-9 shrink-0 place-items-center" title={countLabel}>
						<svg class="size-9 -rotate-90" viewBox="0 0 36 36" fill="none" aria-hidden="true">
							<circle
								cx="18"
								cy="18"
								r={RING_R}
								stroke="var(--ui-border-accented)"
								stroke-width="3"
							/>
							<circle
								cx="18"
								cy="18"
								r={RING_R}
								stroke={ringStroke}
								stroke-width="3"
								stroke-linecap="round"
								stroke-dasharray={RING_C}
								stroke-dashoffset={ringOffset}
								class="transition-[stroke-dashoffset] duration-300 ease-out"
							/>
						</svg>
						{#if remaining <= 999}
							<span class="absolute text-[10px] font-bold tabular-nums {ringTextClass}"
								>{remaining}</span
							>
						{/if}
					</div>
				{/if}
				<button
					type="button"
					onclick={submit}
					disabled={!canPost}
					class="flex items-center gap-1.5 rounded-full bg-primary-500 px-5 py-2 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition-all hover:bg-primary-600 hover:shadow-[0_4px_18px_rgba(47,149,246,0.35)] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
				>
					<Icon
						name={posting ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
						class="size-4 {posting ? 'animate-spin' : ''}"
					/>
					{posting ? 'Posting…' : 'Post'}
				</button>
			</div>
		</div>
	</div>
{/if}

<PollComposer bind:open={pollOpen} />
