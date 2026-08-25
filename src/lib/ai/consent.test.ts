import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
});

const {
	ConsentRequiredError,
	allowCloudAi,
	cloudDetectorGate,
	memeAiConsent,
	onMemeAiConsentChange,
	restoreMemeAiConsent,
	revokeCloudAi
} = await import('./consent');

beforeEach(() => {
	memory.clear();
	revokeCloudAi();
});

describe('consent default + persistence', () => {
	it('defaults to local-only with no grant timestamp', () => {
		expect(memeAiConsent()).toEqual({ mode: 'local-only', grantedAt: null });
	});

	it('persists grant and restores it after reload', () => {
		allowCloudAi();
		expect(memeAiConsent().mode).toBe('cloud-allowed');
		expect(memeAiConsent().grantedAt).toBeGreaterThan(0);
		// reload path
		revokeCloudAi();
		memory.set('bitos:meme-ai-consent', JSON.stringify({ mode: 'cloud-allowed', grantedAt: 123 }));
		expect(restoreMemeAiConsent()).toBe(true);
		expect(memeAiConsent().grantedAt).toBe(123);
	});

	it('revocation clears storage and the timestamp', () => {
		allowCloudAi();
		revokeCloudAi();
		expect(memory.has('bitos:meme-ai-consent')).toBe(false);
		expect(memeAiConsent()).toEqual({ mode: 'local-only', grantedAt: null });
	});

	it('corrupt persisted state revokes rather than guessing', () => {
		memory.set('bitos:meme-ai-consent', '{not json');
		expect(restoreMemeAiConsent()).toBe(false);
		expect(memeAiConsent().mode).toBe('local-only');
	});

	it('notifies listeners on both grant and revoke', () => {
		const seen: string[] = [];
		const off = onMemeAiConsentChange((s) => seen.push(s.mode));
		allowCloudAi();
		revokeCloudAi();
		off();
		allowCloudAi(); // unsubscribed - not recorded
		expect(seen).toEqual(['cloud-allowed', 'local-only']);
	});
});

describe('cloudDetectorGate (data boundary)', () => {
	it('throws ConsentRequiredError BEFORE any transport call when local-only', async () => {
		const transport = vi.fn(async () => 'text');
		const gate = cloudDetectorGate(transport);
		await expect(gate.captions({ startSec: 0, endSec: 1 })).rejects.toBeInstanceOf(
			ConsentRequiredError
		);
		await expect(gate.faces(1.5)).rejects.toBeInstanceOf(ConsentRequiredError);
		expect(transport).not.toHaveBeenCalled();
	});

	it('a gate captured while allowed refuses after revocation (call-time check)', async () => {
		allowCloudAi();
		const gate = cloudDetectorGate(async () => 'held');
		revokeCloudAi();
		await expect(gate.captions({ startSec: 0, endSec: 1 })).rejects.toThrow(/not allowed/);
	});

	it('caption payloads carry ONLY the audio span - no profile, keys, or clip metadata', async () => {
		allowCloudAi();
		const payloads: unknown[] = [];
		const gate = cloudDetectorGate(async (payload) => {
			payloads.push(payload);
			return '  hello  ';
		});
		const text = await gate.captions({ startSec: 1.25, endSec: 2.5 });
		expect(text).toBe('hello');
		expect(payloads).toEqual([
			{ kind: 'transcribe', startSec: 1.25, endSec: 2.5, audio: 'pcm:1.25-2.50' }
		]);
		const flat = JSON.stringify(payloads[0]);
		for (const forbidden of ['contacts', 'pubkey', 'sk', 'caption', 'allowances']) {
			expect(flat).not.toContain(forbidden);
		}
	});

	it('face payloads carry only frame + timestamp; malformed box JSON degrades to []', async () => {
		allowCloudAi();
		const payloads: unknown[] = [];
		const gate = cloudDetectorGate(async (payload) => {
			payloads.push(payload);
			return payload.kind === 'detect-faces'
				? JSON.stringify([{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, { x: 'bad' }])
				: null;
		});
		const boxes = await gate.faces(3.2);
		expect(payloads[0]).toEqual({ kind: 'detect-faces', atSec: 3.2, frame: 'frame:3.20' });
		expect(boxes).toEqual([{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }]);
		// Garbage transport reply - never crashes the pipeline.
		const broken = cloudDetectorGate(async () => {
			throw new Error('network');
		});
		await expect(broken.faces(1)).rejects.toThrow('network');
	});
});
