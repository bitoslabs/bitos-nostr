/**
 * Media upload settings — runes-based singleton persisted to localStorage.
 *
 * Stores credentials for Cloudinary + S3-compatible providers and the default
 * provider used by the composer. Like the rest of BitOS this is local-first:
 * the S3 secret key lives on-device (same trust model as the Nostr nsec).
 */
import { browser } from '$app/environment';
import { identity } from '$lib/nostr/identity.svelte';
import { sanitizeMediaForUpload } from '$lib/media/privacy';
import {
	uploadBlob,
	uploadViaServer,
	uploadToBlossom,
	uploadWithProvider,
	uploadWithRetries,
	BLOSSOM_MIRROR_SERVERS,
	wantsMirrorReplica,
	type CloudinaryConfig,
	type MediaProviderId,
	type MediaSettings,
	type MirrorUpload,
	type S3Config,
	type UploadOptions,
	type UploadProgress,
	type UploadedMedia,
	type UploadedMediaProviderId
} from '$lib/media/uploaders';

export const STORAGE_KEY = 'bitos:media';

export const DEFAULTS: MediaSettings = {
	defaultProvider: 'blossom',
	cloudinary: { cloudName: '', uploadPreset: '', apiKey: '', apiSecret: '' },
	s3: { bucket: '', region: 'us-east-1', accessKey: '', secretKey: '' }
};

export const MEDIA_PROVIDERS: {
	id: MediaProviderId;
	label: string;
	icon: string;
	description: string;
}[] = [
	{
		id: 'blossom',
		label: 'Free Blossom',
		icon: 'i-lucide-flower-2',
		description: 'Public Nostr media · 20 MiB per file · signed with your account'
	},
	{
		id: 'cloudinary',
		label: 'Cloudinary',
		icon: 'i-lucide-cloud-sun',
		description: 'Unsigned upload preset — safest for browsers'
	},
	{
		id: 's3',
		label: 'S3 / R2 / B2',
		icon: 'i-lucide-database',
		description: 'Direct PUT to S3-compatible storage (AWS SigV4)'
	}
];

