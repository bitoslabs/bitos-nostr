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
const ACCOUNTS_KEY = 'bitos:accounts';

export interface StoredAccount {
	sk: string;
	profile?: Profile;
	lastUsedAt: number;
}

export interface AccountSummary {
	pk: string;
	npub: string;
	profile?: Profile;
	lastUsedAt: number;
	active: boolean;
}

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
	accounts = $state<AccountSummary[]>([]);
	ready = $state(false);

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as { sk: string; profile?: Profile };
				this.current = buildIdentity(parsed.sk, parsed.profile);
			}
			this.loadAccounts();
			if (this.current) this.rememberAccount(this.current.sk, this.current.profile);
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
		this.rememberAccount(id.sk, id.profile);
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
		this.rememberAccount(id.sk, id.profile);
		this.persist();
		return id;
	};

	setProfile = (profile: Profile) => {
		if (!this.current) return;
		this.current = { ...this.current, profile };
		this.rememberAccount(this.current.sk, profile);
		this.persist();
	};

	logout = () => {
		if (!this.current) {
			if (browser) localStorage.removeItem(STORAGE_KEY);
			this.refreshSummaries();
			return;
		}
		this.removeAccount(this.current.pk);
	};

	switchTo = (pubkey: string): Identity => {
		if (!browser) throw new Error('Switching accounts is only available in the browser');
		const account = this.storedAccounts().find((item) => buildIdentity(item.sk).pk === pubkey);
		if (!account) throw new Error('Account not found on this device');
		const id = buildIdentity(account.sk, account.profile);
		this.current = id;
		this.rememberAccount(id.sk, id.profile);
		this.persist();
		return id;
	};

	removeAccount = (pubkey: string) => {
		const next = this.storedAccounts().filter((item) => buildIdentity(item.sk).pk !== pubkey);
		this.persistAccounts(next);
		if (this.current?.pk === pubkey) {
			this.current = null;
			if (browser) localStorage.removeItem(STORAGE_KEY);
			this.refreshSummaries(next);
		}
	};

	private persist = () => {
		if (!browser || !this.current) return;
		// Local-first app: the user opted in to keeping the key on this device.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ sk: this.current.sk, profile: this.current.profile })
		);
	};

	private storedAccounts(): StoredAccount[] {
		if (!browser) return [];
		try {
			const raw = localStorage.getItem(ACCOUNTS_KEY);
			const parsed = raw ? (JSON.parse(raw) as StoredAccount[]) : [];
			if (!Array.isArray(parsed)) return [];
			const uniqueByPubkey = new Map<string, StoredAccount>();
			for (const item of parsed) {
				if (!item || !/^[0-9a-fA-F]{64}$/.test(item.sk)) continue;
				const normalized = item.sk.toLowerCase();
				const pk = buildIdentity(normalized).pk;
				const existing = uniqueByPubkey.get(pk);
				if (!existing || (item.lastUsedAt ?? 0) >= existing.lastUsedAt) {
					uniqueByPubkey.set(pk, {
						sk: normalized,
						profile: item.profile,
						lastUsedAt: item.lastUsedAt ?? 0
					});
				}
			}
			return [...uniqueByPubkey.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
		} catch {
			return [];
		}
	}

	private persistAccounts(accounts: StoredAccount[]) {
		if (!browser) return;
		localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
		this.refreshSummaries(accounts);
	}

	private rememberAccount(sk: string, profile?: Profile) {
		const now = Math.floor(Date.now() / 1000);
		const nextIdentity = buildIdentity(sk, profile);
		const next = [
			{ sk, profile, lastUsedAt: now },
			...this.storedAccounts().filter((item) => buildIdentity(item.sk).pk !== nextIdentity.pk)
		];
		this.persistAccounts(next);
	}

	private loadAccounts() {
		this.refreshSummaries(this.storedAccounts());
	}

	private refreshSummaries(accounts = this.storedAccounts()) {
		this.accounts = accounts.map((account) => {
			const id = buildIdentity(account.sk, account.profile);
			return {
				pk: id.pk,
				npub: id.npub,
				profile: account.profile,
				lastUsedAt: account.lastUsedAt,
				active: id.pk === this.current?.pk
			};
		});
	}
}

export const identity = new IdentityStore();
