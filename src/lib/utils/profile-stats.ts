/**
 * Profile analytics + media helpers powering the premium profile surface:
 *   • media extraction for the Instagram-style gallery
 *   • a GitHub-style posting activity heatmap
 *   • a profile-completion meter for the logged-in user
 *
 * All pure + SSR-safe so they can run inside $derived() without side effects.
 */
import type { FeedNote, Profile } from '$lib/nostr/types';
import { extractNotificationMedia } from './imeta';
import { sensitiveMediaReason } from './sensitive-media';

/* -------------------------------------------------------------------------- */
/*  Compact formatters (shared so the feed + profile never drift apart)       */
/* -------------------------------------------------------------------------- */

/** 1234 → "1.2K", 2_500_000 → "2.5M". */
export function compactCount(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
	return String(value);
}

/** Sats use lowercase k to match existing feed copy. */
export function compactSats(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
}

/* -------------------------------------------------------------------------- */
/*  Profile media gallery                                                     */
/* -------------------------------------------------------------------------- */

export type ProfileMediaItem = {
	url: string;
	type: 'image' | 'video' | 'gif';
	thumb?: string;
	alt?: string;
	noteId: string;
	createdAt: number;
	sensitiveReason: string;
};

/**
 * Flatten every renderable attachment (imeta + bare URLs) across a set of notes
 * into a deduplicated, newest-first gallery feed. Reuses the feed's media
 * classifier so what shows in the gallery is exactly what renders inline.
 */
export function extractProfileMedia(notes: FeedNote[], max = 60): ProfileMediaItem[] {
	const seen = new Set<string>();
	const items: ProfileMediaItem[] = [];
	for (const note of notes) {
		const media = extractNotificationMedia({ content: note.content, tags: note.tags });
		for (const m of media) {
			if (seen.has(m.url)) continue;
			seen.add(m.url);
			items.push({
				url: m.url,
				type: m.kind,
				thumb: m.thumb,
				alt: m.alt,
				noteId: note.id,
				createdAt: note.createdAt,
				sensitiveReason: sensitiveMediaReason(note.tags, note.content, m)
			});
			if (items.length >= max) return items;
		}
	}
	return items;
}

/* -------------------------------------------------------------------------- */
/*  Posting activity heatmap (GitHub-style contribution graph)                */
/* -------------------------------------------------------------------------- */

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapDay = {
	date: Date;
	iso: string; // YYYY-MM-DD
	count: number;
	level: HeatLevel;
};

export type HeatmapWeek = HeatmapDay[]; // 7 entries, Sun → Sat

export type ActivityHeatmap = {
	weeks: HeatmapWeek[];
	total: number;
	max: number;
	currentStreak: number;
	bestStreak: number;
	windowStart: Date;
	windowEnd: Date;
};

const DAY_MS = 86_400_000;

function isoDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function levelFor(count: number, max: number): HeatLevel {
	if (count <= 0 || max <= 0) return 0;
	const ratio = count / max;
	if (ratio <= 0.25) return 1;
	if (ratio <= 0.5) return 2;
	if (ratio <= 0.75) return 3;
	return 4;
}

function computeStreaks(counts: Map<string, number>, today: Date) {
	// Best streak: longest run of consecutive active days present in the window.
	const active = [...counts.keys()].sort();
	let best = 0;
	let run = 0;
	let prevIso: string | null = null;
	for (const iso of active) {
		if (!prevIso) {
			run = 1;
		} else {
			const prev = new Date(prevIso + 'T00:00:00');
			const curr = new Date(iso + 'T00:00:00');
			run = Math.round((+curr - +prev) / DAY_MS) === 1 ? run + 1 : 1;
		}
		best = Math.max(best, run);
		prevIso = iso;
	}

	// Current streak: walk back from today (or yesterday if today is quiet).
	const cursor = new Date(today);
	if ((counts.get(isoDate(cursor)) ?? 0) === 0) {
		cursor.setDate(cursor.getDate() - 1);
	}
	let current = 0;
	while ((counts.get(isoDate(cursor)) ?? 0) > 0) {
		current++;
		cursor.setDate(cursor.getDate() - 1);
	}
	return { currentStreak: current, bestStreak: best };
}

