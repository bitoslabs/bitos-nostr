import { describe, expect, it } from 'vitest';
import {
	applyRemixPayload,
	canRemix,
	decodeRemixPayload,
	encodeRemixPayload,
	isRemixLicense,
	remixChainOf,
	remixLayoutOf,
	remixOf,
	remixSourceKey,
	remixTagsFor,
	rightsOf,
	rightsTagsFor,
	wouldCycle
} from './remix';
import { makeClassicPair, makeOverlay, normalizeSfxCue } from './schema';

const SOURCE = { eventId: 'ab'.repeat(32), pubkey: 'cd'.repeat(32), relays: ['wss://relay.one'] };

describe('encode/decode payload', () => {
	it('round-trips overlays + cues through the compact wire form', () => {
		const overlays = [
			makeOverlay({ text: 'WHEN THE CODE', y: 0.12, color: '#fde047', bar: true }),
			makeOverlay({ text: 'SHIPS ON FRIDAY', y: 0.86, caps: false })
		];
		const sfxCues = [
			normalizeSfxCue({ sfx: 'boom', atMs: 1500, gain: 0.8 })!,
			normalizeSfxCue({ sfx: 'custom', soundId: 'snd-1', atMs: 900, gain: 1 })!
		];
		const encoded = encodeRemixPayload({ overlays, sfxCues });
		expect(encoded.length).toBeLessThan(700);
		const back = decodeRemixPayload(encoded)!;
		expect(back.overlays.map((o) => o.text)).toEqual(['WHEN THE CODE', 'SHIPS ON FRIDAY']);
		expect(back.overlays[0]!.color).toBe('#fde047');
		expect(back.overlays[0]!.bar).toBe(true);
		expect(back.overlays[1]!.caps).toBe(false);
		// cues keep their time + gain
		const boom = back.sfxCues.find((c) => c.sfx === 'boom')!;
		expect(boom.atMs).toBe(1500);
		expect(boom.gain).toBe(0.8);
		const custom = back.sfxCues.find((c) => c.sfx === 'custom')!;
		expect(custom.soundId).toBe('snd-1');
	});

	it('round-trips a color look (wire `l`) and omits it when none', () => {
		const overlay = makeOverlay({ text: 'gm' });
		// noir rides; unknown ids degrade to absent (not a crash, not garbage)
		const withLook = decodeRemixPayload(
			encodeRemixPayload({ overlays: [overlay], sfxCues: [], lookId: 'noir' })
		)!;
		expect(withLook.lookId).toBe('noir');
		const unknownLook = decodeRemixPayload(
			encodeRemixPayload({ overlays: [overlay], sfxCues: [], lookId: 'bogus' as never })
		)!;
		expect(unknownLook.lookId).toBeUndefined();
		const noLook = JSON.parse(
			encodeRemixPayload({ overlays: [overlay], sfxCues: [], lookId: 'none' })
		) as Record<string, unknown>;
		expect(noLook).not.toHaveProperty('l');
	});

	it('round-trips timed overlay windows', () => {
		const overlay = makeOverlay({ text: 'LATE PUNCHLINE' });
		overlay.startMs = 1200;
		overlay.endMs = 3400;
		const back = decodeRemixPayload(encodeRemixPayload({ overlays: [overlay], sfxCues: [] }))!;
		expect(back.overlays[0]!.startMs).toBe(1200);
		expect(back.overlays[0]!.endMs).toBe(3400);
	});

	it('packs defaults off the wire (smallest possible payload)', () => {
		const overlay = makeOverlay({ text: 'gm' });
		const encoded = encodeRemixPayload({ overlays: [overlay], sfxCues: [] });
		const raw = JSON.parse(encoded) as { o: Record<string, unknown>[] };
		// defaults (caps/stroke true, bar false, impact, white) are omitted
		expect(raw.o[0]).not.toHaveProperty('k');
		expect(raw.o[0]).not.toHaveProperty('o');
		expect(raw.o[0]).not.toHaveProperty('b');
		expect(raw.o[0]).not.toHaveProperty('f');
		expect(raw.o[0]).not.toHaveProperty('c');
	});

	it('rejects malformed payloads', () => {
		expect(decodeRemixPayload(undefined)).toBeNull();
		expect(decodeRemixPayload('not json')).toBeNull();
		expect(decodeRemixPayload('{}')).toBeNull();
		expect(decodeRemixPayload(JSON.stringify({ v: 1, o: 'nope' }))).toBeNull();
	});
});

describe('remix tags', () => {
	it('builds remix + meme + attribution p tags', () => {
		const tags = remixTagsFor(SOURCE, { overlays: makeClassicPair(), sfxCues: [] });
		expect(tags[0]).toEqual(['remix', SOURCE.eventId, 'wss://relay.one']);
		expect(tags[1]![0]).toBe('meme');
		expect(tags[2]).toEqual(['p', SOURCE.pubkey]);
		// lineages read back identically
		expect(remixOf(tags)).toEqual(SOURCE);
		expect(remixLayoutOf(tags)?.overlays).toHaveLength(2);
	});

	it('caps relay hints at three', () => {
		const tags = remixTagsFor(
			{ ...SOURCE, relays: ['wss://a', 'wss://b', 'wss://c', 'wss://d'] },
			{ overlays: [], sfxCues: [] }
		);
		expect(tags[0]).toHaveLength(5); // ['remix', id, a, b, c]
	});

	it('returns null lineage for events without a remix tag', () => {
		expect(remixOf([['t', 'bitz']])).toBeNull();
		expect(remixLayoutOf([['t', 'bitz']])).toBeNull();
	});
});

