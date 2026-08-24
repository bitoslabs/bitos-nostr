import { toasts } from '$lib/stores/toasts.svelte';
import { media } from '$lib/stores/media.svelte';
import { identity } from '$lib/nostr/identity.svelte';
import { clientTag } from '$lib/nostr/client-tag';
import { queryOnce, publish } from '$lib/nostr/pool';
import { signMined } from '$lib/auth/signer';
import {
	parseSharedSound,
	rankSharedSounds,
	sharedSoundEventParts,
	verifySharedSoundSha256,
	type SharedSound
} from '$lib/meme/shared-sounds';
import { soundLibrary, type LibrarySound } from '$lib/stores/meme-sounds.svelte';
import { soundIO } from '$lib/stores/meme-sound-io.svelte';

/**
 * Shared sounds (NIP-78 kind-30078) — the studio's §17.1/§17.2 surface split
 * out of MemeStudio: query relays for the shared-sound catalog, publish one of
 * your library sounds as a shareable event, and ingest a shared sound (fetch →
 * hash-verify → import into the local library) with all the busy-state the
 * pickers need.
 */

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class SharedSoundsStore {
	list = $state<SharedSound[]>([]);
	loading = $state(false);
	importingId = $state('');
	sharingId = $state('');
	#fetchedAt = 0;

	/** Query relays for shared-sound events (throttled to one fetch/minute). */
	async load(): Promise<void> {
		if (this.loading) return;
		if (Date.now() - this.#fetchedAt < 60_000 && this.list.length) return;
		this.loading = true;
		try {
			const events = await queryOnce([{ kinds: [30078], limit: 200 }]);
			const mine = identity.current?.pk ?? '';
			this.list = rankSharedSounds(
				events.map((e) => parseSharedSound(e)).filter((s): s is SharedSound => s !== null),
				mine
			);
			this.#fetchedAt = Date.now();
			if (!this.list.length) toasts.info('No shared sounds on your relays yet — be the first');
		} catch {
			toasts.error('Could not reach relays for shared sounds');
		} finally {
			this.loading = false;
		}
	}

	/** Publish a library sound as a kind-30078 shared-sound event (§17.1). */
	async share(soundId: string): Promise<void> {
		const me = identity.current;
		if (!me) {
			toasts.error('Sign in to share sounds');
			return;
		}
		if (this.sharingId) return;
		const sound = this.lookup(soundId);
		if (!sound) {
			toasts.error('That sound is missing from this device');
			return;
		}
		this.sharingId = sound.id;
		try {
			const blob = await soundLibrary.getBlob(sound.id);
			if (!blob) throw new Error('The sound file is missing from this device');
			// media.upload takes a named File (uploaders infer names from it)
			const soundFile = new File([blob], `sound-${sound.id}.webm`, {
				type: blob.type || 'audio/webm'
			});
			const uploaded = await media.upload(soundFile, undefined, {
				pubkey: me.pk,
				purpose: 'note'
			});
			const sha = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
			const parts = sharedSoundEventParts({
				soundId: sound.id,
				label: sound.label,
				durationSec: sound.durationSec,
				mime: blob.type || sound.mime,
				url: uploaded.url,
				sha256: sha,
				license: 'CC0-1.0',
				clientTag: clientTag()
			});
			const event = await signMined({
				kind: 30078,
				content: parts.content,
				created_at: Math.floor(Date.now() / 1000),
				tags: parts.tags
			});
			await publish(event);
			toasts.success(`Shared “${sound.label}” — other bitz creators can remix it`);
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not share that sound');
		} finally {
			this.sharingId = '';
		}
	}
	/** §17.2 ingestion: fetch → verify hash → import into the local library. */
	async import(sound: SharedSound): Promise<void> {
		if (this.importingId) return;
		if (!sound.sha256) {
			toasts.error('That sound has no content hash — refusing to import it');
			return;
		}
		this.importingId = sound.eventId;
		try {
			const res = await fetch(sound.url);
			if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Over 8 MB — too big to import');
			const ok = await verifySharedSoundSha256(bytes, sound.sha256, sha256Hex);
			if (!ok) throw new Error('Hash mismatch — the file changed since it was shared');
			const blob = new Blob([bytes as unknown as ArrayBuffer], { type: sound.mime });
			await soundIO.importBlob(blob, sound.durationSec, 'device', sound.label);
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not import that sound');
		} finally {
			this.importingId = '';
		}
	}
	/** Lookup a library sound by id (null when deleted mid-flight). */
	lookup(soundId: string): LibrarySound | null {
		return soundLibrary.list.find((s) => s.id === soundId) ?? null;
	}
}

export const sharedSoundsStore = new SharedSoundsStore();
