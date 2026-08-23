import { describe, expect, it } from 'vitest';
import {
	INITIAL_PUBLISH_STATE,
	beginRender,
	cancel,
	completePublish,
	completeRender,
	completeSign,
	failPublish,
	failSign,
	isTerminal,
	phaseForStage,
	runPublishMachine,
	verifyDescriptor
} from '$lib/media/publish-machine';

const descriptor = {
	url: 'https://blossom.example/abc.mp4',
	sha256: 'a'.repeat(64),
	mimeType: 'video/mp4',
	bytes: 1234
};

function rendered() {
	const s = beginRender(INITIAL_PUBLISH_STATE);
	return completeRender(s, descriptor);
}

describe('stage transitions', () => {
	it('walks the happy path render → verify → sign → publish → done', () => {
		let s = rendered();
		expect(s.stage).toBe('verifying');
		expect(s.descriptor?.url).toBe(descriptor.url);
		s = verifyDescriptor(s, { sha256: descriptor.sha256 });
		expect(s.stage).toBe('signing');
		s = completeSign(s);
		expect(s.stage).toBe('publishing');
		s = completePublish(s, 'event123');
		expect(s.stage).toBe('done');
		expect(s.eventId).toBe('event123');
		expect(s.history).toEqual(['rendering', 'verifying', 'signing', 'publishing', 'done']);
	});

	it('records the stage history in order', () => {
		const s = rendered();
		expect(s.history).toEqual(['rendering', 'verifying']);
	});

	it('ignores transitions from the wrong stage', () => {
		expect(completeSign(INITIAL_PUBLISH_STATE).stage).toBe('idle');
		expect(completePublish(rendered(), 'x').stage).toBe('verifying');
		expect(beginRender(rendered()).stage).toBe('verifying');
	});
});

describe('verifyDescriptor', () => {
	it('blocks on a missing descriptor URL', () => {
		const s = completeRender(INITIAL_PUBLISH_STATE, { ...descriptor, url: '' });
		const out = verifyDescriptor(s, {});
		expect(out.stage).toBe('blocked');
		expect(out.reason).toBe('missing-descriptor');
	});

	it('blocks on a non-http URL', () => {
		const s = completeRender(INITIAL_PUBLISH_STATE, { ...descriptor, url: 'javascript:alert(1)' });
		expect(verifyDescriptor(s, {}).reason).toBe('missing-descriptor');
	});

	it('blocks when local and descriptor hashes disagree', () => {
		const s = rendered();
		const out = verifyDescriptor(s, { sha256: 'b'.repeat(64) });
		expect(out.stage).toBe('blocked');
		expect(out.reason).toBe('hash-mismatch');
	});

	it('passes when either hash side is absent', () => {
		const s = completeRender(INITIAL_PUBLISH_STATE, { ...descriptor, sha256: undefined });
		expect(verifyDescriptor(s, { sha256: 'b'.repeat(64) }).stage).toBe('signing');
		expect(verifyDescriptor(rendered(), {}).stage).toBe('signing');
	});
});

describe('failures and cancellation', () => {
	it('fails sign with a reason', () => {
		const s = verifyDescriptor(rendered(), {});
		const out = failSign(s, 'no signer');
		expect(out.stage).toBe('failed');
		expect(out.reason).toBe('sign-failed');
		expect(out.error).toBe('no signer');
	});

	it('fails publish with a reason', () => {
		const s = completeSign(verifyDescriptor(rendered(), {}));
		const out = failPublish(s, 'relays unreachable');
		expect(out.reason).toBe('publish-failed');
	});

	it('cancels from any active stage and is idempotent at terminals', () => {
		const active = verifyDescriptor(rendered(), {});
		const cancelled = cancel(active);
		expect(cancelled.stage).toBe('cancelled');
		expect(cancel(cancelled).stage).toBe('cancelled');
		const done = completePublish(completeSign(active), 'e1');
		expect(cancel(done).stage).toBe('done');
	});
});

describe('isTerminal + phaseForStage', () => {
	it('marks outcome stages terminal', () => {
		for (const stage of ['done', 'failed', 'blocked', 'cancelled'] as const) {
			expect(isTerminal({ stage, history: [] })).toBe(true);
		}
		for (const stage of ['idle', 'rendering', 'verifying', 'signing', 'publishing'] as const) {
			expect(isTerminal({ stage, history: [] })).toBe(false);
		}
	});

	it('maps stages onto the feed onPhase vocabulary', () => {
		expect(phaseForStage('signing')).toBe('mining');
		expect(phaseForStage('publishing')).toBe('publishing');
		expect(phaseForStage('rendering')).toBeNull();
	});
});

describe('runPublishMachine', () => {
	it('drives the happy path with injected effects', async () => {
		const calls: string[] = [];
		const state = await runPublishMachine(
			{ descriptor, localSha256: descriptor.sha256 },
			{
				sign: async () => void calls.push('sign'),
				publish: async () => {
					calls.push('publish');
					return 'event42';
				}
			}
		);
		expect(state.stage).toBe('done');
		expect(state.eventId).toBe('event42');
		expect(calls).toEqual(['sign', 'publish']);
	});

	it('halts before signing when the hash chain breaks', async () => {
		let signed = false;
		const state = await runPublishMachine(
			{ descriptor, localSha256: 'b'.repeat(64) },
			{
				sign: async () => {
					signed = true;
				},
				publish: async () => 'never'
			}
		);
		expect(state.stage).toBe('blocked');
		expect(signed).toBe(false);
	});

	it('returns sign-failed when the signer throws', async () => {
		const state = await runPublishMachine(
			{ descriptor },
			{
				sign: async () => {
					throw new Error('rejected');
				},
				publish: async () => 'never'
			}
		);
		expect(state.stage).toBe('failed');
		expect(state.reason).toBe('sign-failed');
	});

	it('returns publish-failed when relays reject', async () => {
		const state = await runPublishMachine(
			{ descriptor },
			{
				sign: async () => undefined,
				publish: async () => {
					throw new Error('no relay ACK');
				}
			}
		);
		expect(state.stage).toBe('failed');
		expect(state.reason).toBe('publish-failed');
	});
});
