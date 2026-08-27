<script lang="ts">
	import { npubEncode } from 'nostr-tools/nip19';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { shortKey } from '$lib/utils/format';
	import {
		detectMentionTrigger,
		ensureMentionTracking,
		filterMentionCandidates,
		type MentionCandidate,
		type TrackedMention
	} from '$lib/utils/mentions';

	let {
		value = $bindable(''),
		busy,
		softLimit = 300,
		hardLimit = 1000,
		placeholder = 'Write a caption… #hashtags and @mentions work',
		/** Tracked @mentions — rewrite to nostr: entities at publish time. */
		mentions = $bindable<TrackedMention[]>([]),
		/** ⌘/Ctrl+Enter submit shortcut (same as the feed Composer). */
		onSubmit
	}: {
		value: string;
		busy: boolean;
		softLimit?: number;
		hardLimit?: number;
		placeholder?: string;
		mentions?: TrackedMention[];
		onSubmit?: () => void;
	} = $props();

	let el = $state<HTMLTextAreaElement | null>(null);
	let mentionPanel = $state<HTMLDivElement | null>(null);
	let mention = $state<{ start: number; query: string } | null>(null);
	let mentionIndex = $state(0);
	let mentionPanelPosition = $state<{ top: number; left: number } | null>(null);
	// Unique per instance — several caption composers can be mounted at once.
	const listboxId = `caption-mention-${Math.random().toString(36).slice(2, 8)}`;

	const overSoftLimit = $derived(value.length > softLimit);
	const me = $derived(identity.current);

	/** Mention candidates: follows first, then any cached profile (same pool
	 * as the feed Composer so both surfaces suggest identical people). */
	const candidates = $derived.by(() => {
		const map: Record<string, MentionCandidate> = {};
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
	const filteredMentions = $derived.by(() =>
		mention ? filterMentionCandidates(candidates, mention.query) : []
	);

	$effect(() => {
		void filteredMentions.length;
		mentionIndex = 0;
	});

	// Keep tracked mentions in sync with edits (covers paste / manual typing of
	// a known @name — same guarantee the Composer gets at submit time).
	$effect(() => {
		const next = ensureMentionTracking(value, mentions, candidates);
		if (
			next.length !== mentions.length ||
			next.some((m, i) => m.name !== mentions[i]?.name || m.npub !== mentions[i]?.npub)
		) {
			mentions = next;
		}
	});

	function syncMention() {
		if (!el) return;
		const nextMention = detectMentionTrigger(value, el.selectionStart ?? value.length);
		// Arrow navigation also fires keyup; preserve the same mention state so
		// the reactive result reset does not move the highlight back to the top.
		if (mention?.start !== nextMention?.start || mention?.query !== nextMention?.query) {
			mention = nextMention;
		}
	}

	function selectMention(candidate: MentionCandidate) {
		if (!mention) return;
		const before = value.slice(0, mention.start);
		const after = value.slice(mention.start + 1 + mention.query.length);
		const insert = `@${candidate.name} `;
		value = before + insert + after;
		mentions = [...mentions, { name: candidate.name, npub: candidate.npub }];
		mention = null;
		const pos = before.length + insert.length;
		queueMicrotask(() => el?.setSelectionRange(pos, pos));
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
				selectMention(filteredMentions[mentionIndex]!);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				// Keep the escape scoped to the mention popup — do not let it bubble to
				// a host dialog's window listener (which would close the whole dialog).
				e.stopPropagation();
				mention = null;
				return;
			}
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			onSubmit?.();
		}
	}

	function onBlur() {
		// Keep the popup dismissible-by-blur while pointer selection still lands.
		setTimeout(() => (mention = null), 120);
	}

	/**
	 * The public-publishing dialog deliberately clips its scrolling content.
	 * Move this popup out to body so it can escape that clipping/stacking context;
	 * a local z-index cannot do either. It stays anchored as the dialog scrolls.
	 */
	function portalToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	$effect(() => {
		if (!mention || !filteredMentions.length || !el || !mentionPanel) return;

		const measure = () => {
			const anchor = el!.getBoundingClientRect();
			const panel = mentionPanel!;
			const width = panel.offsetWidth || 256;
			const height = panel.offsetHeight || 32;
			const gap = 4;
			const opensAbove = anchor.top >= height + gap + 8;
			const top = opensAbove ? anchor.top - height - gap : anchor.bottom + gap;
			mentionPanelPosition = {
				top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - height - 8)),
				left: Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - width - 8))
			};
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(mentionPanel);
		window.addEventListener('resize', measure);
		// Capture sees scroll events from the dialog's internal scroll pane too.
		window.addEventListener('scroll', measure, true);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
	});
</script>

<div
	class="relative rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-3 transition focus-within:border-warm-500 focus-within:bg-[var(--ui-bg)] focus-within:ring-2 focus-within:ring-warm-500/20"
>
	<textarea
		bind:this={el}
		bind:value
		rows="2"
		maxlength={hardLimit}
		{placeholder}
		aria-label="Meme caption"
		readonly={busy}
		oninput={syncMention}
		onclick={syncMention}
		onkeyup={syncMention}
		onkeydown={onKey}
		onblur={onBlur}
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={mention && filteredMentions.length ? 'true' : 'false'}
		aria-controls={listboxId}
		aria-activedescendant={mention && filteredMentions.length
			? `${listboxId}-option-${mentionIndex}`
			: undefined}
		class="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)]"
	></textarea>
	{#if mention && filteredMentions.length}
		<div
			bind:this={mentionPanel}
			use:portalToBody
			id={listboxId}
			class="fixed z-[110] max-h-[min(18rem,calc(100vh-1rem))] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] shadow-[var(--shadow-pop)]"
			style={mentionPanelPosition
				? `top:${mentionPanelPosition.top}px; left:${mentionPanelPosition.left}px;`
				: 'visibility:hidden;'}
			role="listbox"
			aria-label="Mention suggestions"
		>
			{#each filteredMentions as candidate, i (candidate.pubkey)}
				<button
					type="button"
					id="{listboxId}-option-{i}"
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
						<Icon name="i-lucide-corner-down-left" class="size-3.5 text-[var(--ui-text-dimmed)]" />
					{/if}
				</button>
			{/each}
		</div>
	{/if}
	{#if value.length > softLimit - 50}
		<p
			class="text-right text-[10.5px] font-bold tabular-nums {value.length > hardLimit
				? 'text-[var(--tone-error-text)]'
				: overSoftLimit
					? 'text-warm-500'
					: 'text-[var(--ui-text-dimmed)]'}"
		>
			{value.length} / {overSoftLimit ? hardLimit : softLimit}
		</p>
	{/if}
</div>
