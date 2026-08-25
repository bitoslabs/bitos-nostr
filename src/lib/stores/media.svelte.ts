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
	type CloudinaryConfig,
	type MediaProviderId,
	type MediaSettings,
	type S3Config,
	type UploadOptions,
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
		provider?: MediaProviderId,
		options: UploadOptions = {}
	): Promise<UploadedMedia> => {
		const sanitized = await sanitizeMediaForUpload(file);
		const id = provider ?? this.state.defaultProvider;
		// Retryable providers only: the server route is our own infra and its
		// failures are visible there, so keep it as a single attempt (plan §11.3).
		const perform = async (candidate: File): Promise<UploadedMedia> => {
			if (id === 'none') {
				return uploadViaServer(candidate, options);
			}
			if (id === 'blossom') {
				const account = identity.current;
				if (!account) throw new Error('Sign in to Nostr before uploading to Blossom');
				return uploadToBlossom(candidate, account.sk, options.onProgress);
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
}

export const media = new MediaStore();
