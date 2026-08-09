/**
 * Minimal, dependency-free BlurHash decoder.
 *
 * Decodes a BlurHash string (https://blurha.sh / NIP-92 `blurhash` field) into an
 * RGBA pixel buffer, then paints it onto a tiny <canvas> → PNG data URL that can
 * be used as an instant <img> placeholder while the real media loads. This is
 * the same trick YakiHonne / Instagram / X use to avoid layout shift and give a
 * perceived-instant paint before bytes arrive.
 *
 * Reference implementation: woltapp/blurhash (MIT). No runtime deps added.
 */

const ALPHABET =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%*+,-.:;=?@[]^_{|}~';

const ALPHABET_MAP: Record<string, number> = (() => {
	const map: Record<string, number> = {};
	for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET[i]] = i;
	return map;
})();

function decode83(str: string): number {
	let value = 0;
	for (let i = 0; i < str.length; i++) {
		value = value * 83 + (ALPHABET_MAP[str[i]] ?? -1);
	}
	return value;
}

function srgbToLinear(value: number): number {
	const v = value / 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToEncoded(value: number): number {
	const v = Math.max(0, Math.min(1, value));
	return v <= 0.0031308
		? Math.round(v * 12.92 * 255 + 0.5)
		: Math.round((1.055 * Math.pow(v, 0.4166666666666667) - 0.055) * 255 + 0.5);
}

function signPow(value: number, exp: number): number {
	return Math.sign(value) * Math.pow(Math.abs(value), exp);
}

function decodeDC(value: number): [number, number, number] {
	return [
		srgbToLinear((value >> 16) & 255),
		srgbToLinear((value >> 8) & 255),
		srgbToLinear(value & 255)
	];
}

function decodeAC(value: number, maximumValue: number): [number, number, number] {
	const quantR = Math.floor(value / (19 * 19));
	const quantG = Math.floor(value / 19) % 19;
	const quantB = value % 19;
	return [
		signPow((quantR - 9) / 9, 2) * maximumValue,
		signPow((quantG - 9) / 9, 2) * maximumValue,
		signPow((quantB - 9) / 9, 2) * maximumValue
	];
}

/**
 * Decode a BlurHash into raw RGBA pixels at the given dimensions.
 * Returns `null` for malformed input instead of throwing.
 */
export function decodeBlurHash(
	blurhash: string,
	width: number,
	height: number,
	punch = 1
): Uint8ClampedArray | null {
	if (!blurhash || blurhash.length < 6) return null;
	try {
		const sizeFlag = decode83(blurhash[0]);
		const numY = Math.floor(sizeFlag / 9) + 1;
		const numX = (sizeFlag % 9) + 1;

		const quantisedMaximumValue = decode83(blurhash[1]);
		const maximumValue = (quantisedMaximumValue + 1) / 166;

		// A valid hash needs: 1 (size) + 1 (max) + 4 (DC) + 2 per AC component.
		const expectedLength = 4 + 2 * numX * numY;
		if (blurhash.length < expectedLength) return null;

		const colors: [number, number, number][] = new Array(numX * numY);
		for (let i = 0; i < colors.length; i++) {
			if (i === 0) {
				colors[i] = decodeDC(decode83(blurhash.substring(2, 6)));
			} else {
				const start = 4 + i * 2;
				colors[i] = decodeAC(decode83(blurhash.substring(start, start + 2)), maximumValue * punch);
			}
		}

		const bytesPerRow = width * 4;
		const pixels = new Uint8ClampedArray(bytesPerRow * height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				let r = 0;
				let g = 0;
				let b = 0;
				for (let j = 0; j < numY; j++) {
					for (let i = 0; i < numX; i++) {
						const basis =
							Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
						const color = colors[i + j * numX];
						r += color[0] * basis;
						g += color[1] * basis;
						b += color[2] * basis;
					}
				}
				const idx = 4 * x + y * bytesPerRow;
				pixels[idx] = linearToEncoded(r);
				pixels[idx + 1] = linearToEncoded(g);
				pixels[idx + 2] = linearToEncoded(b);
				pixels[idx + 3] = 255;
			}
		}
		return pixels;
	} catch {
		return null;
	}
}

const dataUrlCache = new Map<string, string>();

/**
 * Decode a BlurHash to a cached PNG data URL. Tiny canvases (~32px) keep this
 * cheap; results are memoised by hash + size so repeated notifications reuse
 * the same placeholder. Browser-only (needs a <canvas>).
 */
export function blurhashToDataUrl(
	hash: string,
	width = 32,
	height = 32,
	punch = 1
): string | undefined {
	if (!hash) return undefined;
	const key = `${hash}|${width}x${height}|${punch}`;
	const cached = dataUrlCache.get(key);
	if (cached) return cached;

	const pixels = decodeBlurHash(hash, width, height, punch);
	if (!pixels) return undefined;
	if (typeof document === 'undefined') return undefined;

	try {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return undefined;
		const imageData = ctx.createImageData(width, height);
		imageData.data.set(pixels);
		ctx.putImageData(imageData, 0, 0);
		const url = canvas.toDataURL('image/png');
		if (dataUrlCache.size > 256) dataUrlCache.clear();
		dataUrlCache.set(key, url);
		return url;
	} catch {
		return undefined;
	}
}
