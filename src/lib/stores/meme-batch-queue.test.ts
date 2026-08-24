import { describe, expect, it } from 'vitest';
import { MemeBatchQueue } from './meme-batch-queue.svelte';

describe('MemeBatchQueue', () => {
	it('queues files and urls with unique ids', () => {
		const q = new MemeBatchQueue();
		const file = new File(['x'], 'cat.mp4', { type: 'video/mp4' });
		expect(q.appendFiles([file])).toBe(1);
		expect(q.appendUrls([{ url: 'https://x/1.gif', label: 'one' }])).toBe(1);
		expect(q.items.map((i) => i.id)).toEqual([1, 2]);
		expect(q.items[0]?.file).toBe(file);
		expect(q.items[1]?.url).toBe('https://x/1.gif');
	});

	it('reports remaining count and skips staged items in remainingItems', () => {
		const q = new MemeBatchQueue();
		q.appendUrls([
			{ url: 'https://x/1.gif', label: 'one' },
			{ url: 'https://x/2.gif', label: 'two' },
			{ url: 'https://x/3.gif', label: 'three' }
		]);
		expect(q.remaining).toBe(3);
		const first = q.take();
		expect(first?.label).toBe('one');
		expect(q.remaining).toBe(2);
		// The strip renders only what's left, in order.
		expect(q.remainingItems.map((i) => i.label)).toEqual(['two', 'three']);
		expect(q.peekLabel).toBe('two');
	});

	it('take() returns null when exhausted and does not overflow the index', () => {
		const q = new MemeBatchQueue();
		q.appendUrls([{ url: 'https://x/1.gif', label: 'one' }]);
		expect(q.take()).not.toBeNull();
		expect(q.take()).toBeNull();
		expect(q.index).toBe(1);
	});

	it('setCaption edits one item without touching the others', () => {
		const q = new MemeBatchQueue();
		q.appendUrls([
			{ url: 'https://x/1.gif', label: 'one' },
			{ url: 'https://x/2.gif', label: 'two' }
		]);
		const one = q.items[0]!;
		q.setCaption(one.id, 'my words');
		expect(q.items[0]?.caption).toBe('my words');
		expect(q.items[1]?.caption).toBeUndefined();
		q.setCaption(one.id, undefined);
		expect(q.items[0]?.caption).toBeUndefined();
		// Unknown id is a no-op.
		q.setCaption(999, 'x');
		expect(q.items[1]?.caption).toBeUndefined();
	});

	it('clear() resets items, index and keeps future ids unique', () => {
		const q = new MemeBatchQueue();
		q.appendUrls([{ url: 'https://x/1.gif', label: 'one' }]);
		q.take();
		q.clear();
		expect(q.items).toEqual([]);
		expect(q.remaining).toBe(0);
		q.appendUrls([{ url: 'https://x/2.gif', label: 'two' }]);
		// seq keeps counting — no id reuse after a clear.
		expect(q.items[0]?.id).toBe(2);
	});
});
