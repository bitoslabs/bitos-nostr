/**
 * AWS Signature V4 correctness tests.
 *
 * These values are computed with Node's battle-tested `crypto` module, which is
 * treated here as the reference implementation. Because the inputs (secret,
 * date, region, service, canonical request) are identical to AWS's published
 * SigV4 example, matching these outputs proves our Web-Crypto-based signer is
 * correct — not just internally consistent.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
	UploadError,
	classifyUploadError,
	getSigningKey,
	isUrlReadable,
	signAwsRequestV4,
	signCloudinaryRequest,
	toHex,
	uploadBlob,
	uploadWithRetries,
	type UploadedMedia
} from './uploaders';

const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('AWS SigV4 helpers', () => {
	it('derives the signing key matching the reference crypto chain', async () => {
		const key = await getSigningKey(SECRET, '20150830', 'us-east-1', 'iam');
		expect(toHex(key)).toBe('c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
	});

	it('builds a complete Authorization header with a correct signature', async () => {
		const authorization = await signAwsRequestV4({
			method: 'GET',
			canonicalUri: '/',
			canonicalQueryString: '',
			canonicalHeaders: 'host:iam.amazonaws.com\nx-amz-date:20150830T123600Z\n',
			signedHeaders: 'host;x-amz-date',
			payloadHash: EMPTY_SHA,
			amzDate: '20150830T123600Z',
			dateStamp: '20150830',
			region: 'us-east-1',
			service: 'iam',
			accessKey: 'AKIAIOSFODNN7EXAMPLE',
			secretKey: SECRET
		});

		// Canonical-request hash and signature computed independently with Node crypto.
		expect(authorization).toBe(
			'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
				'SignedHeaders=host;x-amz-date, ' +
				'Signature=91fb24346d00546d6da247c85eb79148080a6e3ae1ac9aa8eae9ccdabfd70b33'
		);
	});
});

describe('Cloudinary signature', () => {
	it('produces the SHA-1 signature matching the reference crypto', async () => {
		const sig = await signCloudinaryRequest(
			{ timestamp: '1315060510', upload_preset: 'my_preset' },
			'ABCD'
		);
		expect(sig).toBe('c22f01f08a5bd62009ae0a1941dfb5cd21d01d18');
	});

	it('sorts params including folder before signing', async () => {
		const sig = await signCloudinaryRequest(
			{ folder: 'bitos', timestamp: '1315060510', upload_preset: 'my_preset' },
			'ABCD'
		);
		expect(sig).toBe('1e23a85e3499dc42e90d47c15771834a6beae46c');
	});
});

/* --------------------------------------------------------------------------
   Upload resilience — plan §11.3
---------------------------------------------------------------------------- */

function makeMedia(url = 'https://cdn.example/x.jpg'): UploadedMedia {
	return { url, kind: 'image', mimeType: 'image/jpeg', bytes: 10, provider: 'cloudinary' };
}

// Node/server project: fetch() would hit the network — stub the readability probe.
vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Response(null, { status: 200 }))
);

describe('classifyUploadError', () => {
	it('marks network-style errors retryable', () => {
		for (const message of [
			'Network error during upload',
			'Failed to fetch',
			'timeout while connecting'
		]) {
			expect(classifyUploadError(new Error(message)).retryable).toBe(true);
		}
	});

	it('marks 408/429/5xx retryable and other 4xx permanent', () => {
		expect(classifyUploadError(new Error('S3 upload failed: 503 Slow Down')).retryable).toBe(true);
		expect(classifyUploadError(new Error('Cloudinary upload failed: 429 rate')).retryable).toBe(
			true
		);
		const permanent = classifyUploadError(new Error('Cloudinary upload failed: 401 nope'));
		expect(permanent.retryable).toBe(false);
		expect(permanent.status).toBe(401);
	});

	it('treats configuration errors as permanent', () => {
		expect(classifyUploadError(new Error('S3 bucket is not configured')).retryable).toBe(false);
		expect(
			classifyUploadError(new Error('Blossom upload succeeded without a media URL')).retryable
		).toBe(false);
	});

	it('passes UploadError instances through unchanged', () => {
		const original = new UploadError('x', { retryable: true, status: 503 });
		expect(classifyUploadError(original)).toBe(original);
	});
});

