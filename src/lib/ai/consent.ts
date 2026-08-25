/**
 * Auto Meme AI consent boundary (AI-003, Phase 7 deliverable
 * "local-first inference where practical and explicit cloud consent
 * otherwise" + section 21.4 "consent mode prevents forbidden network
 * payload").
 *
 * Invariants under test:
 *   - cloud detectors are unreachable unless consent is explicitly granted
 *     (default is LOCAL_ONLY; no detector call may fire before the flag)
 *   - consent is per-device persisted and revocable; revocation drops any
 *     in-flight gate immediately (next call throws)
 *   - payloads that would leave the device carry only the fields the cloud
 *     needs - never contact lists, keys, or unrelated clip metadata
 */
import { browser } from '$app/environment';
import type { CaptionTextDetector, FaceDetector, FaceBox, SpeechSegment } from './extract';

export type MemeAiConsentMode = 'local-only' | 'cloud-allowed';

export interface MemeAiConsentState {
	mode: MemeAiConsentMode;
	/** When cloud was granted, for settings display; cleared on revoke. */
	grantedAt: number | null;
}

const STORAGE_KEY = 'bitos:meme-ai-consent';

let state: MemeAiConsentState = { mode: 'local-only', grantedAt: null };
const listeners = new Set<(state: MemeAiConsentState) => void>();

function persist() {
	if (!browser) return;
	if (state.mode === 'cloud-allowed') {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} else {
		localStorage.removeItem(STORAGE_KEY);
	}
}

/** Current consent snapshot (defensive copy). */
export function memeAiConsent(): MemeAiConsentState {
	return { ...state };
}

export function allowCloudAi() {
	state = { mode: 'cloud-allowed', grantedAt: Date.now() };
	persist();
	for (const listener of listeners) listener(memeAiConsent());
}

export function revokeCloudAi() {
	state = { mode: 'local-only', grantedAt: null };
	persist();
	for (const listener of listeners) listener(memeAiConsent());
}

export function onMemeAiConsentChange(listener: (state: MemeAiConsentState) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Restore persisted consent after reload; anything unreadable = revoked. */
export function restoreMemeAiConsent(): boolean {
	if (!browser) return false;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return false;
	try {
		const parsed = JSON.parse(raw) as MemeAiConsentState;
		if (parsed.mode === 'cloud-allowed' && typeof parsed.grantedAt === 'number') {
			state = { mode: 'cloud-allowed', grantedAt: parsed.grantedAt };
			return true;
		}
	} catch {
		/* fall through to revoke */
	}
	revokeCloudAi();
	return false;
}

/** Error thrown when a cloud call is attempted without consent. */
export class ConsentRequiredError extends Error {
	constructor() {
		super('Cloud AI is not allowed — grant consent or stay local-only.');
		this.name = 'ConsentRequiredError';
	}
}

export interface CloudCaptionPayload {
	kind: 'transcribe';
	startSec: number;
	endSec: number;
	/** Mono PCM base64 or similar - ONLY the audio span, nothing else. */
	audio: string;
}

export interface CloudFacePayload {
	kind: 'detect-faces';
	atSec: number;
	/** ONLY the frame pixels, nothing else. */
	frame: string;
}

export type MemeAiCloudPayload = CloudCaptionPayload | CloudFacePayload;

/**
 * The ONLY door to cloud services. Wraps cloud detector implementations
 * behind a consent check evaluated at CALL time (not at wiring time), so a
 * revoked consent can never be bypassed by a captured closure.
 */
export function cloudDetectorGate(
	transport: (payload: MemeAiCloudPayload) => Promise<string | null>
): { captions: CaptionTextDetector; faces: FaceDetector } {
	const assertAllowed = () => {
		if (state.mode !== 'cloud-allowed') throw new ConsentRequiredError();
	};
	return {
		captions: async (segment: SpeechSegment) => {
			assertAllowed();
			const audio = `pcm:${segment.startSec.toFixed(2)}-${segment.endSec.toFixed(2)}`;
			const text = await transport({
				kind: 'transcribe',
				startSec: segment.startSec,
				endSec: segment.endSec,
				audio
			});
			return text?.trim() || null;
		},
		faces: async (atSec: number): Promise<FaceBox[]> => {
			assertAllowed();
			const raw = await transport({
				kind: 'detect-faces',
				atSec,
				frame: `frame:${atSec.toFixed(2)}`
			});
			if (!raw) return [];
			try {
				const boxes = JSON.parse(raw) as FaceBox[];
				return Array.isArray(boxes)
					? boxes.filter(
							(b) =>
								typeof b?.x === 'number' &&
								typeof b?.y === 'number' &&
								typeof b?.width === 'number' &&
								typeof b?.height === 'number'
						)
					: [];
			} catch {
				return [];
			}
		}
	};
}
