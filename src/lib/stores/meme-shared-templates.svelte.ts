import { toasts } from '$lib/stores/toasts.svelte';
import { identity } from '$lib/nostr/identity.svelte';
import { clientTag } from '$lib/nostr/client-tag';
import { queryOnce, publish } from '$lib/nostr/pool';
import { signMined } from '$lib/auth/signer';
import {
	parseSharedTemplate,
	rankSharedTemplates,
	sharedTemplateEventParts,
	type SharedTemplate
} from '$lib/meme/shared-templates';
import { memeTemplates, type SavedMemeTemplate } from '$lib/stores/meme-templates.svelte';

/**
 * Shared templates (NIP-78 kind:30078) — the template-creator-economy half
 * of the studio's §17 surface, mirroring the shared-sounds store: query
 * relays for the shared-template catalog, publish one of your saved layouts,
 * and import a shared layout into the local template library (stages apply
 * via the existing applySavedTemplate path — fresh overlay ids on apply).
 */

class SharedTemplatesStore {
	list = $state<SharedTemplate[]>([]);
	loading = $state(false);
	importingId = $state('');
	sharingId = $state('');
	#fetchedAt = 0;

	/** Query relays for shared-template events (throttled to one fetch/minute). */
	async load(): Promise<void> {
		if (this.loading) return;
		if (Date.now() - this.#fetchedAt < 60_000 && this.list.length) return;
		this.loading = true;
		try {
			const events = await queryOnce([{ kinds: [30078], limit: 200 }]);
			const mine = identity.current?.pk ?? '';
			this.list = rankSharedTemplates(
				events.map((e) => parseSharedTemplate(e)).filter((t): t is SharedTemplate => t !== null),
				mine
			);
			this.#fetchedAt = Date.now();
			if (!this.list.length) toasts.info('No shared layouts on your relays yet — be the first');
		} catch {
			toasts.error('Could not reach relays for shared layouts');
		} finally {
			this.loading = false;
		}
	}

	/** Publish a saved local template as a kind-30078 shared-template event. */
	async share(id: string): Promise<void> {
		const me = identity.current;
		if (!me) {
			toasts.error('Sign in to share templates');
			return;
		}
		if (this.sharingId) return;
		const saved = memeTemplates.list.find((t) => t.id === id);
		if (!saved) {
			toasts.error('That template is missing from this device');
			return;
		}
		this.sharingId = id;
		try {
			const parts = sharedTemplateEventParts({
				templateId: saved.id,
				label: saved.label,
				icon: saved.icon,
				overlays: saved.overlays,
				sfxCues: saved.sfxCues,
				zoomWindows: saved.zoomWindows,
				fxWindows: saved.fxWindows,
				speedWindows: saved.speedWindows,
				imageLayers: saved.imageLayers,
				clientTag: clientTag()
			});
			const event = await signMined({
				kind: 30078,
				content: parts.content,
				created_at: Math.floor(Date.now() / 1000),
				tags: parts.tags
			});
			await publish(event);
			toasts.success(`Shared “${saved.label}” — other bitz creators can remix your layout`);
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not share that template');
		} finally {
			this.sharingId = '';
		}
	}

	/**
	 * Import a shared template into the local library (saved-template list).
	 * The layout is already in-event — no fetch/hash path, just re-validate
	 * through parseSharedTemplate (already applied) and persist locally.
	 * Returns the saved local template so callers can apply it right away.
	 */
	async import(template: SharedTemplate): Promise<SavedMemeTemplate | null> {
		if (this.importingId) return null;
		this.importingId = template.eventId;
		try {
			const saved = memeTemplates.save(template.label, template.overlays, template.icon, {
				sfxCues: template.sfxCues,
				zoomWindows: template.zoomWindows,
				fxWindows: template.fxWindows,
				speedWindows: template.speedWindows,
				imageLayers: template.imageLayers
			});
			toasts.success(`Saved “${template.label}” to your templates`);
			return saved;
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not import that template');
			return null;
		} finally {
			this.importingId = '';
		}
	}
}

export const sharedTemplatesStore = new SharedTemplatesStore();
