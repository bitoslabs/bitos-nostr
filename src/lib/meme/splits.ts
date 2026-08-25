/**
 * Value-split manifest (CRE-008, §7.2 value_splits + plan-bitz §4–5 Value Graph).
 *
 * A split manifest declares how future monetization on this bitz would flow —
 * which roles get paid, in basis points, summing to exactly 10,000 (100%).
 * V1 is store/display/validate only (§7.2): no payment execution rides this.
 *
 * Wire form is a single Nostr tag per beneficiary:
 *   ["value_split", "<role>", "<basis_points>", "<beneficiary_pubkey>"?]
 *
 * Tolerance rules mirror `rightsOf` (S-013): readers must never let malformed
 * metadata break the feed — `splitsOf` degrades to `null` on any parse issue.
 */

export const SPLIT_ROLES = [
	'video_creator',
	'original_creator',
	'sound_creator',
	'effect_creator',
	'template_creator',
	'curator',
	'platform'
] as const;

export type SplitRole = (typeof SPLIT_ROLES)[number];

/** Sum every manifest must hit exactly (§7.2: enforced in application/domain validation). */
export const TOTAL_BASIS_POINTS = 10_000;

/** Per-row bounds from the §7.2 CHECK constraint. */
export const MIN_BASIS_POINTS = 0;
export const MAX_BASIS_POINTS = 10_000;

/** Cap on beneficiary refs for relay friendliness. */
export const MAX_BENEFICIARY_CHARS = 128;

export interface SplitRow {
	role: SplitRole;
	basisPoints: number;
	/** npub/hex pubkey or other portable ref — optional at declare time. */
	beneficiary?: string;
}

export interface ParsedSplits {
	rows: SplitRow[];
	total: number;
	/** False when any row failed tolerance checks (kept out of `rows`). */
	droppedMalformed: boolean;
}

function isSplitRole(value: string): value is SplitRole {
	return (SPLIT_ROLES as readonly string[]).includes(value);
}

/**
 * Validate a manifest for publish: every role known, every row within
 * 0–10,000 bps, no (role, beneficiary) duplicates, and the sum exactly
 * 10,000. Returns a discriminated result — never throws — so the composer
 * UI can show a live counter instead of a wall of exceptions.
 */
export function validateSplits(rows: SplitRow[]): { ok: true } | { ok: false; error: string } {
	if (rows.length === 0) return { ok: false, error: 'Add at least one split row' };
	const seen = new Set<string>();
	let total = 0;
	for (const row of rows) {
		if (!isSplitRole(row.role)) return { ok: false, error: `Unknown role "${row.role}"` };
		if (!Number.isInteger(row.basisPoints)) {
			return { ok: false, error: 'Basis points must be whole numbers' };
		}
		if (row.basisPoints < MIN_BASIS_POINTS || row.basisPoints > MAX_BASIS_POINTS) {
			return { ok: false, error: 'Each share must stay within 0–10,000 bps' };
		}
		if (row.beneficiary !== undefined && row.beneficiary.length > MAX_BENEFICIARY_CHARS) {
			return { ok: false, error: 'Beneficiary ref is too long' };
		}
		const key = `${row.role}:${row.beneficiary ?? ''}`;
		if (seen.has(key)) return { ok: false, error: 'Duplicate role/beneficiary row' };
		seen.add(key);
		total += row.basisPoints;
	}
	if (total !== TOTAL_BASIS_POINTS) {
		return {
			ok: false,
			error: `Shares must total 10,000 bps — currently ${total.toLocaleString()}`
		};
	}
	return { ok: true };
}

/**
 * Serialize a validated manifest to Nostr tags. Refuses unvalidated input
 * so a broken counter can never reach the wire.
 */
export function splitsTagsFor(rows: SplitRow[]): string[][] {
	const check = validateSplits(rows);
	if (!check.ok) throw new Error(`Refusing to emit split tags: ${check.error}`);
	return rows.map((row) => {
		const tag: string[] = ['value_split', row.role, String(row.basisPoints)];
		const beneficiary = row.beneficiary?.trim().slice(0, MAX_BENEFICIARY_CHARS);
		if (beneficiary) tag.push(beneficiary);
		return tag;
	});
}

/**
 * Tolerant read of a manifest from event tags. Degrades to `null` when the
 * event declares no valid split rows — missing metadata must never break
 * the reel (same contract as `rightsOf`).
 */
export function splitsOf(tags: string[][]): ParsedSplits | null {
	const rows: SplitRow[] = [];
	let droppedMalformed = false;
	for (const tag of tags) {
		if (tag[0] !== 'value_split' || tag.length < 3) {
			if (tag[0] === 'value_split') droppedMalformed = true;
			continue;
		}
		const role = tag[1];
		const basisPoints = Number(tag[2]);
		if (
			!isSplitRole(role) ||
			!Number.isInteger(basisPoints) ||
			basisPoints < 0 ||
			basisPoints > MAX_BASIS_POINTS
		) {
			droppedMalformed = true;
			continue;
		}
		const beneficiary = tag[3]?.trim().slice(0, MAX_BENEFICIARY_CHARS) ?? '';
		rows.push(beneficiary ? { role, basisPoints, beneficiary } : { role, basisPoints });
	}
	if (rows.length === 0) return null;
	return { rows, total: rows.reduce((sum, row) => sum + row.basisPoints, 0), droppedMalformed };
}
