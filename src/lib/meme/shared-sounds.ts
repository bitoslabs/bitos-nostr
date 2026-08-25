/**
 * Shared meme sounds over Nostr (user request 2026-08-23, plan §17.1 NIP-78
 * envelope + §17.2 asset model + §29.6 X-004 evidence groundwork).
 *
 * A shared sound is a NIP-78 `kind:30078` addressable event:
 *   d  = com.bitos.bitz:sound:<id>     (namespaced per §17.1)
 *   content = {"schema":"com.bitos.bitz.sound","version":1,
 *              "label":..., "durationSec":..., "mime":...}
 *   tags = url / x (sha-256, §17.2 immutable hash) / license / attribution?
 *          / dim / client
 *
 * Ingestion rules (§17.2): never render/keep a third-party sound unless the
 * declared license permits redistribution (CC0 / CC-BY family here), and
 * verify the fetched bytes against the advertised sha-256 before importing.
 *
 * Pure codec + policy — relay calls and hashing live in the component.
 */

export const SOUND_SCHEMA = 'com.bitos.bitz.sound';
export const SOUND_SCHEMA_VERSION = 1;

/** d-tag namespace prefix for shared sounds (§17.1). */
export const SOUND_D_PREFIX = 'com.bitos.bitz:sound:';

/** Licenses whose redistribution terms permit re-sharing inside memes. */
export const SHAREABLE_LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-NC-4.0'] as const;
export type ShareableLicense = (typeof SHAREABLE_LICENSES)[number];

export function isShareableLicense(code: string): code is ShareableLicense {
	return (SHAREABLE_LICENSES as readonly string[]).includes(code);
}

export interface SharedSound {
	eventId: string;
	/** Library-facing stable id (the d-tag suffix). */
	soundId: string;
	label: string;
	/** Optional public-post body supplied by the publisher. */
	description: string;
	/** Nostr `t` topics, normalized for discovery. */
	topics: string[];
	coverUrl: string;
	durationSec: number;
	mime: string;
	url: string;
	/** Advertised sha-256 hex (x tag) — empty when the author omitted it. */
	sha256: string;
	license: string;
	attribution: string;
	creatorPubkey: string;
	createdAt: number;
}

interface SoundContent {
	label: string;
	durationSec: number;
	mime: string;
	description?: string;
}

/** Build the d-tag + content + tags for publishing a library sound. */
export function sharedSoundEventParts(input: {
	soundId: string;
	label: string;
	durationSec: number;
	mime: string;
	url: string;
	sha256: string;
	license: ShareableLicense;
	attribution?: string;
	description?: string;
	topics?: string[];
	coverUrl?: string;
	clientTag: string[][];
}): { d: string; content: string; tags: string[][] } {
	const tags: string[][] = [
		...input.clientTag,
		['d', `${SOUND_D_PREFIX}${input.soundId}`],
		['url', input.url],
		['license', input.license]
	];
	if (input.sha256) tags.push(['x', input.sha256]);
	if (input.attribution?.trim()) tags.push(['attribution', input.attribution.trim().slice(0, 140)]);
	const topics = [...new Set((input.topics ?? []).map((topic) => topic.trim().toLowerCase()))]
		.filter((topic) => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(topic))
		.slice(0, 10);
	for (const topic of topics) tags.push(['t', topic]);
	if (input.coverUrl?.trim()) tags.push(['image', input.coverUrl.trim().slice(0, 2048)]);
	const content: SoundContent = {
		label: input.label.trim().slice(0, 40) || 'Shared sound',
		durationSec: Math.round(Math.min(input.durationSec, 15) * 1000) / 1000,
		mime: input.mime.slice(0, 64) || 'audio/webm'
	};
	if (input.description?.trim()) content.description = input.description.trim().slice(0, 500);
	return {
		d: `${SOUND_D_PREFIX}${input.soundId}`,
		content: JSON.stringify({ schema: SOUND_SCHEMA, version: SOUND_SCHEMA_VERSION, ...content }),
		tags
	};
}

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Tolerant parse of one candidate event into a SharedSound. Returns null for
 * anything that is not a well-formed shared sound (wrong schema, missing
 * url, bad license declaration, unusable duration…). Readers must never let
 * foreign junk crash the picker.
 */
