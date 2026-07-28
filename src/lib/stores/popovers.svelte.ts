class PopoverStore {
	active = $state<string | null>(null);

	open(id: string) {
		this.active = id;
	}

	toggle(id: string) {
		this.active = this.active === id ? null : id;
	}

	close() {
		this.active = null;
	}

	isOpen(id: string) {
		return this.active === id;
	}
}

export const popovers = new PopoverStore();
