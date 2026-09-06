/**
 * Lightweight, explainable detection for kind-1 notes that carry a protocol
 * payload rather than a message intended for a person to read.  This is not a
 * moderation decision: callers may always offer the payload in an advanced
 * view or let people opt back in.
 */
const ROSTER_HEADER = /^channel:\s*__roster\s*(?:\n|$)/i;

export function isProtocolPayload(content: string): boolean {
	const text = content.trim();
	if (!ROSTER_HEADER.test(text)) return false;

	const body = text.replace(ROSTER_HEADER, '').replace(/\s/g, '');
	// A roster header followed by a sizeable hexadecimal blob is a serialized
	// channel roster, not prose. Requiring both signals avoids hiding ordinary
	// notes that merely mention a channel or a hash.
	return body.length >= 96 && /^[0-9a-f]+$/i.test(body);
}

/**
 * Machine JSON envelopes — kind-1 notes whose entire content is a serialized
 * protocol message (encrypted-mesh handshakes, mix-network beacons, telemetry
 * probes, …) rather than anything a person would read. Real samples seen on
 * the network:
 *
 *   {"v":1,"t":"hello","to":"*","from":"peer_…","hello":{"kemPub":"…"}}   (aegis handshake)
 *   {"v":1,"to":"*","from":"peer_…","t":"mixbeacon"}                      (mix beacon)
 *   {"cipher":"…base64…","iv":"…"}                                        (encrypted transport)
 *   {"sonda":"s5","seq":71,"enviado_ms":…}                                (telemetry probe)
 *
 * The vocabulary evolves constantly (`aegis` rooms today, `skillmsg` probes
 * tomorrow), so instead of chasing tag names we detect the *shape*: a JSON
 * object speaking protocol vocabulary (`v`, `to`, `seq`, `kemPub`, …) and/or
 * carrying long base64/hex blobs, with no prose anywhere.
 */
const ENVELOPE_PROTOCOL_KEYS = new Set([
	'v',
	't',
	'to',
	'from',
	'seq',
	'ts',
	'peerId',
	'room',
	'nym',
	'kemPub',
	'dsaPub',
	'dhPub',
	'sigKemPub',
	'sonda',
	'beacon',
	'cipher',
	'iv',
	'enviado_ms'
]);
/** A ≥120-char unbroken base64/hex run — key material, never prose. */
const BLOB_RUN = /[A-Za-z0-9+/=]{120,}/;
/** Three-plus consecutive whitespace-separated words — if any value reads
 *  like this, a human wrote it, so the note stays in the feed. */
const PROSE = /(?:[\p{L}'’-]{2,}\s+){2}[\p{L}'’-]{2,}/u;

function collectEnvelopeParts(value: unknown, keys: string[], strings: string[]) {
	if (typeof value === 'string') {
		strings.push(value);
	} else if (Array.isArray(value)) {
		for (const item of value) collectEnvelopeParts(item, keys, strings);
	} else if (value && typeof value === 'object') {
		for (const [key, nested] of Object.entries(value)) {
			keys.push(key);
			collectEnvelopeParts(nested, keys, strings);
		}
	}
}

/**
 * True when the content is a machine protocol envelope (see above). Detection
 * is deliberately structural so unknown protocols are caught without a
 * code change; a prose guard keeps human-pasted readable JSON visible.
 */
export function isMachineEnvelope(content: string): boolean {
	const text = content.trim();
	if (text.length < 2 || text[0] !== '{' || !text.endsWith('}')) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return false;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

	const keys: string[] = [];
	const strings: string[] = [];
	collectEnvelopeParts(parsed, keys, strings);

	// Prose guard: any human-readable sentence inside means a person wrote it.
	if (strings.some((value) => PROSE.test(value))) return false;

	// Encrypted transport: an IV alongside a ciphertext is never a message.
	if (keys.includes('cipher') && keys.includes('iv')) return true;

	// Protocol vocabulary: two or more reserved keys (v/t/to/from/seq/…).
	const protocolHits = keys.filter((key) => ENVELOPE_PROTOCOL_KEYS.has(key)).length;
	if (protocolHits >= 2) return true;

	// Key material: a long base64/hex blob in any (nested) value.
	return strings.some((value) => BLOB_RUN.test(value));
}

/**
 * Machine-generated hashtags — coordination tags emitted by bots and relayed
 * swarm protocols, never typed by a person: `udal-friend-<32 hex chars>`,
 * `udal-peer-…`, `aegis<room-hex>`, `aegismixv2`, `skillmsg-s5`, …
 *
 * They are syntactically valid `t` tags, so without this filter they pollute
 * every consumer of note tags: the Topics ranking signal learns to boost them,
 * "Show less about #x" burns a mute on an unrepeatable id, they render as tag
 * chips on cards, and they swamp Trends/Discover counts. `showProtocolNotes`
 * (an explicit user opt-in) can re-admit them where callers pass it through.
 */
const MACHINE_TAG_PATTERN =
	/^(?:udal-(?:friend|peer|node)-[0-9a-f]{8,}|aegis(?:mixv\d+|[0-9a-f]{8,})|skillmsg-\w+)$/i;

export function isMachineTag(tag: string): boolean {
	return MACHINE_TAG_PATTERN.test(tag.trim());
}

/** Filter a tag list down to the human-meaningful entries. */
export function humanTags(tags: string[]): string[] {
	return tags.filter((tag) => !isMachineTag(tag));
}
