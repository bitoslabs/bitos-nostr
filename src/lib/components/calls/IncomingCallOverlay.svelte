<script lang="ts">
	import { goto } from '$app/navigation';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { callAlerts, type IncomingCallAlert } from '$lib/stores/call-alerts.svelte';

	function chatUrl(alert: IncomingCallAlert, answer = false) {
		const params = new URLSearchParams({ to: alert.from });
		if (answer) params.set('answer', alert.callId);
		if (alert.groupId) params.set('group', alert.groupId);
		return `/messages?${params.toString()}`;
	}

	function accept(alert: IncomingCallAlert) {
		callAlerts.dismiss(alert.id);
		void goto(chatUrl(alert, true));
	}

	function openChat(alert: IncomingCallAlert) {
		callAlerts.dismiss(alert.id);
		void goto(chatUrl(alert));
	}

	function decline(alert: IncomingCallAlert) {
		callAlerts.dismiss(alert.id);
	}
</script>

{#if callAlerts.latest}
	{@const alert = callAlerts.latest}
	<div
		class="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-3 sm:justify-end sm:px-5"
	>
		<div
			class="pointer-events-auto w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--ui-border)] bg-[var(--surface-bg)] shadow-2xl shadow-black/15 backdrop-blur"
		>
			<div class="flex items-center gap-3 border-b border-[var(--ui-border-muted)] px-4 py-3">
				<div class="relative">
					<Avatar pubkey={alert.from} name={alert.callerName} size={48} />
					<span
						class="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full bg-primary-500 text-white ring-2 ring-[var(--surface-bg)]"
					>
						<Icon
							name={alert.kind === 'video' ? 'i-lucide-video' : 'i-lucide-phone'}
							class="size-3.5"
						/>
					</span>
				</div>
				<div class="min-w-0 flex-1">
					<p class="truncate text-[13px] font-bold text-[var(--ui-text)]">
						{alert.groupId ? 'Incoming group call' : 'Incoming call'}
					</p>
					<p class="truncate text-[12px] text-[var(--ui-text-muted)]">
						{alert.callerName} wants to start a {alert.kind} call
					</p>
				</div>
				<button
					type="button"
					class="grid size-8 place-items-center rounded-xl text-[var(--ui-text-dimmed)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					aria-label="Dismiss incoming call"
					onclick={() => decline(alert)}
				>
					<Icon name="i-lucide-x" class="size-4" />
				</button>
			</div>
			<div class="flex gap-2 px-4 py-3">
				<Button
					color="error"
					variant="soft"
					icon="i-lucide-phone-off"
					onclick={() => decline(alert)}
				>
					Decline
				</Button>
				<Button
					color="neutral"
					variant="soft"
					icon="i-lucide-message-circle"
					onclick={() => openChat(alert)}
				>
					Open chat
				</Button>
				<Button
					color="primary"
					variant="solid"
					icon={alert.kind === 'video' ? 'i-lucide-video' : 'i-lucide-phone'}
					onclick={() => accept(alert)}
				>
					Accept
				</Button>
			</div>
		</div>
	</div>
{/if}