describe('applyRemixPayload', () => {
	it('carries the look through the clone (fresh ids, same brand)', () => {
		const overlay = makeOverlay({ text: 'gm' });
		const applied = applyRemixPayload({ overlays: [overlay], sfxCues: [], lookId: 'vhs' });
		expect(applied.lookId).toBe('vhs');
		expect(applied.overlays[0]!.id).not.toBe(overlay.id);
	});
	it('clones with fresh ids and normalized rows', () => {
		const original = makeClassicPair();
		const payload = {
			overlays: original,
			sfxCues: [normalizeSfxCue({ sfx: 'ding', atMs: 5, gain: 1 })!]
		};
		const applied = applyRemixPayload(payload);
		expect(applied.overlays.map((o) => o.text)).toEqual(original.map((o) => o.text));
		expect(applied.overlays.map((o) => o.id)).not.toEqual(original.map((o) => o.id));
		expect(applied.sfxCues).toHaveLength(1);
		expect(applied.sfxCues[0]!.id).not.toBe(payload.sfxCues[0]!.id);
	});

	it('drops malformed rows instead of failing', () => {
		const applied = applyRemixPayload({
			overlays: [makeOverlay({ text: 'ok' }), makeOverlay({ text: '' })],
			sfxCues: []
		});
		// empty-text overlay is dropped by normalizeOverlay; the wire decode
		// already drops them, and apply keeps the guarantee for direct clones
		expect(applied.overlays.map((o) => o.text)).toEqual(['ok']);
	});
});

describe('remixSourceKey', () => {
	it('keys a regular event by its id', () => {
		const key = remixSourceKey({
			id: 'ab'.repeat(32),
			pubkey: 'cd'.repeat(32),
			kind: 22,
			tags: [['t', 'bitz']]
		});
		expect(key).toBe(`event:${'ab'.repeat(32)}`);
	});

	it('keys an addressable event by coordinate', () => {
		const key = remixSourceKey({
			id: 'ab'.repeat(32),
			pubkey: 'cd'.repeat(32),
			kind: 34236,
			tags: [['d', 'viral-edit']]
		});
		expect(key).toBe(`addr:34236:${'cd'.repeat(32)}:viral-edit`);
	});
});

describe('remix chain (DAG projection)', () => {
	const id = (n: number) => n.toString(16).padStart(64, '0');
	const tags = (source: { eventId: string; pubkey: string }) => [
		['remix', source.eventId, 'wss://relay.one'],
		['p', source.pubkey]
	];

	it('walks a three-hop chain with depths 0,1,2', async () => {
		const load = async (eventId: string) => {
			if (eventId === id(0)) return tags({ eventId: id(1), pubkey: 'ff'.repeat(32) });
			if (eventId === id(1)) return tags({ eventId: id(2), pubkey: 'ee'.repeat(32) });
			return null;
		};
		const result = await remixChainOf(tags({ eventId: id(0), pubkey: 'ab'.repeat(32) }), load);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.chain.map((a) => a.depth)).toEqual([0, 1, 2]);
		expect(result.chain.map((a) => a.eventId)).toEqual([id(0), id(1), id(2)]);
		expect(result.truncated).toBe(false);
	});

	it('ends the chain when an ancestor is unknown to the loader', async () => {
		const result = await remixChainOf(
			tags({ eventId: id(0), pubkey: 'ab'.repeat(32) }),
			async () => null
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.chain).toHaveLength(1);
		expect(result.truncated).toBe(false);
	});

	it('reports a cycle when an ancestor repeats', async () => {
		const load = async () => tags({ eventId: id(0), pubkey: 'ab'.repeat(32) });
		const result = await remixChainOf(tags({ eventId: id(0), pubkey: 'ab'.repeat(32) }), load);
		expect(result).toEqual({ ok: false, reason: 'cycle' });
	});

	it('truncates beyond MAX_REMIX_DEPTH without treating depth as a cycle', async () => {
		const load = async (eventId: string) => {
			const n = Number.parseInt(eventId.slice(-8), 16);
			return tags({ eventId: id(n + 1), pubkey: 'ab'.repeat(32) });
		};
		const result = await remixChainOf(tags({ eventId: id(0), pubkey: 'ab'.repeat(32) }), load);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.chain).toHaveLength(32);
		expect(result.truncated).toBe(true);
	});

	it('maps a loader throw to loader-error', async () => {
		const result = await remixChainOf(
			tags({ eventId: id(0), pubkey: 'ab'.repeat(32) }),
			async () => {
				throw new Error('relay down');
			}
		);
		expect(result).toEqual({ ok: false, reason: 'loader-error' });
	});
});

