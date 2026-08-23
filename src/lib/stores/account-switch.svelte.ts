/**
 * Account switcher store — owns the switch-account dialog plus the branded
 * full-screen transition shown while account-scoped stores are torn down and
 * rebuilt (see the identity effect in +layout.svelte). The transition overlay
 * speaks the boot/loading-screen motion language (hex badge with orbit trace
 * and charge sheen, sweeping PoW segments) but is personalized: the hex
 * carries the account's profile picture and the display name + npub replace
 * the logo wordmark — like real multi-account apps.
 *
 * Usage:
 *   accountSwitcher.open();                          // show the dialog
 *   await accountSwitcher.switchTo(pubkey);          // switch with overlay
 */
import { browser } from '$app/environment';
import { identity } from '$lib/nostr/identity.svelte';
import { profiles } from '$lib/nostr/profiles.svelte';
import { toasts } from '$lib/stores/toasts.svelte';
import { shortKey } from '$lib/utils/format';

/**
 * Minimum time the switch overlay stays visible. The personalized hex needs a
 * moment to play (outgoing avatar → incoming avatar crossfade), and account
 * stores restart underneath it — swapping too fast produces a jarring flash
 * of half-cleared UI.
 */
const MIN_SWITCH_MS = 1300;

/** Resolves after the next paint, so the overlay renders before the heavy
 *  identity swap freezes the main thread with store teardown/rebuild. */
function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		if (!browser) return resolve();
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Identity snapshot for the overlay — captured *before* switching, since the
 *  profile cache is cleared when the account changes. */
export interface SwitchAccountInfo {
	pubkey: string;
	name: string;
	npub: string;
	picture?: string;
	/** Verified handle (NIP-05) — drives the ✓ badge on the overlay. */
	nip05?: string;
	/** Lightning address (lud16) — drives the ⚡ badge on the overlay. */
	lud16?: string;
}

export interface SwitchPending {
	/** Account being switched away from (drives the outgoing avatar moment). */
	from: SwitchAccountInfo | null;
	/** Account being switched to — drives the overlay's identity lockup. */
	to: SwitchAccountInfo;
}

class AccountSwitcherStore {
	/** Switch-account dialog visibility (singleton dialog lives in +layout). */
	dialogOpen = $state(false);

	/** Set while a switch is in progress; drives the transition overlay. */
	pending = $state<SwitchPending | null>(null);

	private switching = false;

	open = () => {
		this.dialogOpen = true;
	};

	close = () => {
		this.dialogOpen = false;
	};

	toggle = () => {
		this.dialogOpen = !this.dialogOpen;
	};

	private infoFor = (pubkey: string): SwitchAccountInfo | null => {
		const account = identity.accounts.find((item) => item.pk === pubkey);
		const profile = profiles.get(pubkey) ?? account?.profile;
		const npub = account?.npub ?? '';
		const name =
			profile?.display_name || profile?.name || shortKey(npub || pubkey, 8, 5) || 'account';
		return {
			pubkey,
			name,
			npub,
			picture: profile?.picture ?? undefined,
			nip05: profile?.nip05?.trim() || undefined,
			lud16: profile?.lud16?.trim() || profile?.lud06?.trim() || undefined
		};
	};

	/**
	 * Switch to a saved account with the personalized boot-style transition:
	 * the overlay paints first (showing the outgoing, then the incoming
	 * avatar), then the identity swap triggers the layout teardown and the
	 * animation plays while stores settle. Re-entrant calls are ignored.
	 */
	switchTo = async (pubkey: string) => {
		if (this.switching) return;
		if (identity.current?.pk === pubkey) {
			this.dialogOpen = false;
			return;
		}
		const to = this.infoFor(pubkey);
		if (!to) {
			toasts.error('Account not found on this device');
			return;
		}
		const from = identity.current ? this.infoFor(identity.current.pk) : null;
		this.dialogOpen = false;
		this.pending = { from, to };
		this.switching = true;
		try {
			await nextPaint(); // overlay renders before the heavy reset
			identity.switchTo(pubkey);
			await sleep(MIN_SWITCH_MS); // animation window while stores restart
			toasts.success(`Switched to ${to.name}`);
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			this.switching = false;
			this.pending = null; // overlay fades out
		}
	};
}

export const accountSwitcher = new AccountSwitcherStore();
