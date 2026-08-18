import { describe, expect, it } from 'vitest';
import { hasNip05 } from './verification';

describe('verification helpers', () => {
	it('treats a non-empty NIP-05 as verified', () => {
		expect(hasNip05({ nip05: 'alice@example.com' })).toBe(true);
		expect(hasNip05({ nip05: '   ' })).toBe(false);
		expect(hasNip05(undefined)).toBe(false);
	});
});