/**
 * Bucket note timestamps into per-day counts for the last `weeks` weeks and
 * produce a column-major grid (each column = one ISO week, Sun→Sat).
 */
export function buildActivityHeatmap(notes: FeedNote[], weeks = 22): ActivityHeatmap {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const counts = new Map<string, number>();
	let total = 0;
	let max = 0;
	for (const note of notes) {
		const d = new Date(note.createdAt * 1000);
		d.setHours(0, 0, 0, 0);
		const iso = isoDate(d);
		const next = (counts.get(iso) ?? 0) + 1;
		counts.set(iso, next);
		total++;
		if (next > max) max = next;
	}

	// Start on the Sunday of the week that begins `weeks*7` days ago so the
	// right-most column always lines up with the current week.
	const start = new Date(today);
	start.setDate(start.getDate() - (weeks * 7 - 1) - start.getDay());

	const out: HeatmapWeek[] = [];
	const cursor = new Date(start);
	while (cursor <= today) {
		const week: HeatmapDay[] = [];
		for (let dow = 0; dow < 7; dow++) {
			const iso = isoDate(cursor);
			const count = counts.get(iso) ?? 0;
			week.push({ date: new Date(cursor), iso, count, level: levelFor(count, max) });
			cursor.setDate(cursor.getDate() + 1);
		}
		out.push(week);
	}

	const { currentStreak, bestStreak } = computeStreaks(counts, today);
	return {
		weeks: out,
		total,
		max,
		currentStreak,
		bestStreak,
		windowStart: start,
		windowEnd: today
	};
}

/* -------------------------------------------------------------------------- */
/*  Profile completion meter (for the signed-in user)                         */
/* -------------------------------------------------------------------------- */

export type CompletionField = { key: string; label: string; hint: string; done: boolean };

export type ProfileCompletion = {
	score: number; // 0..100
	fields: CompletionField[];
	missing: CompletionField[];
};

/**
 * Score a profile against the fields that matter most for trust + reach on
 * Nostr (picture, banner, bio, NIP-05, lightning). Used to nudge the signed-in
 * user toward a complete profile without being preachy.
 */
export function profileCompletion(p: Profile | undefined): ProfileCompletion {
	const checks: Array<{ key: string; label: string; hint: string; done: boolean; weight: number }> =
		[
			{
				key: 'name',
				label: 'Display name',
				hint: 'How people recognize you',
				done: !!(p?.display_name || p?.name),
				weight: 15
			},
			{
				key: 'picture',
				label: 'Profile picture',
				hint: 'An avatar makes you memorable',
				done: !!p?.picture,
				weight: 20
			},
			{
				key: 'banner',
				label: 'Cover banner',
				hint: 'A header gives your page personality',
				done: !!p?.banner,
				weight: 15
			},
			{
				key: 'about',
				label: 'Bio',
				hint: 'Tell people what you post about',
				done: !!(p?.about && p.about.trim().length >= 10),
				weight: 20
			},
			{
				key: 'nip05',
				label: 'Verified handle',
				hint: 'NIP-05 confirms your identity',
				done: !!p?.nip05,
				weight: 15
			},
			{
				key: 'lud',
				label: 'Lightning address',
				hint: 'Let supporters zap you sats',
				done: !!(p?.lud16 || p?.lud06),
				weight: 15
			}
		];
	let score = 0;
	for (const c of checks) if (c.done) score += c.weight;
	return {
		score: Math.min(100, score),
		fields: checks.map(({ key, label, hint, done }) => ({ key, label, hint, done })),
		missing: checks
			.filter((c) => !c.done)
			.map(({ key, label, hint, done }) => ({ key, label, hint, done }))
	};
}