describe('wouldCycle (publish guard)', () => {
	const id = (n: number) => n.toString(16).padStart(64, '0');
	const tags = (source: { eventId: string; pubkey: string }) => [
		['remix', source.eventId, 'wss://relay.one'],
		['p', source.pubkey]
	];

	it('allows a fresh chain that never repeats', async () => {
		const load = async (eventId: string) =>
			eventId === id(1) ? tags({ eventId: id(2), pubkey: 'ee'.repeat(32) }) : null;
		expect(await wouldCycle(id(9), { eventId: id(1), pubkey: 'ee'.repeat(32) }, load)).toBe(false);
	});

	it('rejects self-reference outright', async () => {
		expect(
			await wouldCycle(id(1), { eventId: id(1), pubkey: 'ee'.repeat(32) }, async () => null)
		).toBe(true);
	});

	it('rejects when the new id already sits in the ancestry', async () => {
		const load = async (eventId: string) =>
			eventId === id(1) ? tags({ eventId: id(2), pubkey: 'ee'.repeat(32) }) : null;
		expect(await wouldCycle(id(2), { eventId: id(1), pubkey: 'ee'.repeat(32) }, load)).toBe(true);
	});

	it('rejects on loader failure (unknown history must not loop)', async () => {
		expect(
			await wouldCycle(id(9), { eventId: id(1), pubkey: 'ee'.repeat(32) }, async () => {
				throw new Error('offline');
			})
		).toBe(true);
	});
});

/* ------------------------------ remix rights (S-013) ----------------------------- */

describe('rightsTagsFor / rightsOf round-trip', () => {
	it('emits license + attribution and reads them back', () => {
		const tags = rightsTagsFor('CC-BY-4.0', 'clip by @dev dean');
		const rights = rightsOf(tags);
		expect(rights.license).toBe('CC-BY-4.0');
		expect(rights.known).toBe(true);
		expect(rights.remixable).toBe(true);
		expect(rights.attribution).toBe('clip by @dev dean');
	});

	it('omits the attribution tag when no credit is given', () => {
		const tags = rightsTagsFor('CC0-1.0');
		expect(tags).toHaveLength(1);
		expect(rightsOf(tags).attribution).toBe('');
	});

	it('caps attribution text at 140 chars', () => {
		const tags = rightsTagsFor('CC-BY-4.0', 'x'.repeat(300));
		expect(rightsOf(tags).attribution).toHaveLength(140);
	});

	it('does not type-check arbitrary codes', () => {
		// unknown codes still readable (tolerant), but not emittable
		expect(isRemixLicense('WTFPL')).toBe(false);
		expect(rightsOf([['license', 'WTFPL']])).toMatchObject({ known: false, remixable: true });
	});
});

describe('rightsOf advisory semantics (§17.3)', () => {
	it('missing rights tags default permissive — reels are never hidden/blocked', () => {
		const rights = rightsOf([['remix', 'a'.repeat(64)]]);
		expect(rights).toEqual({ license: '', known: false, remixable: true, attribution: '' });
	});

	it('bitz/all-reserved is known and not remixable', () => {
		const rights = rightsOf([['license', 'bitz/all-reserved']]);
		expect(rights.known).toBe(true);
		expect(rights.remixable).toBe(false);
	});

	it('bitz/source-permission is known and not auto-remixable', () => {
		const rights = rightsOf([['license', 'bitz/source-permission']]);
		expect(rights.known).toBe(true);
		expect(rights.remixable).toBe(false);
	});
});

describe('canRemix policy matrix', () => {
	it('permissive licenses offer remix with no prompt', () => {
		expect(canRemix(rightsOf([['license', 'CC0-1.0']]))).toEqual({
			allowed: true,
			requiresAsk: false
		});
	});

	it('restrictive licenses still ALLOW remix but require asking the creator', () => {
		const { allowed, requiresAsk } = canRemix(rightsOf([['license', 'bitz/all-reserved']]));
		// Advisory network: the feature is never removed, only gated behind a prompt.
		expect(allowed).toBe(true);
		expect(requiresAsk).toBe(true);
	});

	it('unknown licenses default to no prompt', () => {
		expect(canRemix(rightsOf([])).requiresAsk).toBe(false);
	});
});

describe('remixOf reads the bitz:edge variant (§17.3 grammar)', () => {
	it('parses ["bitz:edge","remix","event:<id>","1"] with p-tag attribution', () => {
		const src = remixOf([
			['bitz:edge', 'remix', `event:${'a'.repeat(64)}`, '1'],
			['p', 'ee'.repeat(32)]
		]);
		expect(src?.eventId).toBe('a'.repeat(64));
		expect(src?.pubkey).toBe('ee'.repeat(32));
		expect(src?.relays).toEqual([]);
	});

	it('keeps reading the legacy plain `remix` tag', () => {
		const src = remixOf([['remix', 'b'.repeat(64), 'wss://r.example']]);
		expect(src?.eventId).toBe('b'.repeat(64));
		expect(src?.relays).toEqual(['wss://r.example']);
	});
});
