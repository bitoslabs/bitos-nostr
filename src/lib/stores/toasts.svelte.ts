/** Toast store — transient notifications. */
export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'warning' | 'error';
}

class ToastStore {
	items = $state<Toast[]>([]);
	private seq = 0;

	push(message: string, tone: Toast['tone'] = 'info', ttl = 3500) {
		const id = ++this.seq;
		this.items = [...this.items, { id, message, tone }];
		if (ttl > 0) setTimeout(() => this.dismiss(id), ttl);
		return id;
	}

	info = (m: string) => this.push(m, 'info');
	success = (m: string) => this.push(m, 'success');
	warning = (m: string) => this.push(m, 'warning');
	error = (m: string) => this.push(m, 'error', 5000);

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastStore();
