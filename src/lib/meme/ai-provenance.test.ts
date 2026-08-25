import { describe, expect, it } from 'vitest';

import { AI_ASSISTED_MARKER, aiAssistedOf, aiAssistedTag } from '$lib/meme/ai-provenance';

describe('ai provenance (AI-004)', () => {
	it('emits a two-element ai tag with the marker', () => {
		const tag = aiAssistedTag();
		expect(tag).toEqual(['ai', AI_ASSISTED_MARKER]);
		expect(tag).toHaveLength(2);
	});

	it('reads its own output back as assisted', () => {
		expect(aiAssistedOf([aiAssistedTag()])).toBe(true);
	});

	it('accepts other producers using the same tag grammar', () => {
		expect(aiAssistedOf([['ai', 'other-client']])).toBe(true);
	});

	it('degrades on empty, foreign or malformed tags', () => {
		expect(aiAssistedOf(undefined)).toBe(false);
		expect(aiAssistedOf(null)).toBe(false);
		expect(aiAssistedOf([])).toBe(false);
		expect(aiAssistedOf([['client', 'BitOS']])).toBe(false);
		expect(aiAssistedOf([['ai']])).toBe(false);
		expect(aiAssistedOf([['ai', '']])).toBe(false);
		expect(
			aiAssistedOf([
				['remix', 'abc'],
				['ai', '', 'extra']
			])
		).toBe(false);
	});

	it('never throws on non-tag junk', () => {
		expect(aiAssistedOf([['ai', 'x'], 'not-a-tag'] as unknown as string[][])).toBe(true);
	});
});
