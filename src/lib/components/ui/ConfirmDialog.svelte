<script lang="ts">
	import { tick } from 'svelte';
	import { scale } from 'svelte/transition';
	import { confirms, type ConfirmRequest, type ConfirmTone } from '$lib/stores/confirms.svelte';
	import Dialog from './Dialog.svelte';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	const request = $derived<ConfirmRequest | null>(confirms.current);

	// Per-tone styling: icon badge bg/text + confirm button color + action icon.
	const TONE_STYLE: Record<
		ConfirmTone,
		{ badge: string; color: 'error' | 'success' | 'primary'; icon?: string }
	> = {
		danger: {
			badge: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]',
			color: 'error',
			icon: 'i-lucide-trash-2'
		},
		warning: {
			badge: 'bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]',
			color: 'error',
			icon: 'i-lucide-triangle-alert'
		},
		info: { badge: 'bg-[var(--tone-info-bg)] text-[var(--tone-info-text)]', color: 'primary' },
		success: {
			badge: 'bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]',
			color: 'success'
		},
		neutral: {
			badge: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]',
			color: 'primary'
		}
	};

	let cancelBtn = $state<HTMLButtonElement | undefined>();
	// Autofocus the cancel button when a new request appears — safer default for
	// destructive actions (prevents an accidental Enter confirming a delete).
	let lastId = 0;
	$effect(() => {
		const id = request?.id ?? 0;
		if (id && id !== lastId) {
			lastId = id;
			void tick().then(() => cancelBtn?.focus());
		}
	});

	function onKey(e: KeyboardEvent) {
		const r = request;
		if (!r) return;
		if (e.key === 'Enter' && r.confirmOnEnter) {
			e.preventDefault();
			confirms.confirm(r.id);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			confirms.cancel(r.id);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if request}
	{@const style = TONE_STYLE[request.tone]}
	<Dialog
		open
		closeOnOverlay={request.closeOnOverlay}
		onClose={() => confirms.cancel(request.id)}
	>
		<div
			class="flex flex-col items-center gap-4 py-1 text-center sm:flex-row sm:items-start sm:gap-4 sm:text-left"
		>
			<div
				in:scale={{ duration: 0.22, start: 0.6 }}
				class="flex size-12 shrink-0 items-center justify-center rounded-full {style.badge}"
			>
				<Icon name={request.icon} class="size-6" />
			</div>
			<div class="min-w-0 flex-1 space-y-1.5">
				<h2 class="text-[16px] font-bold leading-snug tracking-tight text-[var(--ui-text)]">
					{request.title}
				</h2>
				{#if request.message}
					<p class="text-[13.5px] leading-relaxed text-[var(--ui-text-muted)]">
						{request.message}
					</p>
				{/if}
			</div>
		</div>

		{#snippet footer()}
			<div class="flex w-full justify-end gap-2">
				<button
					bind:this={cancelBtn}
					type="button"
					onclick={() => confirms.cancel(request.id)}
					class="inline-flex h-9.5 items-center justify-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] px-4 text-[13.5px] font-semibold text-[var(--ui-text)] transition hover:bg-[var(--interactive-hover-bg)] focus-brand"
				>
					{request.cancelLabel}
				</button>
				<Button
					color={style.color}
					variant="solid"
					icon={style.icon}
					onclick={() => confirms.confirm(request.id)}
				>
					{request.confirmLabel}
				</Button>
			</div>
		{/snippet}
	</Dialog>
{/if}
