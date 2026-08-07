/**
 * Confirm dialog store — promise-based, imperative replacement for native
 * `window.confirm()`. Queue-based so multiple asks never clobber each other.
 *
 * Usage:
 *   import { confirms } from '$lib/stores/confirms.svelte';
 *   const ok = await confirms.ask({
 *     title: 'Delete note?',
 *     message: 'This cannot be undone.',
 *     tone: 'danger',
 *     confirmLabel: 'Delete'
 *   });
 *   if (!ok) return;
 */
export type ConfirmTone = 'danger' | 'warning' | 'info' | 'success' | 'neutral';

export interface ConfirmOptions {
	/** Headline question, e.g. "Delete this note?" */
	title: string;
	/** Supporting copy explaining the consequence. */
	message?: string;
	/** Visual tone. Defaults to 'neutral'. 'danger' keeps the overlay persistent. */
	tone?: ConfirmTone;
	/** Action button label. Defaults to a tone-derived verb ("Delete", "Continue", …). */
	confirmLabel?: string;
	/** Cancel button label. Defaults to "Cancel". */
	cancelLabel?: string;
	/** Iconify name (e.g. "i-lucide-trash-2"). Defaults to a tone-derived icon. */
	icon?: string;
	/**
	 * Whether clicking the backdrop cancels. Defaults to false for destructive
	 * (danger) actions, true otherwise.
	 */
	closeOnOverlay?: boolean;
	/** Whether pressing Enter confirms. Defaults to true. */
	confirmOnEnter?: boolean;
}

export interface ConfirmRequest extends Required<Omit<ConfirmOptions, 'message'>> {
	id: number;
	message?: string;
	resolve: (value: boolean) => void;
}

const TONE_DEFAULTS: Record<
	ConfirmTone,
	{ icon: string; confirmLabel: string; closeOnOverlay: boolean }
> = {
	danger: { icon: 'i-lucide-triangle-alert', confirmLabel: 'Delete', closeOnOverlay: false },
	warning: { icon: 'i-lucide-triangle-alert', confirmLabel: 'Continue', closeOnOverlay: false },
	info: { icon: 'i-lucide-info', confirmLabel: 'Continue', closeOnOverlay: true },
	success: { icon: 'i-lucide-circle-check', confirmLabel: 'Continue', closeOnOverlay: true },
	neutral: { icon: 'i-lucide-circle-help', confirmLabel: 'Continue', closeOnOverlay: true }
};

class ConfirmStore {
	items = $state<ConfirmRequest[]>([]);
	private seq = 0;

	/** Show a confirm dialog. Resolves `true` on confirm, `false` on dismiss/cancel. */
	ask(options: ConfirmOptions): Promise<boolean> {
		const tone = options.tone ?? 'neutral';
		const defaults = TONE_DEFAULTS[tone];
		const id = ++this.seq;
		const request: ConfirmRequest = {
			id,
			title: options.title,
			message: options.message,
			tone,
			icon: options.icon ?? defaults.icon,
			confirmLabel: options.confirmLabel ?? defaults.confirmLabel,
			cancelLabel: options.cancelLabel ?? 'Cancel',
			closeOnOverlay: options.closeOnOverlay ?? defaults.closeOnOverlay,
			confirmOnEnter: options.confirmOnEnter ?? true,
			resolve: () => {}
		};
		this.items = [...this.items, request];
		return new Promise<boolean>((resolve) => {
			request.resolve = resolve;
		});
	}

	/** Convenience helpers. */
	danger = (options: Omit<ConfirmOptions, 'tone'>) =>
		this.ask({ ...options, tone: 'danger' });
	warning = (options: Omit<ConfirmOptions, 'tone'>) =>
		this.ask({ ...options, tone: 'warning' });
	info = (options: Omit<ConfirmOptions, 'tone'>) => this.ask({ ...options, tone: 'info' });

	private settle(id: number, value: boolean) {
		const request = this.items.find((r) => r.id === id);
		if (!request) return;
		this.items = this.items.filter((r) => r.id !== id);
		request.resolve(value);
	}

	confirm(id: number) {
		this.settle(id, true);
	}

	cancel(id: number) {
		this.settle(id, false);
	}

	get current(): ConfirmRequest | null {
		return this.items[this.items.length - 1] ?? null;
	}
}

export const confirms = new ConfirmStore();
