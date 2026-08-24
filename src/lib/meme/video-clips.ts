/**
 * Ordered, non-destructive source windows for the expert video timeline.
 * Timeline time is the concatenation of the clip windows; source time remains
 * untouched, which makes split/delete/reorder reversible until export.
 */
export interface VideoClip {
	id: string;
	startSec: number;
	endSec: number;
}

const MIN_CLIP_SEC = 0.1;

function id(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeVideoClip(startSec: number, endSec: number): VideoClip | null {
	const start = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
	const end = Number.isFinite(endSec) ? Math.max(start, endSec) : start;
	return end - start >= MIN_CLIP_SEC ? { id: id(), startSec: start, endSec: end } : null;
}

export function clipDuration(clip: VideoClip): number {
	return Math.max(0, clip.endSec - clip.startSec);
}

export function clipsDuration(clips: VideoClip[]): number {
	return clips.reduce((total, clip) => total + clipDuration(clip), 0);
}

/** Find the source timestamp corresponding to an output-timeline timestamp. */
export function sourceTimeAt(
	clips: VideoClip[],
	timelineSec: number
): {
	clipIndex: number;
	sourceSec: number;
} | null {
	let remaining = Math.max(0, timelineSec);
	for (let i = 0; i < clips.length; i++) {
		const clip = clips[i]!;
		const duration = clipDuration(clip);
		if (remaining <= duration || i === clips.length - 1) {
			return { clipIndex: i, sourceSec: Math.min(clip.endSec, clip.startSec + remaining) };
		}
		remaining -= duration;
	}
	return null;
}

/** Split a clip at output-timeline time. Returns the original array when the
 * point lies on an edge or outside the sequence. */
export function splitClipAt(clips: VideoClip[], timelineSec: number): VideoClip[] {
	let offset = 0;
	for (let i = 0; i < clips.length; i++) {
		const clip = clips[i]!;
		const duration = clipDuration(clip);
		const local = timelineSec - offset;
		if (local > MIN_CLIP_SEC && local < duration - MIN_CLIP_SEC) {
			const cut = clip.startSec + local;
			return [
				...clips.slice(0, i),
				{ ...clip, endSec: cut },
				{ id: id(), startSec: cut, endSec: clip.endSec },
				...clips.slice(i + 1)
			];
		}
		offset += duration;
	}
	return clips;
}

export function removeClip(clips: VideoClip[], clipId: string): VideoClip[] {
	return clips.filter((clip) => clip.id !== clipId);
}

export function moveClip(clips: VideoClip[], clipId: string, direction: -1 | 1): VideoClip[] {
	const index = clips.findIndex((clip) => clip.id === clipId);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= clips.length) return clips;
	const next = [...clips];
	const [clip] = next.splice(index, 1);
	next.splice(target, 0, clip!);
	return next;
}
