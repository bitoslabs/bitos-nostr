/** Toast store — transient notifications. */
export interface ToastAction {
	label: string;
	run: () => void;
}

export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'warning' | 'error';
	/** Optional inline action (e.g. "View in Bitz" after posting). */
	action?: ToastAction;
}

class ToastStore {
	items = $state<Toast[]>([]);
	private seq = 0;

	push(message: string, tone: Toast['tone'] = 'info', ttl = 3500, action?: ToastAction) {
		const id = ++this.seq;
		this.items = [...this.items, { id, message, tone, action }];
		if (ttl > 0) setTimeout(() => this.dismiss(id), ttl);
		return id;
	}

	info = (m: string, ttl?: number) => this.push(m, 'info', ttl);
	success = (m: string, ttl?: number) => this.push(m, 'success', ttl);
	warning = (m: string, ttl?: number) => this.push(m, 'warning', ttl);
	error = (m: string, ttl = 5000) => this.push(m, 'error', ttl);

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastStore();
