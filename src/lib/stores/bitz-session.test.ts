import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
});

const { bitzSession, optimisticReelFromEvent, reconcileOptimisticReel } =
	await import('./bitz-session.svelte');
const { stageEvent, recordAck } = await import('./event-outbox');

function reel(id: string, createdAt: number, overrides: Record<string, unknown> = {}) {
	return {
		id,
		pubkey: 'b'.repeat(64),
		content: 'caption',
		createdAt,
		pow: undefined,
		tags: [['imeta', 'url https://cdn.example/x.mp4', 'm video/mp4']],
		raw: undefined,
		replyTo: undefined,
		reactions: [],
		repostCount: 0,
		zapCount: 0,
		zapTotalSats: 0,
		poll: undefined,
		mediaUrl: 'https://cdn.example/x.mp4',
		mediaType: 'video' as const,
		mediaFallbacks: [],
		...overrides
	};
}

/** A signed kind-22 shape as finalizeEvent would emit (trimmed to the fields
 *  toFeedNote/parseBitz read). */
function signedVideoEvent(id: string, createdAt: number, url = 'https://cdn.example/x.mp4') {
	return {
		id,
		pubkey: 'b'.repeat(64),
		kind: 22,
		content: 'caption',
		created_at: createdAt,
		tags: [['imeta', `url ${url}`, 'm video/mp4', 'dim 1080x1920', 'duration 8.400']],
		sig: 'c'.repeat(128)
	};
}

beforeEach(() => {
	memory.clear();
	bitzSession.reels = [];
});

describe('reconcileOptimisticReel', () => {
	it('inserts a novel reel at the head (optimistic publish)', () => {
		const { reels, inserted } = reconcileOptimisticReel(
			[reel('a'.repeat(64), 100)],
			reel('f'.repeat(64), 300)
		);
		expect(inserted).toBe(true);
		expect(reels).toHaveLength(2);
		expect(reels[0].id).toBe('f'.repeat(64));
	});

	it('reconciles the relay echo into the same slot — no duplicate (idempotent)', () => {
		const optimistic = reel('f'.repeat(64), 300);
		const echo = reel('f'.repeat(64), 300, { raw: { sig: 'c'.repeat(128) } as never });
		const first = reconcileOptimisticReel([], optimistic);
		const second = reconcileOptimisticReel(first.reels, echo);
		expect(second.inserted).toBe(false);
		expect(second.reels).toHaveLength(1);
		expect(second.reels[0].raw).toBeDefined();
	});

	it('keeps the existing slot untouched when the echo is identical', () => {
		const optimistic = reel('f'.repeat(64), 300);
		const { reels, inserted, replaced } = reconcileOptimisticReel(
			[optimistic],
			reel('f'.repeat(64), 300)
		);
		expect(inserted).toBe(false);
		expect(replaced).toBe(false);
		expect(reels[0]).toBe(optimistic);
	});

	it('upgrades counts from the echo without reordering the list', () => {
		const optimistic = reel('f'.repeat(64), 300);
		const other = reel('a'.repeat(64), 200);
		const echo = reel('f'.repeat(64), 300, { repostCount: 2, zapTotalSats: 1000 });
		const { reels } = reconcileOptimisticReel([optimistic, other], echo);
		expect(reels.map((r) => r.id)).toEqual(['f'.repeat(64), 'a'.repeat(64)]);
		expect(reels[0].repostCount).toBe(2);
		expect(reels[0].zapTotalSats).toBe(1000);
	});

	it('reconciles addressable echoes by coordinate, newest created_at wins', () => {
		const d = [['d', 'my-reel']];
		const old = reel('0'.repeat(64), 100, {
			tags: [...d, ['imeta', 'url https://cdn.example/old.mp4']],
			mediaUrl: 'https://cdn.example/old.mp4',
			raw: { kind: 34236, sig: '1' } as never
		});
		const fresh = reel('1'.repeat(64), 200, {
			tags: [...d, ['imeta', 'url https://cdn.example/new.mp4']],
			mediaUrl: 'https://cdn.example/new.mp4',
			raw: { kind: 34236, sig: '2' } as never
		});
		const { reels, replaced } = reconcileOptimisticReel([old], fresh);
		expect(replaced).toBe(true);
		expect(reels).toHaveLength(1);
		expect(reels[0].id).toBe('1'.repeat(64));
		expect(reels[0].mediaUrl).toBe('https://cdn.example/new.mp4');
	});

	it('ignores an older addressable echo (relay replay out of order)', () => {
		const d = [['d', 'my-reel']];
		const fresh = reel('1'.repeat(64), 200, {
			tags: [...d],
			raw: { kind: 34236, sig: '2' } as never
		});
		const stale = reel('0'.repeat(64), 100, {
			tags: [...d],
			raw: { kind: 34236, sig: '1' } as never
		});
		const { reels, replaced } = reconcileOptimisticReel([fresh], stale);
		expect(replaced).toBe(false);
		expect(reels[0].id).toBe('1'.repeat(64));
	});
});

