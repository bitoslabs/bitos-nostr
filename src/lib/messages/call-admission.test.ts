import { describe, expect, it } from 'vitest';
import { canReceiveNewCall, canStartNewCall } from './call-admission';

describe('call admission rules', () => {
	it('allows a new call only while idle', () => {
		expect(canStartNewCall(false, 'idle')).toBe(true);
		expect(canStartNewCall(true, 'idle')).toBe(false);
		expect(canStartNewCall(false, 'connected')).toBe(false);
	});

	it('allows signaling for the currently active call', () => {
		expect(canReceiveNewCall(true, 'connected', true)).toBe(true);
		expect(canReceiveNewCall(true, 'connected', false)).toBe(false);
		expect(canReceiveNewCall(false, 'idle', false)).toBe(true);
	});
});
