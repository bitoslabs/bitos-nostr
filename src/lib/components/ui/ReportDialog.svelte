<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { reportTarget, REPORT_REASONS } from '$lib/nostr/reports';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { cn } from '$lib/utils/cn';
	import { shortKey } from '$lib/utils/format';

	/**
	 * NIP-56 report dialog — reason radios + optional public comment, then a
	 * kind 1984 event is published to the user's relays. Opened from the post
	 * card / story overflow menus.
	 */
	let {
		open = $bindable(false),
		pubkey,
		noteId,
		targetLabel
	}: {
		open?: boolean;
		/** Reported author's pubkey. */
		pubkey: string;
		/** Reported note id, when the report targets a specific note. */
		noteId?: string;
		/** Short human label shown in the header (e.g. @name or a note excerpt). */
		targetLabel?: string;
	} = $props();

	let reason = $state('spam');
	let comment = $state('');
	let submitting = $state(false);

	const signedIn = $derived(!!identity.current);

	function close() {
		open = false;
		reason = 'spam';
		comment = '';
		submitting = false;
	}

	async function submit() {
		if (submitting || !signedIn) return;
		submitting = true;
		try {
			await reportTarget({ pubkey, noteId, reason, comment });
			toasts.success('Report sent to your relays');
			close();
		} catch (e) {
			toasts.error((e as Error).message || 'Could not send report');
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog bind:open title="Report {noteId ? 'note' : 'account'}">
	<div class="space-y-4">
		{#if targetLabel}
			<p class="truncate text-[13px] font-semibold text-[var(--ui-text-muted)]">
				{targetLabel}
			</p>
		{/if}

		<fieldset class="space-y-1.5" role="radiogroup" aria-label="Report reason">
			{#each REPORT_REASONS as r (r.id)}
				<label
					class={cn(
						'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition',
						reason === r.id
							? 'border-[color-mix(in_oklab,var(--tone-error-text)_45%,transparent)] bg-[color-mix(in_oklab,var(--tone-error-text)_8%,transparent)]'
							: 'border-[var(--ui-border-muted)] hover:border-[var(--ui-border-accented)]'
					)}
				>
					<input
						type="radio"
						name="report-reason"
						value={r.id}
						bind:group={reason}
						class="mt-0.5 accent-[var(--tone-error-text)]"
					/>
					<span class="min-w-0">
						<span class="block text-[13.5px] font-bold text-[var(--ui-text)]">{r.label}</span>
						<span class="block text-[12px] leading-snug text-[var(--ui-text-dimmed)]">{r.hint}</span
						>
					</span>
				</label>
			{/each}
		</fieldset>

		<textarea
			bind:value={comment}
			rows="2"
			maxlength="280"
			placeholder="Add context (optional — publicly visible)"
			disabled={!signedIn || submitting}
			class="w-full resize-none rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5 text-[13px] leading-relaxed transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-primary-500 focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60"
		></textarea>

		<p class="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ui-text-dimmed)]">
			<Icon name="i-lucide-info" class="mt-px size-3.5 shrink-0" />
			Reports are public Nostr events (NIP-56) — your pubkey is visible to the reported user and relay
			operators. Reporting {shortKey(pubkey, 6, 4)} also hides their notes from your feed.
		</p>
	</div>

	{#snippet footer()}
		<button
			type="button"
			onclick={close}
			disabled={submitting}
			class="inline-flex h-9 items-center justify-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={submit}
			disabled={!signedIn || submitting}
			class="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--tone-error-text)] px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<Icon
				name={submitting ? 'i-lucide-loader-circle' : 'i-lucide-flag'}
				class="size-4 {submitting ? 'animate-spin' : ''}"
			/>
			{submitting ? 'Sending' : 'Send report'}
		</button>
	{/snippet}
</Dialog>
