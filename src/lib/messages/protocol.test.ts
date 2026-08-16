import { describe, expect, it } from 'vitest';
import {
	callSignalText,
	formatDuration,
	groupControlText,
	groupInviteText,
	groupMessageText,
	initialsFor,
	mediaFromMessage,
	messagePreview,
	parseCallSignal,
	parseGroupControl,
	parseGroupInvite,
	parseGroupMessage,
	parsePubkey
} from './protocol';
import type { GroupThread } from './protocol';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const group: GroupThread = {
	id: 'group-1',
	name: 'Core Team',
	initials: 'CT',
	description: '',
	pinned: 'No pinned message yet',
	unread: 0,
	members: [
		{ name: 'Alice', initials: 'AL', status: 'Online', pubkey: ALICE },
		{ name: 'Bob', initials: 'BO', status: 'Invited', pubkey: BOB }
	],
	messages: [],
	files: []
};

describe('message protocol helpers', () => {
	it('formats initials and durations predictably', () => {
		expect(initialsFor('Ada Lovelace')).toBe('AL');
		expect(initialsFor('single')).toBe('S');
		expect(formatDuration(65)).toBe('1:05');
		expect(formatDuration(3661)).toBe('1:01:01');
	});

	it('round-trips group invites, messages, and controls', () => {
		expect(parseGroupInvite(groupInviteText(group, ALICE))).toEqual({
			id: group.id,
			name: group.name,
			from: ALICE
		});

		expect(parseGroupMessage(groupMessageText(group, ALICE, 'hello team'))).toEqual({
			id: group.id,
			name: group.name,
			from: ALICE,
			body: 'hello team'
		});

		expect(parseGroupControl(groupControlText(group, ALICE, 'add-member', BOB))).toEqual({
			id: group.id,
			name: group.name,
			from: ALICE,
			type: 'add-member',
			member: BOB,
			members: [ALICE, BOB]
		});
	});

	it('round-trips rename-group controls without a target member', () => {
		const renamed: GroupThread = { ...group, name: 'Core Team v2' };
		// The control builder is called with the already-renamed group; the
		// sender pubkey is passed as the member field (compat shape).
		const parsed = parseGroupControl(groupControlText(renamed, ALICE, 'rename-group', ALICE));
		expect(parsed).toEqual({
			id: group.id,
			name: 'Core Team v2',
			from: ALICE,
			type: 'rename-group',
			member: ALICE,
			members: [ALICE, BOB]
		});
	});

	it('falls back to the sender when a rename control omits member', () => {
		const text = [
			'"Core Team" was renamed on BitOS.',
			'Open BitOS Messages to sync this local group membership update.',
			`bitos://group-control?${new URLSearchParams({
				id: group.id,
				name: 'Core Team v2',
				from: ALICE,
				type: 'rename-group'
			}).toString()}`
		].join('\n\n');
		const parsed = parseGroupControl(text);
		expect(parsed?.type).toBe('rename-group');
		expect(parsed?.name).toBe('Core Team v2');
		expect(parsed?.member).toBe(ALICE); // sender fallback
	});

	it('round-trips call signals', () => {
		const parsed = parseCallSignal(
			callSignalText({
				callId: 'call-1',
				type: 'offer',
				kind: 'video',
				from: ALICE,
				groupId: group.id,
				sdp: 'v=0'
			})
		);
		expect(parsed).toMatchObject({
			callId: 'call-1',
			type: 'offer',
			kind: 'video',
			from: ALICE,
			groupId: group.id,
			sdp: 'v=0'
		});
		const missed = parseCallSignal(
			callSignalText({
				callId: 'call-1',
				type: 'log',
				kind: 'video',
				from: BOB,
				duration: 0,
				outcome: 'missed'
			})
		);
		expect(missed?.outcome).toBe('missed');
	});

	it('round-trips ephemeral call state (raise hand)', () => {
		const parsed = parseCallSignal(
			callSignalText({
				callId: 'call-2',
				type: 'state',
				kind: 'voice',
				from: ALICE,
				groupId: group.id,
				state: 'hand-up'
			})
		);
		expect(parsed?.type).toBe('state');
		expect(parsed?.state).toBe('hand-up');
		expect(parsed?.groupId).toBe(group.id);
	});

	it('detects message media and previews attachments', () => {
		expect(mediaFromMessage('see https://cdn.example.com/photo.png')?.kind).toBe('image');
		expect(mediaFromMessage('clip https://cdn.example.com/video.mp4')?.kind).toBe('video');
		expect(messagePreview('notes https://cdn.example.com/file.pdf')).toBe('File attachment: notes');
		expect(messagePreview('plain text')).toBe('plain text');
	});

	it('accepts hex pubkeys and rejects malformed input', () => {
		expect(parsePubkey(` ${ALICE.toUpperCase()} `)).toBe(ALICE);
		expect(parsePubkey('npub1notreal')).toBeNull();
		expect(parsePubkey('abc')).toBeNull();
	});
});