describe('uploadWithRetries', () => {
	it('returns the first successful result after retries succeed', async () => {
		let calls = 0;
		const onRetry = vi.fn();
		const result = await uploadWithRetries(
			async () => {
				calls++;
				if (calls < 3) throw new Error('Network error during upload');
				return makeMedia();
			},
			{ attempts: 3, baseDelayMs: 0, onRetry }
		);
		expect(calls).toBe(3);
		expect(result.url).toBe('https://cdn.example/x.jpg');
		expect(onRetry).toHaveBeenCalledTimes(2);
	});

	it('fails fast on permanent errors without retrying', async () => {
		let calls = 0;
		await expect(
			uploadWithRetries(
				async () => {
					calls++;
					throw new Error('Cloudinary upload failed: 401 invalid');
				},
				{ attempts: 3, baseDelayMs: 0 }
			)
		).rejects.toMatchObject({ retryable: false, status: 401 });
		expect(calls).toBe(1);
	});

	it('gives up after the attempt budget and reports the last error', async () => {
		let calls = 0;
		await expect(
			uploadWithRetries(
				async () => {
					calls++;
					throw new UploadError('flaky', { retryable: true, status: 503 });
				},
				{ attempts: 2, baseDelayMs: 0 }
			)
		).rejects.toMatchObject({ retryable: true, status: 503 });
		expect(calls).toBe(2);
	});

	it('rejects unreadable URLs as a retryable error', async () => {
		(fetch as Mock).mockResolvedValueOnce(new Response(null, { status: 404 }));
		let calls = 0;
		await expect(
			uploadWithRetries(
				async () => {
					calls++;
					return makeMedia();
				},
				{ attempts: 1 }
			)
		).rejects.toMatchObject({ retryable: true });
		expect(calls).toBe(1);
	});
});

describe('isUrlReadable', () => {
	it('accepts 2xx and HEAD-rejected providers', async () => {
		expect(await isUrlReadable('https://ok.example/a.jpg')).toBe(true);
		(fetch as Mock).mockResolvedValueOnce(new Response(null, { status: 405 }));
		expect(await isUrlReadable('https://headless.example/a.jpg')).toBe(true);
	});

	it('rejects failed probes without throwing', async () => {
		(fetch as Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
		expect(await isUrlReadable('https://dead.example/a.jpg')).toBe(false);
	});
});

/* --------------------------------------------------------------------------
   uploadBlob — plan PUB-005/PUB-006
---------------------------------------------------------------------------- */

function makeFile(bytes = ''): File {
	return new File([bytes], 'clip.mp4', { type: 'video/mp4' });
}

describe('uploadBlob (PUB-005/PUB-006)', () => {
	it('normalizes any provider descriptor with the locally computed hash', async () => {
		const seen: File[] = [];
		const uploaded = await uploadBlob({ file: makeFile() }, async (file) => {
			seen.push(file);
			// Cloudinary/S3-style descriptor with no server-side hash.
			return makeMedia();
		});
		expect(seen).toHaveLength(1);
		expect(uploaded.sha256).toBe(EMPTY_SHA);
		expect(uploaded.url).toBe('https://cdn.example/x.jpg');
	});

	it('keeps the descriptor hash equal to the verified local hash', async () => {
		const uploaded = await uploadBlob({ file: makeFile() }, async () => ({
			...makeMedia(),
			// Provider echoed the same hash back (Blossom parity case).
			sha256: EMPTY_SHA
		}));
		expect(uploaded.sha256).toBe(EMPTY_SHA);
	});

	it('treats a provider-reported hash mismatch as retryable corruption', async () => {
		await expect(
			uploadBlob({ file: makeFile() }, async () => ({
				...makeMedia(),
				sha256: 'ff'.repeat(32)
			}))
		).rejects.toMatchObject({
			retryable: true,
			message: expect.stringContaining('different bytes')
		});
	});

	it('passes the exact input file to the provider attempt untouched', async () => {
		const file = makeFile('payload');
		let received: File | undefined;
		await uploadBlob({ file }, async (candidate) => {
			received = candidate;
			return makeMedia();
		});
		expect(received).toBe(file);
	});

	it('verifies with different bytes producing a different local hash', async () => {
		const uploaded = await uploadBlob({ file: makeFile('abc') }, async () => makeMedia());
		expect(uploaded.sha256).not.toBe(EMPTY_SHA);
		expect(uploaded.sha256).toMatch(/^[0-9a-f]{64}$/);
	});
});
