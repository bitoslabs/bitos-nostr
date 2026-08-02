import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { signCloudinaryRequest } from '$lib/media/uploaders';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const PURPOSES = new Set(['note', 'story', 'message', 'profile', 'test']);

function cloudinaryConfig() {
	const cloudName = env.BITOS_CLOUDINARY_CLOUD_NAME?.trim() ?? '';
	const apiKey = env.BITOS_CLOUDINARY_API_KEY?.trim() ?? '';
	const apiSecret = env.BITOS_CLOUDINARY_API_SECRET?.trim() ?? '';
	const uploadPreset = env.BITOS_CLOUDINARY_UPLOAD_PRESET?.trim() ?? '';
	const folder = env.BITOS_CLOUDINARY_FOLDER?.trim() ?? '';

	return {
		cloudName,
		apiKey,
		apiSecret,
		uploadPreset,
		folder,
		enabled: !!cloudName && (!!uploadPreset || !!(apiKey && apiSecret))
	};
}

function safePubkey(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim().toLowerCase();
	return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : '';
}

function safePurpose(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return 'upload';
	const trimmed = value.trim().toLowerCase();
	return PURPOSES.has(trimmed) ? trimmed : 'upload';
}

export async function GET() {
	const cfg = cloudinaryConfig();
	return json({ enabled: cfg.enabled });
}

export async function POST({ request }) {
	const cfg = cloudinaryConfig();
	if (!cfg.enabled) {
		return json(
			{ error: 'Server media uploads are not configured' },
			{ status: 503 }
		);
	}

	const formData = await request.formData();
	const maybeFile = formData.get('file');
	const pubkey = safePubkey(formData.get('pubkey'));
	const purpose = safePurpose(formData.get('purpose'));
	if (!(maybeFile instanceof File)) {
		return json({ error: 'Missing file upload' }, { status: 400 });
	}
	if (!maybeFile.size) {
		return json({ error: 'Uploaded file is empty' }, { status: 400 });
	}
	if (maybeFile.size > MAX_UPLOAD_BYTES) {
		return json({ error: 'File exceeds 100 MB upload limit' }, { status: 413 });
	}

	const upstreamForm = new FormData();
	upstreamForm.append('file', maybeFile);

	const signedParams: Record<string, string> = {};
	if (cfg.uploadPreset) {
		upstreamForm.append('upload_preset', cfg.uploadPreset);
		signedParams.upload_preset = cfg.uploadPreset;
	}
	const folderParts = [cfg.folder || '', 'nostr', pubkey || 'anonymous', purpose]
		.filter(Boolean)
		.map((part) => part.replace(/^\/+|\/+$/g, ''));
	const folder = folderParts.join('/');
	if (folder) {
		upstreamForm.append('folder', folder);
		signedParams.folder = folder;
	}

	if (cfg.apiKey && cfg.apiSecret) {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		signedParams.timestamp = timestamp;
		upstreamForm.append('timestamp', timestamp);
		upstreamForm.append('api_key', cfg.apiKey);
		upstreamForm.append('signature', await signCloudinaryRequest(signedParams, cfg.apiSecret));
	}

	const response = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/auto/upload`, {
		method: 'POST',
		body: upstreamForm
	});

	let payload: Record<string, unknown> | null = null;
	try {
		payload = (await response.json()) as Record<string, unknown>;
	} catch {
		payload = null;
	}

	if (!response.ok) {
		const detail =
			typeof payload?.error === 'object' && payload?.error && 'message' in payload.error
				? String(payload.error.message)
				: `${response.status} ${response.statusText}`;
		return json({ error: `Cloudinary upload failed: ${detail}` }, { status: response.status });
	}

	const resourceType = String(payload?.resource_type ?? '');
	const kind = resourceType === 'video' ? 'video' : resourceType === 'image' ? 'image' : 'file';
	const format = typeof payload?.format === 'string' ? payload.format : '';

	return json({
		url: String(payload?.secure_url ?? ''),
		kind,
		mimeType: format ? `${resourceType}/${format}` : maybeFile.type || 'application/octet-stream',
		bytes: typeof payload?.bytes === 'number' ? payload.bytes : maybeFile.size,
		provider: 'server'
	});
}
