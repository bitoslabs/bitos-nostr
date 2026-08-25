<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Avatar from './Avatar.svelte';
	import AccountIdentityBadges from './AccountIdentityBadges.svelte';
	import { accountSwitcher, type SwitchAccountInfo } from '$lib/stores/account-switch.svelte';
	import { shortKey } from '$lib/utils/format';

	/**
	 * Full-screen, personalized account-switch transition. Same motion
	 * language as the boot/loading screen — gradient hex badge with orbit
	 * trace + charge sheen, sweeping PoW segments — but centered on the
	 * user's identity instead of the brand: the hex carries the account's
	 * profile picture (crossfading from the outgoing account to the incoming
	 * one mid-animation), and the display name + npub replace the logo
	 * wordmark below. Fades out once the switch completes.
	 */
	const FADE_MS = 340;
	/** When the hex hands over from the outgoing to the incoming account. */
	const AVATAR_SWAP_MS = 450;

	let shown = $state(false);
	let closing = $state(false);
	/** Account currently owning the hex badge (starts as the outgoing one). */
	let active = $state<SwitchAccountInfo | null>(null);

	$effect(() => {
		const pending = accountSwitcher.pending;
		if (pending) {
			shown = true;
			closing = false;
			active = pending.from ?? pending.to;
			const swap = setTimeout(() => {
				active = pending.to;
			}, AVATAR_SWAP_MS);
			return () => clearTimeout(swap);
		}
		if (shown) {
			closing = true;
			const done = setTimeout(() => {
				shown = false;
				closing = false;
			}, FADE_MS);
			return () => clearTimeout(done);
		}
	});

	const target = $derived(accountSwitcher.pending?.to ?? null);
</script>

{#if shown}
	<!-- Sits above dialogs (z-50) so it covers the switching UI; toasts stay
	     visible on top (z-100) so the confirmation lands after the fade. -->
	<div
		class="fixed inset-0 z-[80] grid place-items-center bg-[var(--ui-bg)] transition-opacity duration-300 ease-out {closing
			? 'pointer-events-none opacity-0'
			: 'opacity-100'}"
		role="status"
		aria-live="polite"
		aria-label={target ? `Switching to ${target.name}` : 'Switching account'}
	>
		<div class="flex flex-col items-center gap-4">
			<!-- Hex badge carrying the account avatar — same boot treatment:
			     gradient hex, perimeter orbit trace, charge sheen. -->
			<div
				class="hex-clip bs-pulse-soft relative grid size-[64px] place-items-center bg-[linear-gradient(135deg,#FFB51B,#F7931A)] shadow-[0_4px_18px_rgb(247_147_26_/_0.5)]"
				aria-hidden="true"
			>
				<svg class="bs-boot-orbit" viewBox="0 0 100 100">
					<polygon points="25,6.7 75,6.7 100,50,75,93.3,25,93.3,0,50" />
				</svg>
				{#if active}
					{#key active.pubkey}
						<!-- Crossfade: outgoing account's avatar lifts out, the
						     incoming account's settles in — the handover moment. -->
						<div
							class="absolute inset-[7px] z-[2]"
							in:fly={{ duration: 340, delay: 80, y: 10 }}
							out:fade={{ duration: 180 }}
						>
							<Avatar
								pubkey={active.pubkey}
									name={active.name}
									picture={active.picture}
								size={50}
								lightning={!!active.lud16}
								/>
						</div>
					{/key}
				{/if}
			</div>

			<!-- Identity lockup: the incoming account's name + npub (replaces
			     the boot screen's logo wordmark). -->
			{#if target}
				<div class="animate-fade flex flex-col items-center gap-1.5">
					<!-- Name + ✓ NIP-05 inline; the ⚡ Lightning badge lives on the
					     hex avatar above (same as the dialog rows), so it swaps
					     with the account during the crossfade. -->
					<p
						class="flex max-w-[80vw] items-center gap-1.5 px-2 text-[17px] font-bold tracking-tight"
					>
						<span class="truncate">{target.name}</span>
						<AccountIdentityBadges profile={target} showLightning={false} />
					</p>
					<p class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">
						{shortKey(target.npub || target.pubkey, 10, 6)}
					</p>
				</div>
			{/if}

			<div class="mt-1 flex flex-col items-center gap-2.5">
				<div class="pow-bar" aria-hidden="true">
					{#each Array(9).keys() as i (i)}
						<span class="pow-boot-seg" style="animation-delay:{i * 0.12}s"></span>
					{/each}
				</div>
				<p class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">Switching account…</p>
			</div>
		</div>
	</div>
{/if}
