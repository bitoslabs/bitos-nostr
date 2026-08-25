import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
});

const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure');
const { hexToBytes } = await import('$lib/nostr/hex');
const { identity } = await import('$lib/nostr/identity.svelte');
const { LocalSigner, TestSigner, activeSigner, signMined } = await import('./signer');

const SECRET = '01'.repeat(32); // deterministic test key — never a production key

beforeEach(() => {
	memory.clear();
	identity.current = null;
});

describe('LocalSigner', () => {
	it('isAvailable false with no identity, true once loaded', async () => {
		const signer = new LocalSigner();
		expect(await signer.isAvailable()).toBe(false);
		identity.importSecret(SECRET);
		expect(await signer.isAvailable()).toBe(true);
	});

	it('getPublicKey returns the active identity pk', async () => {
		identity.importSecret(SECRET);
		const signer = new LocalSigner();
		expect(await signer.getPublicKey()).toBe(getPublicKey(hexToBytes(SECRET)));
	});

	it('getPublicKey throws with no identity', async () => {
		const signer = new LocalSigner();
		await expect(signer.getPublicKey()).rejects.toThrow('No identity');
	});

	it('sign produces a valid signature over the given template', async () => {
		identity.importSecret(SECRET);
		const signer = new LocalSigner();
		const event = await signer.sign({
			kind: 1984,
			content: 'spam',
			created_at: 1_700_000_000,
			tags: [
				['p', 'f'.repeat(64)],
				['report', 'spam']
			]
		});
		// Same template ⇒ same id/fields; sig is valid for the identity key.
		// (BIP-340 signing uses auxiliary randomness, so sig bytes are not
		// byte-comparable across two finalizeEvent calls.)
		const expected = finalizeEvent(
			{
				kind: 1984,
				content: 'spam',
				created_at: 1_700_000_000,
				tags: [
					['p', 'f'.repeat(64)],
					['report', 'spam']
				]
			},
			hexToBytes(SECRET)
		);
		const pickCore = ({ id, content, kind, created_at, tags, pubkey }: typeof event) => ({
			id,
			content,
			kind,
			created_at,
			tags,
			pubkey
		});
		expect(pickCore(event)).toEqual(pickCore(expected));
		expect(event.pubkey).toBe(getPublicKey(hexToBytes(SECRET)));
		expect(event.sig).toHaveLength(128);
	});

	it('sign throws with no identity', async () => {
		const signer = new LocalSigner();
		await expect(signer.sign({ kind: 1, content: 'x', created_at: 1, tags: [] })).rejects.toThrow(
			'No identity'
		);
	});

	it('reads the key at call time — account switch changes the signer output', async () => {
		const signer = new LocalSigner();
		identity.importSecret(SECRET);
		const first = await signer.getPublicKey();
		identity.current = null;
		await expect(signer.getPublicKey()).rejects.toThrow('No identity');
		expect(first).toBe(getPublicKey(hexToBytes(SECRET)));
	});
});

describe('TestSigner', () => {
	it('signs deterministically from a fixed secret', async () => {
		const signer = new TestSigner(SECRET);
		expect(await signer.isAvailable()).toBe(true);
		expect(await signer.getPublicKey()).toBe(getPublicKey(hexToBytes(SECRET)));
		const event = await signer.sign({
			kind: 10002,
			content: '',
			created_at: 42,
			tags: [['r', 'wss://relay.example']]
		});
		expect(event.pubkey).toBe(signer.pubkey);
		expect(event.sig).toHaveLength(128);
	});

	it('rejects non-hex secrets', () => {
		expect(() => new TestSigner('not-hex')).toThrow('64-char hex');
	});
});

describe('activeSigner', () => {
	it('returns a LocalSigner (single seam for future NIP-46/NIP-55)', async () => {
		const signer = activeSigner();
		expect(signer).toBeInstanceOf(LocalSigner);
		expect(signer).not.toBe(
			signer && (signer as unknown as { brand?: never }).brand === undefined ? null : signer
		); // sanity: defined
	});
});

describe('signMined (PoW publish guard)', () => {
	const template = {
		kind: 1,
		content: 'mined note',
		created_at: 1_700_000_000,
		tags: [['nonce', '1', '20']] as string[][]
	};

	it('signs a mined template and returns the event from the signer', async () => {
		identity.importSecret(SECRET);
		const signer = new LocalSigner();
		const event = await signMined(template, signer);
		expect(event.pubkey).toBe(getPublicKey(hexToBytes(SECRET)));
		expect(event.content).toBe('mined note');
		expect(event.sig).toHaveLength(128);
	});

	it('defaults to activeSigner when no signer is passed', async () => {
		identity.importSecret(SECRET);
		const event = await signMined(template);
		expect(event.pubkey).toBe(getPublicKey(hexToBytes(SECRET)));
	});

	it('aborts when the signing key differs from the pubkey raced alongside it', async () => {
		// Account switch mid-mining: signer.sign uses one key while
		// getPublicKey observes another — the guard must refuse to publish.
		const switcher = new TestSigner(SECRET);
		const other = new TestSigner('02'.repeat(32));
		const flipped = {
			sign: (t: unknown) => other.sign(t as never),
			getPublicKey: () => switcher.getPublicKey(),
			isAvailable: () => Promise.resolve(true)
		};
		await expect(signMined(template, flipped)).rejects.toThrow(
			'Signer pubkey changed during publish'
		);
	});
});

describe('pubkey secret hygiene', () => {
	it('signer module never exports raw key material', async () => {
		const mod = await import('./signer');
		const exported = Object.keys(mod);
		for (const name of exported) {
			const value = (mod as Record<string, unknown>)[name];
			expect(value).not.toContain?.(SECRET);
		}
		expect(exported).toContain('activeSigner');
	});
});