export function providerLabel(id: UploadedMediaProviderId | 'none'): string {
	if (id === 'none') return 'None';
	if (id === 'server') return 'BitOS uploads';
	return MEDIA_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

class MediaStore {
	state = $state<MediaSettings>(structuredClone(DEFAULTS));

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<MediaSettings>;
				this.state = {
					...structuredClone(DEFAULTS),
					...parsed,
					cloudinary: { ...DEFAULTS.cloudinary, ...(parsed.cloudinary ?? {}) },
					s3: { ...DEFAULTS.s3, ...(parsed.s3 ?? {}) }
				};
			}
		} catch {
			/* ignore malformed storage */
		}
	};

	private persist = () => {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	};

	setDefaultProvider = (id: MediaProviderId | 'none') => {
		this.state.defaultProvider = id;
		this.persist();
	};

	updateCloudinary = (patch: Partial<CloudinaryConfig>) => {
		this.state.cloudinary = { ...this.state.cloudinary, ...patch };
		this.persist();
	};

	updateS3 = (patch: Partial<S3Config>) => {
		this.state.s3 = { ...this.state.s3, ...patch };
		this.persist();
	};

	reset = () => {
		this.state = structuredClone(DEFAULTS);
		this.persist();
	};

	/** Whether a provider has the minimum fields filled in. */
	isConfigured = (id: MediaProviderId): boolean => {
		if (id === 'blossom') return !!identity.current;
		if (id === 'cloudinary') {
			const c = this.state.cloudinary;
			if (!c.cloudName.trim()) return false;
			// Signed mode (API key + secret) OR an unsigned upload preset.
			const signed = !!(c.apiKey?.trim() && c.apiSecret?.trim());
			return signed || !!c.uploadPreset?.trim();
		}
		const s = this.state.s3;
		return !!s.bucket.trim() && !!s.accessKey.trim() && !!s.secretKey.trim();
	};

	/** Configured providers, in display order. */
	configured = $derived(MEDIA_PROVIDERS.filter((p) => this.isConfigured(p.id)));

	/** Upload a single file via the given (or the default) provider. */
	upload = async (
		file: File,
		provider?: MediaProviderId | 'none',
		options: UploadOptions = {}
	): Promise<UploadedMedia> => {
		const sanitized = await sanitizeMediaForUpload(file);
		return this.dispatch(sanitized, provider ?? this.state.defaultProvider, options);
	};

	/** Provider dispatch over ALREADY-sanitized bytes (see uploadWithMirrors). */
	private dispatch = async (
		sanitized: File,
		id: MediaProviderId | 'none',
		options: UploadOptions = {},
		blossomServer?: string
	): Promise<UploadedMedia> => {
		// Retryable providers only: the server route is our own infra and its
		// failures are visible there, so keep it as a single attempt (plan §11.3).
		const perform = async (candidate: File): Promise<UploadedMedia> => {
			if (id === 'none') {
				return uploadViaServer(candidate, options);
			}
			if (id === 'blossom') {
				const account = identity.current;
				if (!account) throw new Error('Sign in to Nostr before uploading to Blossom');
				return uploadToBlossom(candidate, account.sk, options.onProgress, blossomServer);
			}
			if (id !== 'cloudinary' && id !== 's3') throw new Error(`Unknown provider: ${id}`);
			// Same bytes + purpose retry to the same S3 object key (idempotent).
			return uploadWithProvider(
				candidate,
				id,
				{
					...this.state,
					s3: { ...this.state.s3, idempotencyKey: options.purpose ?? 'media' }
				},
				options.onProgress
			);
		};
		// uploadBlob (PUB-005/006): every provider flows through the
		// hash-normalizing wrapper so descriptors carry a verified `sha256`.
		return uploadWithRetries(
			() => uploadBlob({ ...options, file: sanitized, provider: id }, perform),
			{
				onProgress: options.onProgress,
				onRetry: options.onRetry,
				signal: options.signal,
				attempts: id === 'none' ? 1 : 3
			}
		);
	};

	/**
	 * Multi-destination upload (BitOS canonical + Blossom replicas).
	 *
	 * The BitOS server API is the canonical URL; images and videos under the
	 * Blossom size cap ALSO get a hash-verified replica on EVERY server in
	 * `BLOSSOM_MIRROR_SERVERS`, and each verified replica URL becomes one
	 * NIP-92 `fallback` segment in the signed event.
	 *
	 * Availability semantics — redundancy must not become a hard dependency on
	 * free third-party servers: the BitOS canonical upload is always sufficient
	 * to publish. Verified Blossom replicas become fallback URLs when available;
	 * replica failures degrade silently via `onReplicaError`. All destinations
	 * upload in parallel from ONE
	 * sanitized copy (the sanitizer is not byte-stable, so sanitizing per
	 * destination could diverge the hashes), each replica hash must equal the
	 * canonical hash, and a canonical failure aborts every replica.
	 */
	uploadWithMirrors = async (
		file: File,
		options: UploadOptions & {
			/** Aggregated replica progress (canonical rides `onProgress`). */
			onMirrorProgress?: (progress: UploadProgress) => void;
			/** Fired once before dispatch with the decided destinations. */
			onPlan?: (plan: { mirror: boolean; replicas: number }) => void;
			/** Per replica server that ultimately failed (non-fatal while at
			 *  least one replica verified). */
			onReplicaError?: (info: { server: string; error: string }) => void;
		} = {}
	): Promise<UploadedMedia> => {
		const { onMirrorProgress, onPlan, onReplicaError, ...canonicalOptions } = options;
		const sanitized = await sanitizeMediaForUpload(file);
		const servers = wantsMirrorReplica(sanitized) && identity.current ? BLOSSOM_MIRROR_SERVERS : [];
		onPlan?.({ mirror: servers.length > 0, replicas: servers.length });
		// Immediate 0% pings so the UI can name both destinations right away.
		canonicalOptions.onProgress?.({
			loaded: 0,
			total: sanitized.size,
			percent: 0,
			deterministic: true
		});
		if (servers.length) {
			onMirrorProgress?.({ loaded: 0, total: sanitized.size, percent: 0, deterministic: true });
		}
		if (!servers.length) return this.dispatch(sanitized, 'none', canonicalOptions);

		// Aggregated replica progress: every server reports independently; the
		// UI sees one mean-of-destinations stream. Whole-percent steps keep
		// reactive writes cheap (mirrors xhrUpload's own throttling).
		const replicaPercents = servers.map(() => 0);
		let lastReplicaPercent = -1;
		const reportReplicas = () => {
			const mean = Math.round(replicaPercents.reduce((a, b) => a + b, 0) / servers.length);
			if (mean === lastReplicaPercent) return;
			lastReplicaPercent = mean;
			onMirrorProgress?.({
				loaded: Math.round((mean / 100) * sanitized.size),
				total: sanitized.size,
				percent: mean,
				deterministic: true
			});
		};

		// Cross-abort only for the REQUIRED destination: a canonical failure
		// aborts every replica (the call rejects anyway); a replica failure
		// never touches the others — surviving one is the whole point.
		const callerSignal = canonicalOptions.signal;
		const canonicalCtl = new AbortController();
		const replicaCtls = servers.map(() => new AbortController());
		callerSignal?.addEventListener(
			'abort',
			() => {
				canonicalCtl.abort();
				for (const ctl of replicaCtls) ctl.abort();
			},
			{ once: true }
		);
		const canonicalPromise = this.dispatch(sanitized, 'none', {
			...canonicalOptions,
			signal: canonicalCtl.signal
		}).catch((error) => {
			for (const ctl of replicaCtls) ctl.abort();
			throw error;
		});
		const replicaPromises = servers.map((server, index) =>
			this.dispatch(
				sanitized,
				'blossom',
				{
					...canonicalOptions,
					signal: replicaCtls[index].signal,
					onProgress: (p) => {
						replicaPercents[index] = p.percent;
						reportReplicas();
					}
				},
				server
			).then(
				(replica) => ({ server, replica }),
				(error) => {
					// Non-fatal here — quorum is decided once every server settles.
					const message = (error as Error).message;
					onReplicaError?.({ server, error: message });
					return { server, replica: null, error: message };
				}
			)
		);
		const canonical = await canonicalPromise;
		const settled = await Promise.all(replicaPromises);
		const mirrors: MirrorUpload[] = [];
		for (const outcome of settled) {
			if (!outcome.replica) continue;
			// Same bytes left the browser for every destination: a replica
			// whose verified hash disagrees is discarded, never signed against.
			if (
				outcome.replica.sha256 &&
				canonical.sha256 &&
				outcome.replica.sha256 !== canonical.sha256
			) {
				onReplicaError?.({
					server: outcome.server,
					error: 'replica stored different bytes than the BitOS upload'
				});
				continue;
			}
			mirrors.push({
				url: outcome.replica.url,
				provider: 'blossom',
				sha256: outcome.replica.sha256
			});
		}
		return mirrors.length ? { ...canonical, mirrors } : canonical;
	};
}

export const media = new MediaStore();
