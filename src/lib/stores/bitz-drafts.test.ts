import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
});

const {
	readBitzDraft,
	createBitzDraftWriter,
	validateDraftForPublish,
	draftTrimToSeconds,
	BITZ_DRAFT_KEY,
	BITZ_DRAFT_VERSION
} = await import('./bitz-drafts');

function seedDraft(overrides: Record<string, unknown> = {}) {
	const draft = {
		version: BITZ_DRAFT_VERSION,
		savedAt: 1_700_000_000_000,
		mediaKind: 'video',
		file: { name: 'clip.mp4', size: 12_345, mimeType: 'video/mp4' },
		meta: { width: 1080, height: 1920, duration: 12.5 },
		trim: { in_ms: 1500, out_ms: 9000 },
		cover: 'https://cdn.example/cover.jpg',
		caption: 'hello bitz',
		sensitive: false,
		upload: {
			providerId: 'blossom',
			url: 'https://blossom.example/blob.mp4',
			sha256: 'a'.repeat(64),
			mimeType: 'video/mp4',
			bytes: 12_345,
			uploadedAt: 1_700_000_000_001
		},
		...overrides
	};
	memory.set(BITZ_DRAFT_KEY, JSON.stringify(draft));
	return draft;
}

beforeEach(() => {
	memory.clear();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('readBitzDraft', () => {
	it('returns null when storage is empty', () => {
		expect(readBitzDraft()).toBeNull();
	});

	it('round-trips a complete video draft', () => {
		seedDraft();
		const draft = readBitzDraft();
		expect(draft).not.toBeNull();
		expect(draft!.mediaKind).toBe('video');
		expect(draft!.trim).toEqual({ in_ms: 1500, out_ms: 9000 });
		expect(draft!.cover).toBe('https://cdn.example/cover.jpg');
		expect(draft!.upload?.sha256).toBe('a'.repeat(64));
	});

	it('rejects foreign versions', () => {
		seedDraft({ version: 99 });
		expect(readBitzDraft()).toBeNull();
	});

	it('rejects corrupted JSON', () => {
		memory.set(BITZ_DRAFT_KEY, '{not json');
		expect(readBitzDraft()).toBeNull();
	});

	it('normalizes an inverted trim window on restore', () => {
		seedDraft({ trim: { in_ms: 9000, out_ms: 1500 } });
		const draft = readBitzDraft();
		// normalizeTrim swaps inverted windows inside the source duration.
		expect(draft!.trim.in_ms).toBeLessThanOrEqual(draft!.trim.out_ms);
	});

	it('clamps the trim window to the source duration', () => {
		seedDraft({ trim: { in_ms: 0, out_ms: 9_000_000 } });
		const draft = readBitzDraft();
		expect(draft!.trim.out_ms).toBeLessThanOrEqual(12_500);
	});

	it('drops upload checkpoints with nonsense URLs', () => {
		seedDraft({
			upload: { providerId: 'x', url: 'javascript:alert(1)', mimeType: 'video/mp4', bytes: 1 }
		});
		const draft = readBitzDraft();
		expect(draft!.upload).toBeNull();
	});

	it('drops malformed sha256 but keeps the checkpoint', () => {
		seedDraft({
			upload: {
				providerId: 'b',
				url: 'https://b.example/x',
				sha256: 'nothex',
				mimeType: 'video/mp4',
				bytes: 2
			}
		});
		const draft = readBitzDraft();
		expect(draft!.upload).not.toBeNull();
		expect(draft!.upload?.sha256).toBeUndefined();
	});

	it('keeps image drafts without trim/meta duration', () => {
		seedDraft({
			mediaKind: 'image',
			meta: { width: 800, height: 600 },
			trim: { in_ms: 0, out_ms: 0 }
		});
		const draft = readBitzDraft();
		expect(draft!.mediaKind).toBe('image');
		expect(draft!.meta?.duration).toBeUndefined();
	});
});

describe('draftTrimToSeconds + draftHasEdit', () => {
	it('converts ms timeline to a seconds range', () => {
		expect(draftTrimToSeconds({ in_ms: 1500, out_ms: 9000 })).toEqual({
			inSeconds: 1.5,
			outSeconds: 9
		});
	});
});

describe('validateDraftForPublish', () => {
	it('accepts a valid trimmed draft', () => {
		seedDraft();
		const draft = readBitzDraft()!;
		const result = validateDraftForPublish(draft);
		expect(result.valid).toBe(true);
	});

	it('flags drafts without probed metadata', () => {
		seedDraft({ meta: null });
		const draft = readBitzDraft()!;
		expect(validateDraftForPublish(draft)).toEqual({ valid: false, reason: 'missing-meta' });
	});

	it('flags over-cap trim windows', () => {
		seedDraft({
			meta: { width: 1080, height: 1920, duration: 120 },
			trim: { in_ms: 0, out_ms: 120_000 }
		});
		const draft = readBitzDraft()!;
		const result = validateDraftForPublish(draft);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('invalid-trim');
		expect(result.trimValidation?.reason).toBe('over-publish-cap');
	});
});

describe('createBitzDraftWriter', () => {
	it('debounces writes', () => {
		vi.useFakeTimers();
		try {
			const writer = createBitzDraftWriter();
			writer.write({
				mediaKind: 'video',
				file: { name: 'a.mp4', size: 1, mimeType: 'video/mp4' },
				meta: { width: 10, height: 20, duration: 5 },
				trim: { inSeconds: 1, outSeconds: 4 },
				cover: null,
				caption: 'draft one',
				sensitive: false,
				upload: null
			});
			writer.write({
				mediaKind: 'video',
				file: { name: 'a.mp4', size: 1, mimeType: 'video/mp4' },
				meta: { width: 10, height: 20, duration: 5 },
				trim: { inSeconds: 1, outSeconds: 4 },
				cover: null,
				caption: 'draft two',
				sensitive: false,
				upload: null
			});
			expect(memory.has(BITZ_DRAFT_KEY)).toBe(false);
			vi.advanceTimersByTime(600);
			const stored = readBitzDraft();
			expect(stored?.caption).toBe('draft two');
		} finally {
			vi.useRealTimers();
		}
	});

	it('flush forces an immediate write', () => {
		const writer = createBitzDraftWriter();
		writer.write({
			mediaKind: 'image',
			file: { name: 'p.jpg', size: 9, mimeType: 'image/jpeg' },
			meta: { width: 4, height: 4 },
			trim: { inSeconds: 0, outSeconds: 0 },
			cover: null,
			caption: 'flushed',
			sensitive: false,
			upload: null
		});
		writer.flush();
		expect(readBitzDraft()?.caption).toBe('flushed');
	});

	it('clear removes the draft', () => {
		seedDraft();
		expect(readBitzDraft()).not.toBeNull();
		createBitzDraftWriter().clear();
		expect(readBitzDraft()).toBeNull();
	});

	it('takes no action when empty', () => {
		expect(readBitzDraft()).toBeNull();
	});
});
