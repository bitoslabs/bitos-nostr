import { describe, expect, it } from 'vitest';
import { visibleInsertIndex } from './feed.svelte';

describe('visibleInsertIndex', () => {
	it('keeps equal timestamps after existing notes by default', () => {
		const notes = [{ createdAt: 100 }, { createdAt: 100 }, { createdAt: 99 }];
		expect(visibleInsertIndex(notes, { createdAt: 100 })).toBe(2);
	});

	it('places optimistic local notes before equal timestamps when requested', () => {
		const notes = [{ createdAt: 100 }, { createdAt: 100 }, { createdAt: 99 }];
		expect(visibleInsertIndex(notes, { createdAt: 100 }, { preferNewestOnEqual: true })).toBe(0);
	});
});
