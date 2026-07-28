/**
 * Identity store — holds the logged-in Nostr keypair (hex sk/pk + npub/nsec),
 * persisted to localStorage. Keys are kept in memory only; nothing is sent
 * anywhere except to relays when signing/publishing. On first run there is no
 * identity and the UI shows onboarding.
 */
import { browser } from '$app/environment';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nsecEncode, npubEncode, decode } from 'nostr-tools/nip19';
import type { Identity, Profile } from './types';
import { bytesToHex, hexToBytes } from './hex';

const STORAGE_KEY = 'bitos:identity';

function buildIdentity(skHex: string, profile?: Profile): Identity {
	const pkHex = getPublicKey(hexToBytes(skHex));
	let nsec = '';
	let npub = '';
	try {
		nsec = nsecEncode(hexToBytes(skHex));
		npub = npubEncode(pkHex);
	} catch {
		/* nip19 needs crypto — ignore on SSR */
	}
	return { sk: skHex, pk: pkHex, npub, nsec, profile };
}

class IdentityStore {
	current = $state<Identity | null>(null);
	ready = $state(false);

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as { sk: string; profile?: Profile };
				this.current = buildIdentity(parsed.sk, parsed.profile);
			}
		} catch {
			/* ignore malformed storage */
		}
		this.ready = true;
	};

	/** Create a brand-new keypair. */
	create = (): Identity => {
		const skBytes = generateSecretKey();
		const skHex = bytesToHex(skBytes);
		const id = buildIdentity(skHex);
		this.current = id;
		this.persist();
		return id;
	};

	/** Import an existing private key (nsec1… or 64-char hex). */
	importSecret = (secret: string): Identity => {
		const trimmed = secret.trim();
		let skHex: string;
		if (trimmed.startsWith('nsec1')) {
			const decoded = decode(trimmed);
			if (decoded.type !== 'nsec') throw new Error('Expected an nsec key');
			skHex = bytesToHex(decoded.data as Uint8Array);
		} else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
			skHex = trimmed.toLowerCase();
		} else {
			throw new Error('Unrecognized key format. Use nsec1… or a 64-char hex secret.');
		}
		const id = buildIdentity(skHex);
		this.current = id;
		this.persist();
		return id;
	};

	setProfile = (profile: Profile) => {
		if (!this.current) return;
		this.current = { ...this.current, profile };
		this.persist();
	};

	logout = () => {
		this.current = null;
		if (browser) localStorage.removeItem(STORAGE_KEY);
	};

	private persist = () => {
		if (!browser || !this.current) return;
		// Local-first app: the user opted in to keeping the key on this device.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ sk: this.current.sk, profile: this.current.profile })
		);
	};
}

export const identity = new IdentityStore();
