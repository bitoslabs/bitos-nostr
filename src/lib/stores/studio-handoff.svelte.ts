/**
 * Studio handoffs — the tiny session bridge that lets any surface say
 * "open /create with this" (a remix source, a preferred tab) without
 * either side importing the multi-megabyte studio components.
 *
 * The feed Composer and the Bitz page `goto('/create')`; the /create route
 * is the ONLY place that statically imports the studios. Everyone else just
 * drops a payload here — zero studio bytes on their bundles.
 */

import { goto } from '$app/navigation';
import type { MemeTextOverlay } from '$lib/meme/schema';

/** Remix chain payload (mirrors MemeStudio's RemixHandoff — structural). */
export interface StudioRemixHandoff {
	eventId: string;
	pubkey: string;
	label?: string;
	mediaUrl: string;
	mediaType: 'image' | 'video';
	overlays: unknown[];
	sfxCues: unknown[];
	relays?: string[];
	imageLayers?: unknown[];
}

/** Which studio the /studio/create page should open with. */
export type CreateTab = 'meme' | 'bitz';

export interface StudioHandoff {
	tab: CreateTab;
	remix?: StudioRemixHandoff;
	/** Restore a named WIP slot (meme-slots store) on arrival. */
	resumeSlotId?: string;
	/** Apply a saved layout template (meme-templates store) on arrival. */
	template?: { id: string; overlays: MemeTextOverlay[] };
}

// Module-level $state: read/write directly (no getter/setter indirection —
// the rune unwraps at module scope).
let handoff = $state<StudioHandoff | null>(null);

export const studioHandoff = {
	/** Queue a handoff (replaces any pending one) and navigate to the studio.
	 *  The tab always rides the URL so deep links / refreshes / share targets
	 *  keep their surface (?tab=meme / ?tab=bitz — never a tabless /create). */
	openInStudio(tab: CreateTab, remix?: StudioRemixHandoff) {
		handoff = { tab, ...(remix ? { remix } : {}) };
		void goto(`/studio/create?tab=${tab}`);
	},
	/** Resume a saved draft slot in the Meme Studio. */
	resumeSlot(slotId: string) {
		handoff = { tab: 'meme', resumeSlotId: slotId };
		void goto('/studio/create?tab=meme');
	},
	/** Start a fresh meme with a saved layout pre-applied. */
	useTemplate(templateId: string, overlays: MemeTextOverlay[]) {
		handoff = { tab: 'meme', template: { id: templateId, overlays } };
		void goto('/studio/create?tab=meme');
	},
	/** Consume the pending handoff (one-shot — returns null after). */
	take(): StudioHandoff | null {
		const pending = handoff;
		handoff = null;
		return pending;
	}
};
