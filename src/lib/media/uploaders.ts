/**
 * Media upload providers — framework-agnostic helpers used by the media store.
 *
 * Three providers are supported, all of which work fully client-side:
 *
 *   • Cloudinary  — unsigned "upload preset" flow (the recommended, safe model
 *                   for browser uploads; the secret API key never ships to the
 *                   client).
 *   • S3 / R2     — direct PUT using an AWS Signature V4 signer built on the
 *                   Web Crypto API. Works against AWS S3 and S3-compatible
 *                   stores (Cloudflare R2, MinIO, Backblaze B2, …). The bucket
 *                   must have CORS configured to allow PUT from this origin.
 *   • Blossom     — Nostr-authorized uploads to a Blossom server. The built-in
 *                   option uses nostr.build's free shared endpoint.
 */
import { finalizeEvent } from 'nostr-tools/pure';
import { hexToBytes } from '$lib/nostr/hex';

export type MediaProviderId = 'blossom' | 'cloudinary' | 's3';
export type UploadedMediaProviderId = MediaProviderId | 'server';
export type UploadPurpose = 'note' | 'story' | 'message' | 'group' | 'profile' | 'test';

export interface UploadOptions {
	pubkey?: string;
	purpose?: UploadPurpose;
	/** Called as bytes leave the browser. `percent` is 0–100 when deterministic. */
	onProgress?: (progress: UploadProgress) => void;
	/** Notified before each retryable failure is retried. */
	onRetry?: (info: { attempt: number; delayMs: number; error: UploadError }) => void;
	/** Aborts the upload attempt sequence where providers support it. */
	signal?: AbortSignal;
}

export interface UploadProgress {
	loaded: number;
	total: number;
	/** 0–100; only meaningful when `deterministic` is true. */
	percent: number;
	/** False when the server did not advertise a content length (indeterminate). */
	deterministic: boolean;
}

export interface CloudinaryConfig {
	/** Cloud name (the `xxxxx` in `res.cloudinary.com/xxxxx`). */
	cloudName: string;
	/** Unsigned upload preset name. Required when no API key/secret are set. */
	uploadPreset?: string;
	/** API key — enables signed uploads when paired with the API secret. */
	apiKey?: string;
	/** API secret — enables signed uploads. Stored only on this device. */
	apiSecret?: string;
	/** Optional folder prefix applied on upload. */
	folder?: string;
}

export interface S3Config {
	bucket: string;
	/** AWS region, or `auto` for Cloudflare R2. */
	region: string;
	/** Optional S3-compatible endpoint base, e.g. `https://<acct>.r2.cloudflarestorage.com`. */
	endpoint?: string;
	accessKey: string;
	secretKey: string;
	/** Public base used when referencing the uploaded file (CDN / custom domain). */
	publicUrlBase?: string;
	/** Optional key prefix (folder). */
	folder?: string;
	/** Stability hint folded into the object key so retries reuse the same path. */
	idempotencyKey?: string;
}

export const FREE_BLOSSOM_SERVER = 'https://blossom.nostr.build';

export interface MediaSettings {
	defaultProvider: MediaProviderId | 'none';
	cloudinary: CloudinaryConfig;
	s3: S3Config;
}

export interface UploadedMedia {
	url: string;
	kind: 'image' | 'video' | 'file';
	mimeType: string;
	bytes: number;
	provider: UploadedMediaProviderId;
	/** Verified SHA-256 blob hash when the flow could confirm bytes. */
	sha256?: string;
}

type BlossomDescriptor = {
	url?: string;
	sha256?: string;
	size?: number;
	type?: string;
	nip94?: { tags?: string[][] };
};

function base64Encode(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function sha256(file: File): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
	return toHex(digest);
}

