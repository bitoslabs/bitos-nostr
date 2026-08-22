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
 * Machine-generated hashtags — coordination tags emitted by bots and relayed
 * swarm protocols, never typed by a person: `udal-friend-<32 hex chars>`,
 * `udal-peer-…`, channel rosters, …
 *
 * They are syntactically valid `t` tags, so without this filter they pollute
 * every consumer of note tags: the Topics ranking signal learns to boost them,
 * "Show less about #x" burns a mute on an unrepeatable id, they render as tag
 * chips on cards, and they swamp Trends/Discover counts. `showProtocolNotes`
 * (an explicit user opt-in) can re-admit them where callers pass it through.
 */
const MACHINE_TAG_PATTERN = /^udal-(?:friend|peer|node)-[0-9a-f]{8,}$/i;

export function isMachineTag(tag: string): boolean {
	return MACHINE_TAG_PATTERN.test(tag.trim());
}

/** Filter a tag list down to the human-meaningful entries. */
export function humanTags(tags: string[]): string[] {
	return tags.filter((tag) => !isMachineTag(tag));
}
