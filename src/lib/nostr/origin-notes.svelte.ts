/** Batched origin-note hydration used by notification previews. */
import { browser } from '$app/environment';
import type { Event } from './types';
import { queryPrimaryFirst } from './pool';

const BATCH_SIZE = 100;

export const originNotes = $state<Record<string, Event>>({});
export const originNoteStates = $state<Record<string, 'loading' | 'missing'>>({});
const pendingIds = new Set<string>();
const requestedIds = new Set<string>();
let flushScheduled = false;

function cache(events: Event[]) {
	for (const event of events) {
		originNotes[event.id] = event;
		delete originNoteStates[event.id];
	}
}

async function flush() {
	flushScheduled = false;
	const ids = [...pendingIds];
	pendingIds.clear();
	if (!ids.length || !browser) return;

	for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
		const batch = ids.slice(offset, offset + BATCH_SIZE);
		try {
			const events = await queryPrimaryFirst([{ ids: batch, limit: batch.length }], {
				onPrimary: cache,
				onSecondary: cache
			});
			cache(events);
		} catch {
			// A missing or unavailable origin note should not break the notification list.
		}
	}
}

export function requestOriginNotes(ids: string[]) {
	if (!browser) return;
	for (const id of ids) {
		if (!id || originNotes[id] || requestedIds.has(id)) continue;
		requestedIds.add(id);
		originNoteStates[id] = 'loading';
		pendingIds.add(id);
		setTimeout(() => {
			if (!originNotes[id] && originNoteStates[id] === 'loading') {
				originNoteStates[id] = 'missing';
			}
		}, 8000);
	}
	if (!pendingIds.size || flushScheduled) return;
	flushScheduled = true;
	queueMicrotask(() => void flush());
}
