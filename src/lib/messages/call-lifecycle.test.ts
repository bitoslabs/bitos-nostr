import { describe, expect, it } from 'vitest';
import {
	shouldRemoveGroupPeer,
	shouldStartCallTimeout,
	shouldStartReconnectTimeout
} from './call-lifecycle';

describe('call lifecycle rules', () => {
	it('starts setup timeout only for unanswered calls', () => {
		expect(shouldStartCallTimeout(true, 'outgoing')).toBe(true);
		expect(shouldStartCallTimeout(true, 'incoming')).toBe(true);
		expect(shouldStartCallTimeout(true, 'connected')).toBe(false);
		expect(shouldStartCallTimeout(false, 'outgoing')).toBe(false);
	});

	it('starts reconnect timeout only while reconnecting', () => {
		expect(shouldStartReconnectTimeout(true, 'reconnecting')).toBe(true);
		expect(shouldStartReconnectTimeout(true, 'connected')).toBe(false);
		expect(shouldStartReconnectTimeout(false, 'reconnecting')).toBe(false);
	});

	it('removes only failed group peers', () => {
		expect(shouldRemoveGroupPeer(true, 'failed')).toBe(true);
		expect(shouldRemoveGroupPeer(true, 'disconnected')).toBe(false);
		expect(shouldRemoveGroupPeer(false, 'failed')).toBe(false);
	});
});
