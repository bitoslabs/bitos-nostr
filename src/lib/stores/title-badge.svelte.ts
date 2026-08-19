import { browser } from '$app/environment';

/**
 * Unread badge for the browser tab title ("(3) Messages · BitOS").
 *
 * Routes own their base title through <svelte:head>, which overwrites
 * document.title on every navigation. This store observes the <title>
 * element instead: whenever a route swaps the title it adopts the new text
 * as the base (any existing badge stripped) and re-applies the badge, so
 * the count survives navigation. Writes from apply() never re-trigger the
 * observer because sync() only rewrites when the composed title differs.
 *
 * Mirrors the NavRail badge totals: notifications + DMs (privacy-gated) +
 * NIP-29 communities. Counts above 99 render as "(99+)".
 */
class TitleBadgeStore {
	private count = 0;
	private baseTitle = 'BitOS';
	private observer: MutationObserver | null = null;

	setCount = (count: number) => {
		this.count = Math.max(0, count | 0);
		if (browser) this.watch();
		this.sync();
	};

	/** Adopt the current DOM title as the base, then re-apply the badge. */
	private sync() {
		if (!browser) return;
		const stripped = this.stripBadge(document.title);
		if (stripped) this.baseTitle = stripped;
		this.apply();
	}

	private apply() {
		const badge = this.count > 0 ? `(${this.count > 99 ? '99+' : this.count}) ` : '';
		const next = `${badge}${this.baseTitle}`;
		if (document.title !== next) document.title = next;
	}

	private watch() {
		if (this.observer) return;
		const el = document.querySelector('title');
		if (!el) return;
		this.observer = new MutationObserver(() => this.sync());
		this.observer.observe(el, { childList: true, characterData: true, subtree: true });
	}

	private stripBadge(title: string): string {
		return title.replace(/^\(\d+\+?\)\s+/, '');
	}
}

export const titleBadge = new TitleBadgeStore();
