/**
 * NIP-56 reporting. Publishes kind 1984 report events targeting a note's
 * author (`p` tag) and, when reporting a specific note, the note itself
 * (`e` tag) plus a machine-readable `report` tag carrying the reason.
 *
 * Reports are public events relays and other clients (Damus, Amethyst,
 * snort) already consume — publishing from BitOS feeds the shared,
 * decentralized moderation graph rather than a proprietary queue.
 */
import { browser } from '$app/environment';
import { activeSigner } from '$lib/auth/signer';
import { publish } from './pool';
import { clientTag } from './client-tag';
import { NOSTR_KINDS } from './types';

export interface ReportReason {
	id: string;
	/** NIP-56 reason string placed in the `report` tag. */
	value: string;
	label: string;
	hint: string;
}

/** Curated NIP-56 reason set (a subset of the spec list, user-comprehensible). */
export const REPORT_REASONS: ReportReason[] = [
	{
		id: 'spam',
		value: 'spam',
		label: 'Spam',
		hint: 'Repetitive, unwanted or automated content'
	},
	{
		id: 'nudity',
		value: 'nudity',
		label: 'Explicit content',
		hint: 'Nudity or sexual content, not marked sensitive'
	},
	{
		id: 'illegal',
		value: 'illegal',
		hint: 'Content that violates applicable law',
		label: 'Illegal activity'
	},
	{
		id: 'impersonation',
		value: 'impersonation',
		label: 'Impersonation',
		hint: 'Pretending to be another person or brand'
	},
	{
		id: 'harassment',
		value: 'harassment',
		label: 'Harassment',
		hint: 'Targeted abuse, threats or bullying'
	},
	{
		id: 'other',
		value: 'other',
		label: 'Something else',
		hint: 'Explain briefly in the comment'
	}
];

/** Build the tags for a NIP-56 report (exported for unit testing). */
export function buildReportTags(params: {
	pubkey: string;
	noteId?: string;
	reason: string;
}): string[][] {
	const tags: string[][] = [['p', params.pubkey]];
	if (params.noteId) tags.push(['e', params.noteId]);
	tags.push(['report', params.noteId ?? params.pubkey, params.reason]);
	return tags;
}

/**
 * Publish a kind 1984 report. `comment` lands in the event content — it is
 * public, so never include private details.
 */
export async function reportTarget(params: {
	pubkey: string;
	noteId?: string;
	reason: string;
	comment?: string;
}): Promise<string> {
	if (!browser) throw new Error('browser only');
	const signer = activeSigner();
	if (!(await signer.isAvailable())) throw new Error('No identity — create or import a key first');
	if (!REPORT_REASONS.some((r) => r.value === params.reason)) {
		throw new Error('Unknown report reason');
	}
	const content = (params.comment ?? '').trim().slice(0, 280);
	const event = await signer.sign({
		kind: NOSTR_KINDS.REPORT,
		content,
		created_at: Math.floor(Date.now() / 1000),
		tags: [...clientTag(), ...buildReportTags(params)]
	});
	await publish(event);
	return event.id;
}
