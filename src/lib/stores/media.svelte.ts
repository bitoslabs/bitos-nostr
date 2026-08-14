/**
 * Media upload settings — runes-based singleton persisted to localStorage.
 *
 * Stores credentials for Cloudinary + S3-compatible providers and the default
 * provider used by the composer. Like the rest of BitOS this is local-first:
 * the S3 secret key lives on-device (same trust model as the Nostr nsec).
 */
import { browser } from '$app/environment';
import { sanitizeMediaForUpload } from '$lib/media/privacy';
import {
	uploadViaServer,
	uploadWithProvider,
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
	defaultProvider: 'none',
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
		if (id === 'none') {
			return uploadViaServer(sanitized, options);
		}
		if (id !== 'cloudinary' && id !== 's3') throw new Error(`Unknown provider: ${id}`);
		return uploadWithProvider(sanitized, id, this.state, options.onProgress);
	};
}

export const media = new MediaStore();