/** Upload a file with the BUD-02/BUD-11 Blossom authorization flow. */
export async function uploadToBlossom(
	file: File,
	secretKey: string,
	onProgress?: (progress: UploadProgress) => void,
	server = FREE_BLOSSOM_SERVER
): Promise<UploadedMedia> {
	const hash = await sha256(file);
	const now = Math.floor(Date.now() / 1000);
	const host = new URL(server).host;
	const authorization = finalizeEvent(
		{
			kind: 24242,
			created_at: now,
			tags: [
				['t', 'upload'],
				['x', hash],
				['expiration', String(now + 60)],
				['server', host]
			],
			content: 'Upload blob'
		},
		hexToBytes(secretKey)
	);
	const response = await xhrUpload(
		`${server.replace(/\/$/, '')}/upload`,
		{
			method: 'PUT',
			headers: {
				Authorization: `Nostr ${base64Encode(JSON.stringify(authorization))}`,
				'Content-Type': file.type || 'application/octet-stream'
			},
			body: file
		},
		onProgress
	);
	const body = await response.text();
	if (!response.ok) {
		throw new Error(body || `Blossom upload failed: ${response.status} ${response.statusText}`);
	}
	let descriptor: BlossomDescriptor;
	try {
		descriptor = JSON.parse(body) as BlossomDescriptor;
	} catch {
		throw new Error('Blossom upload succeeded without a valid response');
	}
	const tags = descriptor.nip94?.tags ?? [];
	const url = descriptor.url ?? tags.find(([name]) => name === 'url')?.[1];
	if (!url) throw new Error('Blossom upload succeeded without a media URL');
	// Verify the server stored the exact bytes we sent (plan §11.3 hash check).
	const returnedHash = descriptor.sha256 ?? tags.find(([name]) => name === 'x')?.[1];
	if (returnedHash && returnedHash.toLowerCase() !== hash) {
		throw new UploadError('Blossom stored different bytes than were uploaded', {
			retryable: true
		});
	}
	onProgress?.({ loaded: file.size, total: file.size, percent: 100, deterministic: true });
	return {
		url,
		kind: classifyMime(descriptor.type ?? file.type),
		mimeType: descriptor.type ?? file.type ?? 'application/octet-stream',
		bytes: descriptor.size ?? file.size,
		provider: 'blossom',
		// Locally computed and server-confirmed (when the server echoed it).
		sha256: hash
	};
}

export function classifyMime(mime: string): UploadedMedia['kind'] {
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('video/')) return 'video';
	return 'file';
}

function humanBytes(n: number): string {
	if (!n) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
	return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
export { humanBytes };

/* --------------------------------------------------------------------------
   Progress-capable HTTP upload (XHR)

   fetch() cannot report upload progress; XMLHttpRequest can. The helper
   mirrors the response handling the previous fetch() calls used (status,
   statusText, text(), json()) and throttles progress events to whole-percent
   steps so $state writes stay cheap.
---------------------------------------------------------------------------- */

interface XhrResponse {
	status: number;
	statusText: string;
	/** True for any 2xx response — parity with fetch's Response.ok. */
	ok: boolean;
	text: () => Promise<string>;
	json: () => Promise<unknown>;
}

function xhrUpload(
	url: string,
	init: { method: string; headers?: Record<string, string>; body: XMLHttpRequestBodyInit },
	onProgress?: (progress: UploadProgress) => void
): Promise<XhrResponse> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(init.method, url);
		for (const [name, value] of Object.entries(init.headers ?? {})) {
			xhr.setRequestHeader(name, value);
		}
		let lastPercent = -1;
		xhr.upload.onprogress = (event) => {
			if (!onProgress) return;
			const deterministic = event.lengthComputable && event.total > 0;
			const percent = deterministic
				? Math.min(99, Math.round((event.loaded / event.total) * 100))
				: 0;
			// Whole-percent steps keep reactive updates cheap without visible stutter.
			if (deterministic && percent === lastPercent) return;
			lastPercent = percent;
			onProgress({ loaded: event.loaded, total: event.total, percent, deterministic });
		};
		xhr.onerror = () => reject(new Error('Network error during upload'));
		xhr.onabort = () => reject(new Error('Upload cancelled'));
		xhr.onload = () => {
			const body = xhr.responseText ?? '';
			resolve({
				status: xhr.status,
				statusText: xhr.statusText,
				ok: xhr.status >= 200 && xhr.status < 300,
				text: () => Promise.resolve(body),
				json: () => {
					try {
						return Promise.resolve(JSON.parse(body) as unknown);
					} catch {
						return Promise.reject(new Error('Invalid JSON response'));
					}
				}
			});
		};
		xhr.send(init.body);
	});
}

/* --------------------------------------------------------------------------
   Cloudinary — unsigned preset OR signed (API key + secret) upload
-------------------------------------------------------------------------- */

