import { afterEach, describe, expect, it } from 'vitest';

import { takeSharedFile } from './share-inbox';

/**
 * Share-target inbox drain (browser): the service worker banks an OS-shared
 * file into the `bitos-share-inbox` Cache and the studio route drains it via
 * `takeSharedFile()` — exactly once, with name + type intact.
 */

const INBOX = 'bitos-share-inbox';
const KEY = '/__bitos-shared-file__';

async function stash(name: string, type: string, bytes: Uint8Array): Promise<void> {
	const cache = await caches.open(INBOX);
	await cache.put(
		KEY,
		new Response(new Blob([bytes as BlobPart], { type }), {
			headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }
		})
	);
}

afterEach(async () => {
	if (typeof caches === 'undefined') return;
	await (await caches.open(INBOX)).delete(KEY);
});

describe('share inbox (browser: Cache API)', () => {
	it('drains a stashed file once, with name + type intact', { timeout: 20_000 }, async () => {
		await stash('holiday.mp4', 'video/mp4', new Uint8Array([9, 8, 7, 6]));
		const file = await takeSharedFile();
		expect(file).not.toBeNull();
		expect(file!.name).toBe('holiday.mp4');
		expect(file!.type).toBe('video/mp4');
		expect(file!.size).toBe(4);
		// Exactly once: the inbox entry is removed with the drain.
		const again = await takeSharedFile();
		expect(again).toBeNull();
	});

	it('decodes URI-encoded names safely', async () => {
		await stash(' мемечка.png', 'image/png', new Uint8Array([1]));
		const file = await takeSharedFile();
		expect(file!.name).toBe(' мемечка.png');
	});

	it('returns null for an empty inbox', async () => {
		const cache = await caches.open(INBOX);
		await cache.delete(KEY);
		expect(await takeSharedFile()).toBeNull();
	});
});
