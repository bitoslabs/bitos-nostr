/**
 * Bitz publish state machine (plan PUB-011, §11.1).
 *
 * Formalizes the composer's inline flow as an explicit machine:
 *
 *   render → verify → sign(+pow) → publish → done
 *
 * Each step is a pure transition over immutable state, with effects supplied
 * by the caller — so the machine is fully unit-testable in the server project
 * and the UI never re-orders pipeline stages. Plan rules encoded here:
 *
 *   • "publish waits for media readiness" — the event is NEVER signed before
 *     the upload descriptor has been verified (hash chain from PUB-006)
 *   • §5.1 "ห้าม publish event ก่อน media ready" — a failed verify halts the
 *     machine in `blocked`, never falls through to sign
 *   • abort/cancel is a first-class transition at every stage
 */

/** Ordered stages — the §11.1 sequence after upload completes. */
export type PublishStage =
	| 'idle'
	| 'rendering'
	| 'verifying'
	| 'signing'
	| 'publishing'
	| 'done'
	| 'blocked'
	| 'cancelled'
	| 'failed';

export interface PublishState {
	stage: PublishStage;
	/** Ordered record of stages the run actually passed through. */
	history: PublishStage[];
	/** Terminal reason when blocked/failed; keyed for UI copy. */
	reason?:
		| 'hash-mismatch'
		| 'missing-descriptor'
		| 'invalid-media'
		| 'sign-failed'
		| 'publish-failed'
		| 'aborted';
	error?: string;
	/** The verified upload descriptor handed to the signer. */
	descriptor?: {
		url: string;
		sha256?: string;
		mimeType: string;
		bytes: number;
	};
	/** Signed event id once publish completes. */
	eventId?: string;
}

export const INITIAL_PUBLISH_STATE: PublishState = { stage: 'idle', history: [] };

interface Descriptor {
	url: string;
	sha256?: string;
	mimeType: string;
	bytes: number;
}

function step(
	state: PublishState,
	stage: PublishStage,
	patch: Partial<PublishState> = {}
): PublishState {
	return { ...state, stage, history: [...state.history, stage], ...patch };
}

/** media readiness before anything is signed (plan §5.1/§21.4). */
export function beginRender(state: PublishState): PublishState {
	if (state.stage !== 'idle') return state;
	return step(state, 'rendering');
}

export function completeRender(state: PublishState, descriptor: Descriptor): PublishState {
	if (state.stage !== 'rendering' && state.stage !== 'idle') return state;
	return step(state, 'verifying', { descriptor });
}

/**
 * Verify the descriptor the provider returned (PUB-006 chain): the URL must
 * exist and any locally-computed hash must match what the descriptor claims.
 */
export function verifyDescriptor(state: PublishState, locals: { sha256?: string }): PublishState {
	if (state.stage !== 'verifying') return state;
	const d = state.descriptor;
	if (!d || !/^https?:\/\//i.test(d.url)) {
		return step(state, 'blocked', {
			reason: 'missing-descriptor',
			error: 'Upload descriptor is missing a usable URL'
		});
	}
	if (locals.sha256 && d.sha256 && locals.sha256 !== d.sha256) {
		return step(state, 'blocked', {
			reason: 'hash-mismatch',
			error: 'Provider stored different bytes than were hashed locally'
		});
	}
	return step(state, 'signing');
}

export function completeSign(state: PublishState): PublishState {
	if (state.stage !== 'signing') return state;
	return step(state, 'publishing');
}

export function completePublish(state: PublishState, eventId: string): PublishState {
	if (state.stage !== 'publishing') return state;
	return step(state, 'done', { eventId });
}

export function failSign(state: PublishState, error: string): PublishState {
	if (state.stage !== 'signing') return state;
	return step(state, 'failed', { reason: 'sign-failed', error });
}

export function failPublish(state: PublishState, error: string): PublishState {
	if (state.stage !== 'publishing') return state;
	return step(state, 'failed', { reason: 'publish-failed', error });
}

/** Cancel at any pre-terminal stage; idempotent afterwards. */
export function cancel(state: PublishState, why = 'aborted'): PublishState {
	if (state.stage === 'done' || state.stage === 'cancelled') return state;
	return step(state, 'cancelled', { reason: 'aborted', error: why });
}

/** Whether a run reached its terminal outcome. */
export function isTerminal(state: PublishState): boolean {
	return (
		state.stage === 'done' ||
		state.stage === 'failed' ||
		state.stage === 'blocked' ||
		state.stage === 'cancelled'
	);
}

/**
 * Labels for progress UI — one line per stage the run is in or passed.
 * Derives the phase feed.postBitz's onPhase callback expects.
 */
export function phaseForStage(stage: PublishStage): 'mining' | 'publishing' | null {
	if (stage === 'signing') return 'mining';
	if (stage === 'publishing') return 'publishing';
	return null;
}

/**
 * Drive a full run from verified inputs using injected effects (test seam).
 * The composer calls the transitions directly so it can interleave toasts;
 * tests (and the future headless coordinator) use this.
 */
export async function runPublishMachine(
	input: { descriptor: Descriptor; localSha256?: string },
	effects: {
		sign: (state: PublishState) => Promise<void>;
		publish: (state: PublishState) => Promise<string>;
	}
): Promise<PublishState> {
	let state: PublishState = INITIAL_PUBLISH_STATE;
	state = completeRender(state, input.descriptor);
	state = verifyDescriptor(state, { sha256: input.localSha256 });
	if (state.stage !== 'signing') return state;
	try {
		await effects.sign(state);
	} catch (e) {
		return failSign(state, (e as Error).message);
	}
	state = completeSign(state);
	try {
		const eventId = await effects.publish(state);
		return completePublish(state, eventId);
	} catch (e) {
		return failPublish(state, (e as Error).message);
	}
}
