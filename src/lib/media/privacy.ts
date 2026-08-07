const EXTENSION_BY_MIME: Record<string, string> = {
	'image/avif': 'avif',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'video/mp4': 'mp4',
	'video/quicktime': 'mov',
	'video/webm': 'webm'
};

const IMAGE_METADATA_STRIP_MIMES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);

function extensionForMime(mime: string): string {
	return EXTENSION_BY_MIME[mime] ?? 'bin';
}

export function buildNeutralUploadName(file: File): string {
	const mime = file.type.trim().toLowerCase();
	const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
	return `bitos-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionForMime(mime)}`;
}

export function canStripImageMetadata(file: File): boolean {
	return IMAGE_METADATA_STRIP_MIMES.has(file.type.trim().toLowerCase());
}

async function loadImageBitmap(file: File): Promise<ImageBitmap | null> {
	if (typeof createImageBitmap === 'function') {
		try {
			return await createImageBitmap(file);
		} catch {
			/* fall through to HTMLImageElement path */
		}
	}

	if (typeof Image === 'undefined') return null;

	const objectUrl = URL.createObjectURL(file);
	try {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Could not decode image'));
			img.src = objectUrl;
		});
		const canvas = document.createElement('canvas');
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Could not create canvas context');
		ctx.drawImage(img, 0, 0);
		return await createImageBitmap(canvas);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

async function stripImageMetadata(file: File): Promise<File> {
	const bitmap = await loadImageBitmap(file);
	if (!bitmap) {
		return new File([file], buildNeutralUploadName(file), {
			type: file.type,
			lastModified: Date.now()
		});
	}

	try {
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Could not create canvas context');
		ctx.drawImage(bitmap, 0, 0);
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((next) => {
				if (next) resolve(next);
				else reject(new Error('Could not encode sanitized image'));
			}, file.type || 'image/jpeg');
		});
		return new File([blob], buildNeutralUploadName(file), {
			type: blob.type || file.type,
			lastModified: Date.now()
		});
	} finally {
		bitmap.close();
	}
}

export async function sanitizeMediaForUpload(file: File): Promise<File> {
	if (canStripImageMetadata(file)) {
		try {
			return await stripImageMetadata(file);
		} catch {
			// If sanitization fails, still avoid leaking the original filename.
		}
	}

	return new File([file], buildNeutralUploadName(file), {
		type: file.type,
		lastModified: Date.now()
	});
}
