<script lang="ts">
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import AccountIdentityBadges from '$lib/components/ui/AccountIdentityBadges.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { accountSwitcher } from '$lib/stores/account-switch.svelte';
	import { confirms } from '$lib/stores/confirms.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';

	/**
	 * Switch-account dialog (singleton, driven by the accountSwitcher store).
	 * Carries the boot/loading-screen motion language — hex badge with orbit
	 * trace + charge sheen, sweeping PoW segments — but personalized around
	 * the user, not the app: the header hex carries the active account's
	 * profile picture, and every row shows identity signals (✓ NIP-05,
	 * ⚡ Lightning) next to the name, with the verified handle preferred over
	 * the raw npub as the secondary line.
	 */
	const me = $derived(identity.current);
	// Prefer the live profile, but keep the persisted account profile as the
	// immediate fallback while relay/profile hydration is still in progress.
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	/** Switch candidates: saved accounts other than the active one. */
	const others = $derived(identity.accounts.filter((account) => !account.active));

	function accountProfile(pubkey: string) {
		const account = identity.accounts.find((item) => item.pk === pubkey);
		return profiles.get(pubkey) ?? account?.profile;
	}

	function accountName(account: (typeof identity.accounts)[number]) {
		const profile = accountProfile(account.pk);
		return profile?.display_name || profile?.name || shortKey(account.npub, 8, 6);
	}

	async function removeAccount(pubkey: string, name: string) {
		if (
			!(await confirms.danger({
				title: 'Remove saved account?',
				message: `"${name}" will be removed from this device. Make sure its nsec is backed up — it is the only way to recover the identity.`,
				confirmLabel: 'Remove'
			}))
		)
			return;
		identity.removeAccount(pubkey);
		toasts.info('Account removed from this device');
	}

	function onKey(event: KeyboardEvent) {
		if (accountSwitcher.dialogOpen && event.key === 'Escape') {
			event.preventDefault();
			accountSwitcher.close();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if accountSwitcher.dialogOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			tabindex="-1"
			aria-label="Close account switcher"
			class="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[3px]"
			onclick={accountSwitcher.close}
		></button>
		<div
			class="surface-card animate-rise relative z-10 flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden shadow-2xl shadow-black/30"
			role="dialog"
			aria-modal="true"
			aria-label="Switch account"
		>
			<!-- Header: boot-splash motion, personalized — the hex badge carries
			     the ACTIVE account's avatar (not the app logo), with the orbit
			     trace + charge sheen from the loading screen. -->
			<header class="relative shrink-0 border-b border-[var(--ui-border)] px-5 pt-5 pb-4">
				<div class="flex items-center gap-3.5">
					<div
						class="hex-clip bs-pulse-soft relative grid size-11 shrink-0 place-items-center bg-[linear-gradient(135deg,#FFB51B,#F7931A)] shadow-[0_4px_18px_rgb(247_147_26_/_0.5)]"
						aria-hidden="true"
					>
						<svg class="bs-boot-orbit" viewBox="0 0 100 100">
							<polygon points="25,6.7 75,6.7 100,50,75,93.3,25,93.3,0,50" />
						</svg>
						{#if me}
							<!-- Avatar inset inside the gradient hex ring. -->
							<div class="absolute inset-[2.5px] z-[2]">
								<Avatar
									pubkey={me.pk}
									name={displayName}
									frame
									picture={myProfile?.picture}
									lightning={false}
									size={39}
								/>
							</div>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="text-[16px] font-bold tracking-tight">Switch account</h2>
						<!-- Signed-in identity: name + ✓ NIP-05 / ⚡ Lightning signals. -->
						<p class="flex min-w-0 items-center gap-1 text-[12px] text-[var(--ui-text-muted)]">
							<span class="truncate">Signed in as {displayName}</span>
							<AccountIdentityBadges profile={myProfile} showLightning={false} />
						</p>
					</div>
					<!-- Config: manage the saved-account list in Settings. -->
					<a
						href="/settings"
						onclick={accountSwitcher.close}
						class="focus-brand grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						aria-label="Account settings — manage saved accounts"
						title="Manage accounts in Settings"
					>
						<Icon name="i-lucide-settings-2" class="size-4" />
					</a>
					<button
						type="button"
						onclick={accountSwitcher.close}
						class="focus-brand grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						aria-label="Close"
					>
						<Icon name="i-lucide-x" class="size-4" />
					</button>
				</div>
				<!-- PoW segments sweeping while the dialog is open — same as boot. -->
				<div class="pow-bar mt-4" aria-hidden="true">
					{#each Array(9).keys() as i (i)}
						<span class="pow-boot-seg" style="animation-delay:{i * 0.12}s"></span>
					{/each}
				</div>
			</header>

			<!-- Body: current account pinned on top, switch candidates below. -->
			<div class="min-h-0 flex-1 overflow-y-auto p-3">
				{#if me}
					<a
						href="/profile"
						onclick={accountSwitcher.close}
						class="focus-brand flex items-center gap-3 rounded-xl border border-primary-500/25 bg-primary-500/5 p-2.5 transition hover:bg-primary-500/10"
						aria-label="View your profile"
					>
						<Avatar
							pubkey={me.pk}
							name={displayName}
							picture={myProfile?.picture}
							size={42}
							lightning={!!(myProfile?.lud16 || myProfile?.lud06)}
							frame
						/>
						<span class="min-w-0 flex-1 leading-tight">
							<span class="flex min-w-0 items-center gap-1.5 text-[14px] font-bold">
								<span class="truncate">{displayName}</span>
								<AccountIdentityBadges profile={myProfile} showLightning={false} />
							</span>
							<span
								class="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ui-text-dimmed)]"
							>
								<span class="truncate font-mono">{shortKey(me.pk, 8, 5)}</span>
								<span>·</span>
								<span class="shrink-0">View profile</span>
							</span>
						</span>
						<span
							class="flex shrink-0 items-center gap-1 rounded-full bg-primary-500/10 px-2 py-1 text-[10.5px] font-bold text-primary-600 uppercase dark:text-primary-400"
						>
							<Icon name="i-lucide-check" class="size-3" />
							Active
						</span>
					</a>
				{/if}

				{#if others.length > 0}
					<p
						class="px-1.5 pt-3 pb-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)] uppercase"
					>
						Switch to
					</p>
					{#each others as account, i (account.pk)}
						{@const profile = accountProfile(account.pk)}
						<div
							class="animate-rise group flex items-center gap-1 rounded-xl transition hover:bg-[var(--interactive-hover-bg)]"
							style="animation-delay:{Math.min(i * 60, 240)}ms"
						>
							<button
								type="button"
								onclick={() => accountSwitcher.switchTo(account.pk)}
								class="focus-brand flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
							>
								<!-- Same author block as a feed note card (PostCard):
								     hex avatar with the ⚡ badge, name + ✓. -->
								<Avatar
									pubkey={account.pk}
									name={accountName(account)}
									picture={profile?.picture}
									size={42}
									lightning={!!(profile?.lud16 || profile?.lud06)}
								/>
								<span class="min-w-0 flex-1 leading-tight">
									<span class="flex min-w-0 items-center gap-1.5 text-[14px] font-bold">
										<span class="truncate">{accountName(account)}</span>
										<AccountIdentityBadges {profile} showLightning={false} />
									</span>
									<!-- Meta line, feed-style: npub · last-used. -->
									<span
										class="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ui-text-dimmed)]"
									>
										<span class="truncate font-mono">{shortKey(account.npub, 8, 5)}</span>
										<span>·</span>
										<span
											class="shrink-0"
											title={account.lastUsedAt
												? `Last used ${timeAgo(account.lastUsedAt)} ago`
												: undefined}
										>
											used {timeAgo(account.lastUsedAt)}
										</span>
									</span>
								</span>
								<Icon
									name="i-lucide-arrow-right-left"
									class="size-4 shrink-0 text-[var(--ui-text-dimmed)] transition group-hover:text-primary-500"
								/>
							</button>
							<button
								type="button"
								onclick={() => removeAccount(account.pk, accountName(account))}
								class="focus-brand mr-2 grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)] focus-visible:opacity-100"
								aria-label="Remove {accountName(account)} from this device"
								title="Remove from this device"
							>
								<Icon name="i-lucide-trash-2" class="size-3.5" />
							</button>
						</div>
					{/each}
				{:else if me}
					<!-- Single-account device: explain how to get a second account. -->
					<div
						class="mt-3 rounded-xl border border-dashed border-[var(--ui-border-muted)] p-4 text-center"
					>
						<Icon name="i-lucide-user-plus" class="mx-auto size-5 text-[var(--ui-text-dimmed)]" />
						<p class="mt-2 text-[12.5px] leading-relaxed text-[var(--ui-text-muted)]">
							Only one account on this device so far. Add another to switch instantly — feeds,
							chats, and settings stay separate.
						</p>
					</div>
				{/if}
			</div>

			<!-- Footer: manage (settings) + add account funnel (onboarding). -->
			<footer
				class="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--ui-border)] px-5 py-3.5"
			>
				<a
					href="/settings"
					onclick={accountSwitcher.close}
					class="focus-brand rounded-lg px-1 py-1.5 text-[12.5px] font-semibold text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]"
				>
					Manage in Settings
				</a>
				<a
					href="/welcome"
					onclick={accountSwitcher.close}
					class="focus-brand inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-500 px-3.5 text-[13px] font-semibold text-white shadow-[var(--glow-primary)] transition-colors hover:bg-primary-600"
				>
					<Icon name="i-lucide-user-plus" class="size-4" />
					Add account
				</a>
			</footer>
		</div>
	</div>
{/if}
