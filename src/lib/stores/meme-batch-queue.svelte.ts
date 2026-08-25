/** Batch-queue list mechanics for the meme studio's mass-production mode:
 *  multi-picked GIFs/videos/pictures wait in line; each posted meme advances
 *  to the next source. The store owns ONLY the list (arrival order, unique
 *  ids, per-item captions, the staging pointer); the component owns staging
 *  side-effects — fetching, acceptFile and toasts. Toast-free by design so
 *  the mechanics stay unit-testable. */

/** One queued source: a remote GIF URL or a local File (videos and pictures
 *  multi-picked for mass production — each publish loads the next). */
export interface MemeBatchItem {
	id: number;
	url: string;
	label: string;
	/** Per-item post text — each meme in the batch can carry its own words. */
	caption?: string;
	file?: File;
}

export class MemeBatchQueue {
	/** Items in arrival order; `index` points at the next one to stage. */
	items = $state<MemeBatchItem[]>([]);
	index = $state(0);
	#seq = 0;

	/** Items not yet staged (what the queue strip renders). */
	get remainingItems(): MemeBatchItem[] {
		return this.items.slice(this.index);
	}

	/** How many publishes are still lined up. */
	get remaining(): number {
		return Math.max(0, this.items.length - this.index);
	}

	/** Label of the next item (Skip-button tooltip). */
	get peekLabel(): string {
		return this.items[this.index]?.label ?? 'none';
	}

	/** Queue local files; returns how many were appended. */
	appendFiles(files: File[]): number {
		if (!files.length) return 0;
		this.items = [
			...this.items,
			...files.map((file) => ({ id: ++this.#seq, url: '', label: file.name, file }))
		];
		return files.length;
	}

	/** Queue remote sources (GIF library picks, pasted URLs); returns the count. */
	appendUrls(sources: { url: string; label: string }[]): number {
		if (!sources.length) return 0;
		this.items = [
			...this.items,
			...sources.map((s) => ({ id: ++this.#seq, url: s.url, label: s.label }))
		];
		return sources.length;
	}

	/** Edit a queued item's post text (undefined = inherit nothing). */
	setCaption(id: number, caption: string | undefined): void {
		const item = this.items.find((i) => i.id === id);
		if (item) item.caption = caption;
	}

	/** Advance the staging pointer; returns the item to stage (null = done). */
	take(): MemeBatchItem | null {
		const next = this.items[this.index];
		if (!next) return null;
		this.index += 1;
		return next;
	}

	/** Drop every queued source (Clear button, discard, publish-complete). */
	clear(): void {
		this.items = [];
		this.index = 0;
	}
}