export function parseSharedSound(event: {
	id: string;
	pubkey: string;
	created_at: number;
	kind: number;
	content: string;
	tags: string[][];
}): SharedSound | null {
	if (event.kind !== 30078) return null;
	const d = event.tags.find((t) => t[0] === 'd' && typeof t[1] === 'string');
	if (!d || !d[1]!.startsWith(SOUND_D_PREFIX)) return null;
	let content: (SoundContent & { schema?: unknown; version?: unknown }) & Record<string, unknown>;
	try {
		const parsed = JSON.parse(event.content) as Record<string, unknown>;
		if (parsed.schema !== SOUND_SCHEMA) return null;
		content = parsed as typeof content;
	} catch {
		return null;
	}
	const url = event.tags.find((t) => t[0] === 'url' && t[1])?.[1];
	if (!url || !/^https?:\/\//i.test(url)) return null;
	const license = event.tags.find((t) => t[0] === 'license' && t[1])?.[1] ?? '';
	if (!isShareableLicense(license)) return null; // §17.2: unknown ⇒ not ingestible
	const duration = Number(content.durationSec);
	if (!Number.isFinite(duration) || duration <= 0 || duration > 15) return null;
	const sha = event.tags.find((t) => t[0] === 'x' && t[1])?.[1] ?? '';
	return {
		eventId: event.id,
		soundId: d[1]!.slice(SOUND_D_PREFIX.length) || event.id.slice(0, 16),
		label:
			(typeof content.label === 'string' && content.label.trim().slice(0, 40)) || 'Shared sound',
		durationSec: Math.round(duration * 1000) / 1000,
		mime: (typeof content.mime === 'string' && content.mime.slice(0, 64)) || 'audio/webm',
		description:
			(typeof content.description === 'string' && content.description.trim().slice(0, 500)) || '',
		topics: [
			...new Set(
				event.tags
					.filter((tag) => tag[0] === 't' && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(tag[1] ?? ''))
					.map((tag) => tag[1]!.toLowerCase())
			)
		].slice(0, 10),
		coverUrl:
			event.tags.find((tag) => tag[0] === 'image' && /^https?:\/\//i.test(tag[1] ?? ''))?.[1] ?? '',
		url,
		sha256: HEX64.test(sha) ? sha.toLowerCase() : '',
		license,
		attribution: event.tags.find((t) => t[0] === 'attribution' && t[1])?.[1]?.slice(0, 140) ?? '',
		creatorPubkey: event.pubkey,
		createdAt: event.created_at
	};
}

/** Rank picker results: newest first; author's own sounds sink (already had them). */
export function rankSharedSounds(sounds: SharedSound[], selfPubkey: string): SharedSound[] {
	return [...sounds].sort((a, b) => {
		const selfA = a.creatorPubkey === selfPubkey ? 1 : 0;
		const selfB = b.creatorPubkey === selfPubkey ? 1 : 0;
		if (selfA !== selfB) return selfA - selfB;
		return b.createdAt - a.createdAt;
	});
}

export type SoundFetch = (url: string) => Promise<{ bytes: Uint8Array; mime: string }>;

/** Verify fetched bytes against the advertised hash (§17.2 immutable asset). */
export async function verifySharedSoundSha256(
	bytes: Uint8Array,
	expected: string,
	sha256Hex: (bytes: Uint8Array) => Promise<string>
): Promise<boolean> {
	if (!HEX64.test(expected)) return false;
	const actual = (await sha256Hex(bytes)).toLowerCase();
	return actual === expected.toLowerCase();
}
