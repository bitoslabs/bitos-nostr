/**
 * Story view receipts — privacy gating + once-per-slide cache.
 *
 * Views are signalled with a kind 7 “👁️” reaction (NIP-25 emoji reaction;
 * there is no dedicated standard kind, and ephemeral kinds 20000-29999 are
 * never stored by relays so an offline author would miss them).
 *
 * Guarantees under test:
 * - default OFF: opening a story NEVER signs or publishes an event
 * - the once-per-slide cache is written even while OFF, so enabling the
 *   setting later cannot replay receipts for already-seen stories
 * - when ON: exactly one kind 7 👁️ event per slide, targeting e/p tags
 * - never counts the author viewing their own story
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./pool', () => ({
	subscribe: vi.fn(() => () => {}),
	publish: vi.fn(async () => []),
	queryPrimaryFirst: vi.fn(async () => []),
	queryUrls: vi.fn(async () => []),
	queryOnce: vi.fn(async () => []),
	lookupEventById: vi.fn(async () => null),
	lookupEventTags: vi.fn(async () => null),
	publishUrls: vi.fn(async () => []),
	subscribeUrls: vi.fn(() => () => {})
}));

import { stories } from './stories.svelte';
import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
import { identity } from './identity.svelte';
import { publish } from './pool';
import type { StorySlide } from './stories.svelte';

function fakeSlide(partial: Partial<StorySlide> = {}): StorySlide {
	return {
		id: partial.id ?? 'aa'.repeat(32),
		d: partial.d ?? 'bitos-story-1-x',
		pubkey: partial.pubkey ?? 'cd'.repeat(32),
		content: 'hello',
		createdAt: Math.floor(Date.now() / 1000),
		expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
		...partial
	};
}

/** Fresh localStorage fake that records writes. */
function fakeStorage() {
	const map = new Map<string, string>();
	return {
		getItem: vi.fn((k: string) => map.get(k) ?? null),
		setItem: vi.fn((k: string, v: string) => void map.set(k, v)),
		removeItem: vi.fn((k: string) => void map.delete(k)),
		written: () => map
	};
}

describe('stories.recordView privacy gating', () => {
	let storage: ReturnType<typeof fakeStorage>;

	beforeEach(() => {
		storage = fakeStorage();
		vi.stubGlobal('localStorage', storage);
		vi.mocked(publish).mockClear();
		identity.importSecret('ab'.repeat(32));
		// Reset to persisted defaults (storyViewReceipts = false).
		privacyNotificationSettings.state.storyViewReceipts = false;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('is OFF by default', () => {
		expect(privacyNotificationSettings.state.storyViewReceipts).toBe(false);
	});

	it('does not publish anything while the setting is OFF', async () => {
		await stories.recordView(fakeSlide());
		expect(publish).not.toHaveBeenCalled();
	});

	it('still marks the slide viewed locally while OFF (no later replay)', async () => {
		const slide = fakeSlide({ id: '11'.repeat(32) });
		await stories.recordView(slide);
		// Enabling the setting afterwards must not publish for the seen slide…
		privacyNotificationSettings.state.storyViewReceipts = true;
		await stories.recordView(slide);
		expect(publish).not.toHaveBeenCalled();
		// …and the once-cache was persisted even while OFF.
		expect(storage.written().get('bitos:story-views')).toContain(slide.id);
	});

	it('publishes exactly one kind 7 👁️ reaction when ON', async () => {
		privacyNotificationSettings.state.storyViewReceipts = true;
		const slide = fakeSlide({ id: '22'.repeat(32), pubkey: 'ef'.repeat(32) });
		await stories.recordView(slide);
		await stories.recordView(slide); // second view: cached, no re-publish

		expect(publish).toHaveBeenCalledTimes(1);
		const event = vi.mocked(publish).mock.calls[0]![0];
		expect(event.kind).toBe(7);
		expect(event.content).toBe('👁️');
		expect(event.tags).toContainEqual(['e', slide.id]);
		expect(event.tags).toContainEqual(['p', slide.pubkey]);
		expect(event.tags).toContainEqual(['a', `30315:${slide.pubkey}:${slide.d}`]);
	});

	it('never sends a view receipt for the own story', async () => {
		privacyNotificationSettings.state.storyViewReceipts = true;
		const mine = fakeSlide({ id: '33'.repeat(32), pubkey: identity.current!.pk.toLowerCase() });
		await stories.recordView(mine);
		expect(publish).not.toHaveBeenCalled();
	});
});
