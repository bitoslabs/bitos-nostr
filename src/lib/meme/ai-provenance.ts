/**
 * AI-use provenance disclosure (AI-004).
 *
 * When a meme's captions/sounds were placed with machine assistance (the
 * AI-002 suggestion ladder, or any later auto-placement), the published
 * event carries a disclosure tag so provenance survives reposts (plan:
 * "ถ้าใครเอาคลิปไป repost/edit เราก็ยัง trace provenance ได้").
 *
 * Wire form (namespaced, no new NIP — same posture as the 30078 sound
 * envelope): ["ai", "bitz-suggested"] — short, greppable, and trivially
 * tolerant to read back. `aiOf` degrades like every other meme reader:
 * malformed input never breaks a feed render.
 */

/** Marker value written when AI assistance shaped the content. */
export const AI_ASSISTED_MARKER = 'bitz-suggested';

const AI_TAG_NAME = 'ai';

/** Tag stamped on events whose captions/cues came from the AI ladder. */
export function aiAssistedTag(): string[] {
	return [AI_TAG_NAME, AI_ASSISTED_MARKER];
}

/** Tolerant reader: true only when a well-formed assisted marker exists. */
export function aiAssistedOf(tags: string[][] | undefined | null): boolean {
	if (!Array.isArray(tags)) return false;
	return tags.some((tag) => Array.isArray(tag) && tag[0] === AI_TAG_NAME && !!tag[1]);
}
