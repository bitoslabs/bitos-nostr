<script lang="ts">
	import { goto } from '$app/navigation';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { callAlerts, type IncomingCallAlert } from '$lib/stores/call-alerts.svelte';
	import { callSettings } from '$lib/stores/call-settings.svelte';
	import { playRingtone, stopRingtone } from '$lib/calls/ringtone';
	import { callSignalText, type CallOutcome } from '$lib/messages/protocol';
	import { dms } from '$lib/nostr/dms.svelte';
	import { identity } from '$lib/nostr/identity.svelte';

	const MISS_AFTER_MS = 30_000;
	let now = $state(Date.now());
	let autoMissed = false;

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

	async function decline(alert: IncomingCallAlert, outcome: CallOutcome = 'declined') {
		callAlerts.dismiss(alert.id);
		const me = identity.current;
		if (!me) return;
		try {
			await Promise.all([
				dms.send(
					alert.from,
					callSignalText({
						callId: alert.callId,
						type: 'end',
						kind: alert.kind,
						from: me.pk,
						groupId: alert.groupId
					})
				),
				dms.send(
					alert.from,
					callSignalText({
						callId: alert.callId,
						type: 'log',
						kind: alert.kind,
						from: me.pk,
						groupId: alert.groupId,
						duration: 0,
						outcome
					})
				)
			]);
		} catch {
			// The local alert is dismissed even if signaling is temporarily unavailable.
		}
	}

	// Countdown to auto-miss + looping ringtone while an incoming call is visible.
	$effect(() => {
		const alert = callAlerts.latest;
		if (!alert) {
			stopRingtone();
			autoMissed = false;
			return;
		}
		if (callSettings.state.sounds) playRingtone();
		const tick = setInterval(() => {
			now = Date.now();
			const remaining = MISS_AFTER_MS - (now - alert.createdAt * 1000);
			if (remaining <= 0 && !autoMissed) {
				autoMissed = true;
				void decline(alert, 'missed');
			}
		}, 250);
		return () => {
			clearInterval(tick);
			stopRingtone();
		};
	});

	function remainingSeconds(alert: IncomingCallAlert) {
		return Math.max(0, Math.ceil((MISS_AFTER_MS - (now - alert.createdAt * 1000)) / 1000));
	}
</script>

{#if callAlerts.latest}
	{@const alert = callAlerts.latest}
	{@const remaining = remainingSeconds(alert)}
	<div
		class="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-3 sm:justify-end sm:px-5"
	>
		<div
			class="call-bounce-in pointer-events-auto w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--ui-border)] bg-[var(--surface-bg)] shadow-[var(--shadow-pop)] backdrop-blur"
		>
			<div
				class="h-1 w-full bg-gradient-to-r from-primary-500 via-primary-400 to-emerald-400"
				aria-hidden="true"
			></div>
			<div class="px-4 pt-4 pb-3">
				<div class="flex items-center gap-3">
					<div class="relative size-12 shrink-0">
						<span class="call-ring"></span>
						<span class="call-ring call-ring--2"></span>
						<span class="call-ring call-ring--3"></span>
						<Avatar
							pubkey={alert.from}
							name={alert.callerName}
							size={48}
							class="relative mask-squircle"
						/>
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
						<p
							class="flex items-center gap-1.5 truncate text-[13px] font-bold text-[var(--ui-text)]"
						>
							<Icon name="i-lucide-phone-incoming" class="size-3.5 shrink-0 text-primary-500" />
							{alert.groupId ? 'Incoming group call' : 'Incoming call'}
						</p>
						<p class="truncate text-[12px] text-[var(--ui-text-muted)]">
							{alert.callerName} wants to start a {alert.kind} call
						</p>
						<p
							class="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[var(--tone-success-text)]"
						>
							<Icon name="i-lucide-lock" class="size-3 shrink-0" />
							End-to-end encrypted
						</p>
					</div>
					<button
						type="button"
						class="grid size-8 shrink-0 place-items-center rounded-xl text-[var(--ui-text-dimmed)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						aria-label="Dismiss incoming call"
						onclick={() => decline(alert)}
					>
						<Icon name="i-lucide-x" class="size-4" />
					</button>
				</div>
				<!-- Animated "ringing" waveform -->
				<div class="mt-3 flex h-5 items-end justify-center gap-[3px]" aria-hidden="true">
					{#each Array(28) as _, i (i)}
						<span
							class="wave-bar w-1 rounded-full bg-primary-400/70"
							style={`height: ${30 + ((i * 37) % 70)}%; animation-delay: ${(i % 7) * 0.09}s`}
						></span>
					{/each}
				</div>
				<!-- Auto-miss countdown -->
				<div class="mt-2">
					<div class="h-1 overflow-hidden rounded-full bg-[var(--ui-border-muted)]">
						<div
							class="h-full rounded-full bg-primary-400 transition-[width] duration-200 ease-linear"
							style={`width: ${(remaining / (MISS_AFTER_MS / 1000)) * 100}%`}
						></div>
					</div>
					<p class="mt-1 text-center text-[10px] font-semibold text-[var(--ui-text-dimmed)]">
						Auto-miss in {remaining}s
					</p>
				</div>
			</div>
			<div class="flex gap-2 px-4 pb-4">
				<Button
					class="flex-1"
					color="error"
					variant="soft"
					icon="i-lucide-phone-off"
					onclick={() => decline(alert)}
				>
					Decline
				</Button>
				<Button
					class="flex-1"
					color="neutral"
					variant="soft"
					icon="i-lucide-message-circle"
					onclick={() => openChat(alert)}
				>
					Open chat
				</Button>
				<Button
					class="flex-1"
					color="success"
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
