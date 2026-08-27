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
	/** Color look preset id (remix wire `l`) — applied on studio arrival. */
	lookId?: string;
	relays?: string[];
	imageLayers?: unknown[];
	/** Punch-in zoom windows from the source's meme tag (media-timed). */
	zoomWindows?: unknown[];
	/** Frame-FX windows from the source's meme tag (media-timed). */
	fxWindows?: unknown[];
	speedWindows?: unknown[];
}

/** A sound the creator picked from the Sounds page, staged into the studio
 *  on arrival — completes the "hear it → use it" loop. Synth ids only;
 *  custom library sounds travel by soundId. */
export interface StudioSoundSeed {
	/** 'synth' = a MemeSfxId from the trending catalog; 'custom' = a saved
	 *  library sound (by id, resolved inside the studio). */
	kind: 'synth' | 'custom';
	id: string;
	label?: string;
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
	/** Stage a sound cue at playhead 0 when the Meme Studio opens. */
	soundSeed?: StudioSoundSeed;
}

// Module-level $state: read/write directly (no getter/setter indirection —
// the rune unwraps at module scope).
let handoff = $state<StudioHandoff | null>(null);

// A normal client-side navigation keeps this module alive. Persist the one
// pending handoff for the lifetime of the tab as well: Remix loads a large lazy
// editor route, and a reload during that transition should still open the source
// rather than a blank studio. It is intentionally session-only, never a draft.
const HANDOFF_STORAGE_KEY = 'bitos:studio-handoff:v1';

function saveHandoff(next: StudioHandoff | null): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		if (next) sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(next));
		else sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
	} catch {
		// Storage may be unavailable; module state still covers normal navigation.
	}
}

function storedHandoff(): StudioHandoff | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(HANDOFF_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StudioHandoff;
		return parsed?.tab === 'meme' || parsed?.tab === 'bitz' ? parsed : null;
	} catch {
		return null;
	}
}

function setHandoff(next: StudioHandoff | null): void {
	handoff = next;
	saveHandoff(next);
}

export const studioHandoff = {
	/** Queue a handoff (replaces any pending one) and navigate to the studio.
	 *  The tab always rides the URL so deep links / refreshes / share targets
	 *  keep their surface (?tab=meme / ?tab=bitz — never a tabless /create). */
	openInStudio(tab: CreateTab, remix?: StudioRemixHandoff) {
		setHandoff({ tab, ...(remix ? { remix } : {}) });
		return goto(`/studio/create?tab=${tab}`);
	},
	/** Resume a saved draft slot in the Meme Studio. */
	resumeSlot(slotId: string) {
		setHandoff({ tab: 'meme', resumeSlotId: slotId });
		return goto('/studio/create?tab=meme');
	},
	/** Start a fresh meme with a saved layout pre-applied. */
	useTemplate(templateId: string, overlays: MemeTextOverlay[]) {
		setHandoff({ tab: 'meme', template: { id: templateId, overlays } });
		return goto('/studio/create?tab=meme');
	},
	/** Open the Meme Studio with a picked sound staged as the first cue —
	 *  the /more/sounds "Use sound" button lands here. */
	useSound(seed: StudioSoundSeed) {
		setHandoff({ tab: 'meme', soundSeed: seed });
		return goto('/studio/create?tab=meme');
	},
	/** Consume the pending handoff (one-shot — returns null after). */
	take(): StudioHandoff | null {
		const pending = handoff ?? storedHandoff();
		setHandoff(null);
		return pending;
	}
};