/** Cloudinary signature: SHA-1 hex of (params sorted by key, joined as `k=v` by `&`, then api_secret appended). */
export async function signCloudinaryRequest(
	params: Record<string, string>,
	apiSecret: string
): Promise<string> {
	const stringToSign =
		Object.keys(params)
			.sort()
			.map((k) => `${k}=${params[k]}`)
			.join('&') + apiSecret;
	const digest = await crypto.subtle.digest('SHA-1', encoder.encode(stringToSign));
	return toHex(digest);
}

export async function uploadToCloudinary(
	file: File,
	cfg: CloudinaryConfig,
	onProgress?: (progress: UploadProgress) => void
): Promise<UploadedMedia> {
	const cloudName = cfg.cloudName?.trim();
	if (!cloudName) throw new Error('Cloudinary cloud name is not configured');

	const apiKey = cfg.apiKey?.trim();
	const apiSecret = cfg.apiSecret?.trim();
	const uploadPreset = cfg.uploadPreset?.trim();
	const folder = cfg.folder?.trim();

	// Signed uploads need the API key + secret; otherwise an unsigned preset is required.
	const signedMode = !!(apiKey && apiSecret);
	if (!signedMode && !uploadPreset) {
		throw new Error('Cloudinary needs an unsigned upload preset, or an API key + API secret');
	}

	const form = new FormData();
	form.append('file', file);

	// Parameters that participate in the signature (everything except file/signature/api_key).
	const signedParams: Record<string, string> = {};
	if (signedMode) {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		signedParams.timestamp = timestamp;
		form.append('timestamp', timestamp);
		form.append('api_key', apiKey);
	}
	if (!signedMode && uploadPreset) {
		form.append('upload_preset', uploadPreset);
		signedParams.upload_preset = uploadPreset;
	}
	if (folder) {
		form.append('folder', folder);
		signedParams.folder = folder;
	}

	if (signedMode) {
		const signature = await signCloudinaryRequest(signedParams, apiSecret);
		form.append('signature', signature);
	}

	const res = await xhrUpload(
		`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
		{ method: 'POST', body: form },
		onProgress
	);

	if (!res.ok) {
		let detail = `${res.status} ${res.statusText}`;
		try {
			const body = (await res.json()) as { error?: { message?: string } };
			detail = body?.error?.message || detail;
		} catch {
			/* ignore non-json error bodies */
		}
		throw new Error(`Cloudinary upload failed: ${detail}`);
	}

	const data = (await res.json()) as {
		secure_url: string;
		resource_type: string;
		format: string;
		bytes: number;
	};
	const kind =
		data.resource_type === 'video' ? 'video' : data.resource_type === 'image' ? 'image' : 'file';
	return {
		url: data.secure_url as string,
		kind,
		mimeType: data.format
			? `${data.resource_type}/${data.format}`
			: file.type || 'application/octet-stream',
		bytes: typeof data.bytes === 'number' ? data.bytes : file.size,
		provider: 'cloudinary'
	};
}

/* --------------------------------------------------------------------------
   S3 / S3-compatible — AWS Signature V4 direct PUT
-------------------------------------------------------------------------- */
const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
export { toHex };

async function sha256Hex(data: string | BufferSource): Promise<string> {
	const buf = typeof data === 'string' ? encoder.encode(data) : data;
	return toHex(await crypto.subtle.digest('SHA-256', buf));
}

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

/** Derive the AWS SigV4 signing key (AWS4 prefix → date → region → service → aws4_request). */
export async function getSigningKey(
	secretAccessKey: string,
	dateStamp: string,
	region: string,
	service: string
): Promise<ArrayBuffer> {
	const kSecret = encoder.encode(`AWS4${secretAccessKey}`);
	const kDate = await hmacSha256(kSecret, dateStamp);
	const kRegion = await hmacSha256(kDate, region);
	const kService = await hmacSha256(kRegion, service);
	return hmacSha256(kService, 'aws4_request');
}

export interface AwsSignInput {
	method: string;
	canonicalUri: string;
	canonicalQueryString: string;
	canonicalHeaders: string;
	signedHeaders: string;
	payloadHash: string;
	amzDate: string;
	dateStamp: string;
	region: string;
	service: string;
	accessKey: string;
	secretKey: string;
}

/** Build the canonical request, string-to-sign, and final Authorization header. */
export async function signAwsRequestV4(input: AwsSignInput): Promise<string> {
	const canonicalRequest = [
		input.method,
		input.canonicalUri,
		input.canonicalQueryString,
		input.canonicalHeaders,
		input.signedHeaders,
		input.payloadHash
	].join('\n');

	const scope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
	const stringToSign = [
		'AWS4-HMAC-SHA256',
		input.amzDate,
		scope,
		await sha256Hex(canonicalRequest)
	].join('\n');

	const signingKey = await getSigningKey(
		input.secretKey,
		input.dateStamp,
		input.region,
		input.service
	);
	const signature = toHex(await hmacSha256(signingKey, stringToSign));
	return `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${input.signedHeaders}, Signature=${signature}`;
}

/** URI-encode a path segment-by-segment so `/` separators are preserved. */
function encodePath(p: string): string {
	return p
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');
}

function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'file';
}

export async function uploadToS3(
	file: File,
	cfg: S3Config,
	onProgress?: (progress: UploadProgress) => void
): Promise<UploadedMedia> {
	const bucket = cfg.bucket?.trim();
	const accessKey = cfg.accessKey?.trim();
	const secretKey = cfg.secretKey?.trim();
	if (!bucket) throw new Error('S3 bucket is not configured');
	if (!accessKey) throw new Error('S3 access key is not configured');
	if (!secretKey) throw new Error('S3 secret key is not configured');

	const region = cfg.region?.trim() || 'us-east-1';
	const endpoint = cfg.endpoint?.trim().replace(/\/+$/, '') || '';
	const folderPrefix = cfg.folder?.trim().replace(/^\/+|\/+$/g, '');

	// Content-derived stem makes retries idempotent: the same bytes + hint PUT
	// to the same object key instead of orphaning duplicate copies (plan §11.3).
	const fileBuffer = await file.arrayBuffer();
	const payloadHash = toHex(await crypto.subtle.digest('SHA-256', fileBuffer));
	const idem = cfg.idempotencyKey?.trim();
	const uniquePart = idem
		? `${payloadHash.slice(0, 24)}-${sanitizeName(idem).slice(0, 40)}`
		: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const objectKey = [
		...(folderPrefix ? folderPrefix.split('/') : []),
		`${uniquePart}-${sanitizeName(file.name)}`
	].join('/');
	const encodedKey = encodePath(objectKey);

	// Resolve host + path-style prefix.
	let host: string;
	let pathPrefix = ''; // prepended to the canonical/public path (path-style)
	let protocol = 'https:';
	if (endpoint) {
		const u = new URL(endpoint);
		protocol = u.protocol;
		host = u.host;
		pathPrefix = `/${bucket}`; // path-style: /<bucket>/<key>
	} else {
		// AWS S3 virtual-hosted style.
		host =
			region === 'us-east-1'
				? `${bucket}.s3.amazonaws.com`
				: `${bucket}.s3.${region}.amazonaws.com`;
	}

	const canonicalUri = `${pathPrefix}/${encodedKey}`;
	const canonicalQueryString = '';

	// Dates.
	const now = new Date();
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
	const dateStamp = amzDate.slice(0, 8);

	const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
	const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

	// `Host` is a forbidden header in fetch; the browser sets it from the URL.
	const url = `${protocol}//${host}${canonicalUri}`;
	const authorization = await signAwsRequestV4({
		method: 'PUT',
		canonicalUri,
		canonicalQueryString,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
		amzDate,
		dateStamp,
		region,
		service: 's3',
		accessKey,
		secretKey
	});

	const res = await xhrUpload(
		url,
		{
			method: 'PUT',
			headers: {
				'x-amz-content-sha256': payloadHash,
				'x-amz-date': amzDate,
				'Content-Type': file.type || 'application/octet-stream',
				Authorization: authorization
			},
			body: file
		},
		onProgress
	);

	if (!res.ok) {
		let detail = `${res.status} ${res.statusText}`;
		try {
			const text = await res.text();
			const match = text.match(/<Message>([\s\S]*?)<\/Message>/);
			if (match) detail = match[1];
		} catch {
			/* ignore */
		}
		throw new Error(`S3 upload failed: ${detail}`);
	}

	// Resolve the public URL used to reference the file.
	let publicUrl: string;
	if (cfg.publicUrlBase?.trim()) {
		publicUrl = `${cfg.publicUrlBase.trim().replace(/\/+$/, '')}/${encodedKey}`;
	} else if (endpoint) {
		publicUrl = `${endpoint}/${bucket}/${encodedKey}`;
	} else {
		publicUrl =
			region === 'us-east-1'
				? `https://${bucket}.s3.amazonaws.com/${encodedKey}`
				: `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
	}

	return {
		url: publicUrl,
		kind: classifyMime(file.type),
		mimeType: file.type || 'application/octet-stream',
		bytes: file.size,
		provider: 's3'
	};
}

export async function uploadViaServer(
	file: File,
	options: UploadOptions = {}
): Promise<UploadedMedia> {
	const params = new URLSearchParams();
	if (options.pubkey) params.set('pubkey', options.pubkey);
	if (options.purpose) params.set('purpose', options.purpose);

	const url = `/api/media/upload${params.toString() ? `?${params}` : ''}`;
	const res = await xhrUpload(
		url,
		{
			method: 'POST',
			headers: { 'X-Upload-Filename': encodeURIComponent(file.name) },
			body: file
		},
		options.onProgress
	);

	let payload: { error?: string } & Partial<UploadedMedia> = {};
	try {
		payload = (await res.json()) as typeof payload;
	} catch {
		payload = {};
	}

	if (!res.ok) {
		throw new Error(payload.error || `Server upload failed: ${res.status} ${res.statusText}`);
	}

	if (!payload.url) throw new Error('Server upload succeeded without a media URL');
	return {
		url: payload.url,
		kind: payload.kind ?? classifyMime(file.type),
		mimeType: payload.mimeType ?? (file.type || 'application/octet-stream'),
		bytes: payload.bytes ?? file.size,
		provider: 'server'
	};
}

/** Dispatch to the configured provider. */
export async function uploadWithProvider(
	file: File,
	provider: MediaProviderId,
	settings: MediaSettings,
	onProgress?: (progress: UploadProgress) => void
): Promise<UploadedMedia> {
	if (provider === 'cloudinary') return uploadToCloudinary(file, settings.cloudinary, onProgress);
	if (provider === 's3') return uploadToS3(file, settings.s3, onProgress);
	throw new Error(`Unknown media provider: ${provider}`);
}

/** Normalized input accepted by `uploadBlob` (plan §6.3 publish pipeline). */
export interface BlobUploadInput {
	/** The exact bytes to upload (`File` — a `Blob` with a name). */
	file: File;
	/** Provider dispatch, mirroring `MediaStore.upload` semantics. */
	provider?: MediaProviderId | 'none';
	pubkey?: string;
	purpose?: UploadPurpose;
	onProgress?: (progress: UploadProgress) => void;
	onRetry?: (info: { attempt: number; delayMs: number; error: UploadError }) => void;
	signal?: AbortSignal;
}

/**
 * Generic blob upload (plan PUB-005) — provider-agnostic, content-addressed.
 *
 * Wraps any provider call so every descriptor is normalized and hash-verified
 * (PUB-006):
 *   • the SHA-256 of the bytes we sent is computed locally, always
 *   • when a provider reports its own hash (Blossom descriptor / `x` tag), a
 *     mismatch is a retryable error — the stored copy is corrupt or the
 *     server raced a concurrent upload of different bytes
 *   • the verified local hash rides on the descriptor as `sha256`, ready for
 *     the kind-22 `imeta x` segment
 *
 * `perform` executes ONE provider attempt; retries/backoff/readability are
 * handled by `uploadWithRetries` exactly as before — no caller breaks.
 */
export async function uploadBlob(
	input: BlobUploadInput,
	perform: (file: File) => Promise<UploadedMedia>
): Promise<UploadedMedia> {
	// Hash once, before any network attempt: retries reuse identical bytes.
	const localHash = await sha256(input.file);
	const uploaded = await perform(input.file);
	const reported = (uploaded as { sha256?: string }).sha256;
	if (reported && reported.toLowerCase() !== localHash) {
		// Server-side bytes differ from what we sent — never sign against them.
		throw new UploadError('Provider stored different bytes than were uploaded', {
			retryable: true
		});
	}
	return { ...uploaded, sha256: localHash };
}

/* --------------------------------------------------------------------------
   Upload resilience (plan §11.3)

   Wraps any provider upload with:
     • exponential backoff + jitter for retryable failures (network errors,
       HTTP 408/429 and 5xx)
     • permanent failures (4xx other than 408/429, invalid responses) that
       fail fast without retrying
     • idempotency: an explicit `idempotencyKey` is hashed into the S3 object
       key so a retry PUTs to the *same* URL instead of leaving orphan copies
     • verification: the returned descriptor URL is HEAD-checked so we never
       sign a publish event pointing at bytes nobody can fetch
---------------------------------------------------------------------------- */

/** Error with an explicit retryability classification (plan §11.3). */
export class UploadError extends Error {
	/** False for permanent failures (bad config, auth, invalid request). */
	readonly retryable: boolean;
	/** HTTP status when the failure came from a response. */
	readonly status?: number;

	constructor(message: string, opts: { retryable: boolean; status?: number; cause?: unknown }) {
		super(message);
		this.name = 'UploadError';
		this.retryable = opts.retryable;
		this.status = opts.status;
		if (opts.cause !== undefined) this.cause = opts.cause;
	}
}

/** Classify a thrown value from a provider upload as retryable or permanent. */
export function classifyUploadError(error: unknown): UploadError {
	if (error instanceof UploadError) return error;
	const message = error instanceof Error ? error.message : String(error);
	// `\bload failed` (Safari fetch) must not match the tail of "upload failed".
	if (/network error|failed to fetch|\bload failed|\btimeout\b|aborted|cancelled/i.test(message)) {
		return new UploadError(message, { retryable: true, cause: error });
	}
	// Provider messages carry their status inline, e.g. "S3 upload failed: 503 ...".
	const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/);
	if (statusMatch) {
		const status = Number(statusMatch[1]);
		const retryable = status === 408 || status === 429 || status >= 500;
		return new UploadError(message, { retryable, status, cause: error });
	}
	// Configuration/validation messages ("not configured", "without a media URL") are permanent.
	return new UploadError(message, { retryable: false, cause: error });
}

export interface ResilientUploadOptions {
	/** Called before each retry attempt with 1-based attempt numbers. */
	onRetry?: (info: { attempt: number; delayMs: number; error: UploadError }) => void;
	/** Progress passthrough. */
	onProgress?: (progress: UploadProgress) => void;
	/** Total attempts including the first (default 3). */
	attempts?: number;
	/** Base backoff in ms; doubles per attempt with ±25% jitter (default 800). */
	baseDelayMs?: number;
	/** Abort the whole upload (checked between attempts). */
	signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new UploadError('Upload cancelled', { retryable: false }));
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(new UploadError('Upload cancelled', { retryable: false }));
			},
			{ once: true }
		);
	});
}

/** True when the URL responds to a HEAD/CORS probe without a terminal status. */
export async function isUrlReadable(url: string, signal?: AbortSignal): Promise<boolean> {
	try {
		const res = await fetch(url, { method: 'HEAD', mode: 'cors', signal });
		// 405/... ⇒ be lenient: some providers reject HEAD but serve GET fine.
		return res.ok || res.status === 405 || res.status === 501;
	} catch {
		return false;
	}
}

/**
 * Upload with retries, backoff+jitter, and a post-upload readability check.
 * `perform` must run one full provider attempt and return the descriptor.
 */
export async function uploadWithRetries(
	perform: () => Promise<UploadedMedia>,
	options: ResilientUploadOptions = {}
): Promise<UploadedMedia> {
	const attempts = Math.max(1, options.attempts ?? 3);
	const baseDelayMs = Math.max(0, options.baseDelayMs ?? 800);

	for (let attempt = 1; ; attempt++) {
		options.signal?.throwIfAborted();
		try {
			const uploaded = await perform();
			// Never hand back a URL we cannot read — the publish event is signed
			// against these bytes (plan §11.3 "readable before signing").
			if (!(await isUrlReadable(uploaded.url, options.signal))) {
				throw new UploadError('Uploaded media is not readable at its URL', { retryable: true });
			}
			return uploaded;
		} catch (error) {
			const classified = classifyUploadError(error);
			if (!classified.retryable || attempt >= attempts) throw classified;
			// Exponential backoff with ±25% jitter so many clients never sync up.
			const jitter = 0.75 + Math.random() * 0.5;
			const delayMs = Math.round(baseDelayMs * 2 ** (attempt - 1) * jitter);
			options.onRetry?.({ attempt, delayMs, error: classified });
			await sleep(delayMs, options.signal);
		}
	}
}