describe('optimisticReelFromEvent', () => {
	it('builds a reel from a signed kind-22 event via imeta', () => {
		const reel = optimisticReelFromEvent(signedVideoEvent('f'.repeat(64), 1_700_000_000));
		expect(reel).not.toBeNull();
		expect(reel!.id).toBe('f'.repeat(64));
		expect(reel!.mediaUrl).toBe('https://cdn.example/x.mp4');
		expect(reel!.mediaType).toBe('video');
		expect(reel!.createdAt).toBe(1_700_000_000);
		expect(reel!.raw).toBeDefined();
	});

	it('returns null for events without reel-renderable media', () => {
		// A video-kind event with no imeta and no media URL in content has no
		// renderable reel — parseBitz returns null and staging is skipped.
		const bare = {
			id: 'f'.repeat(64),
			pubkey: 'b'.repeat(64),
			kind: 22,
			content: 'caption',
			created_at: 1,
			tags: [['t', 'hello']],
			sig: 'c'.repeat(128)
		};
		expect(optimisticReelFromEvent(bare as never)).toBeNull();
	});

	it('stage→echo round-trip through the session stays a single entry', () => {
		const event = signedVideoEvent('f'.repeat(64), 1_700_000_000);
		const optimistic = optimisticReelFromEvent(event)!;
		const staged = reconcileOptimisticReel(bitzSession.reels, optimistic).reels;
		// The relay echo parses to the SAME event → same id → in-place merge.
		const echo = optimisticReelFromEvent(event)!;
		const reconciled = reconcileOptimisticReel(staged, echo);
		expect(reconciled.reels).toHaveLength(1);
		expect(reconciled.inserted).toBe(false);
		expect(reconciled.replaced).toBe(false);
	});
});

describe('feed staging integration shape', () => {
	it('a pending-outbox event id is exactly what applyReels carries', () => {
		const event = signedVideoEvent('f'.repeat(64), 1_700_000_000);
		stageEvent(event as never);
		const optimistic = optimisticReelFromEvent(event)!;
		bitzSession.reels = [optimistic];
		// Relay refresh page does NOT include the echo yet (it is still pending).
		const pageNum = [reel('a'.repeat(64), 100)];
		const pendingIds = new Set([optimistic.id]); // pendingOutbox() view
		const carried = [optimistic].filter(
			(existing) => pendingIds.has(existing.id) && !pageNum.some((n) => n.id === existing.id)
		);
		expect(carried).toHaveLength(1);
		// After the ACK lands the entry graduates — the next refresh carries nothing.
		recordAck(event.id, 'wss://relay.example');
		expect(carried.map((r) => r.id)).toEqual([event.id]);
	});
});

describe('toReelNote', () => {
	it('returns null for a text-only note (no parseable media)', async () => {
		const { toReelNote } = await import('./bitz-session.svelte');
		const note = toReelNote({
			id: 'a'.repeat(64),
			pubkey: 'b'.repeat(64),
			kind: 1,
			content: 'just words',
			created_at: 100,
			tags: []
		});
		expect(note).toBeNull();
	});

	it('maps a kind-22 imeta video to a full ReelNote', async () => {
		const { toReelNote } = await import('./bitz-session.svelte');
		const note = toReelNote({
			id: 'd'.repeat(64),
			pubkey: 'e'.repeat(64),
			kind: 22,
			content: 'caption https://cdn.example/1080.mp4',
			created_at: 200,
			tags: [
				[
					'imeta',
					'url https://cdn.example/1080.mp4',
					'm video/mp4',
					'dim 1080x1920',
					'fallback https://mirror.example/1080.mp4',
					'fallbackrendition variant:https://cdn.example/720.mp4 m video/mp4 dim 720x1280 bitrate 2500k',
					'fallbackrendition variant:https://cdn.example/480.mp4 m video/mp4 dim 480x854 bitrate 1000k'
				]
			],
			sig: 'f'.repeat(128)
		});
		expect(note).not.toBeNull();
		expect(note?.mediaUrl).toBe('https://cdn.example/1080.mp4');
		expect(note?.mediaType).toBe('video');
		expect(note?.mediaFallbacks).toEqual(['https://mirror.example/1080.mp4']);
		expect(note?.mediaRenditions?.map((r) => r.height)).toEqual([1280, 854]);
		// toFeedNote fields pass through
		expect(note?.id).toBe('d'.repeat(64));
		expect(note?.pubkey).toBe('e'.repeat(64));
		expect(note?.createdAt).toBe(200);
		expect(note?.reactions).toEqual([]);
		expect(note?.raw).toBeDefined();
	});

	it('omits mediaRenditions when the event declares no variants', async () => {
		const { toReelNote } = await import('./bitz-session.svelte');
		const note = toReelNote({
			id: '1'.repeat(64),
			pubkey: '2'.repeat(64),
			kind: 22,
			content: 'caption https://cdn.example/1080.mp4',
			created_at: 300,
			tags: [['imeta', 'url https://cdn.example/1080.mp4', 'm video/mp4', 'dim 1080x1920']]
		});
		expect(note?.mediaUrl).toBe('https://cdn.example/1080.mp4');
		expect(note?.mediaRenditions).toBeUndefined();
	});
});
