import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * uploadWithMirrors — the multi-destination upload policy (BitOS canonical +
 * Blossom replicas on every mirror server) in isolation. Provider transports
 * are mocked; the real hash chain (uploadBlob) and retry/readability wrapper
 * stay live so the verified `sha256` contract is exercised end-to-end.
 */

vi.mock('$app/environment', () => ({ browser: false }));

const account = vi.hoisted(() => ({
	current: null as null | { pk: string; sk: string }
}));

vi.mock('$lib/nostr/identity.svelte', () => ({
	identity: {
		get current() {
			return account.current;
		}
	}
}));

// The sanitizer is byte-unstable by design (fresh names, re-encoded pixels);
// pin it to identity so every destination dispatches the exact same bytes.
vi.mock('$lib/media/privacy', () => ({
	sanitizeMediaForUpload: async (file: File) => file
}));

vi.mock('$lib/media/uploaders', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		uploadViaServer: vi.fn(),
		uploadToBlossom: vi.fn()
	};
});

// uploadWithRetries HEAD-checks every returned URL — stub the network.
vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Response(null, { status: 200 }))
);

const { media } = await import('./media.svelte');
const { uploadViaServer, uploadToBlossom, BLOSSOM_MIRROR_SERVERS, MIRROR_REPLICA_MAX_BYTES } =
	await import('$lib/media/uploaders');

function videoFile(bytes = 4096, name = 'bitz.mp4'): File {
	return new File([new Uint8Array(bytes)], name, { type: 'video/mp4' });
}

function serverDescriptor(file: File) {
	return {
		url: 'https://bitos.example/canonical.mp4',
		kind: 'video' as const,
		mimeType: 'video/mp4',
		bytes: file.size,
		provider: 'server' as const
	};
}

/** Deterministic per-server blossom transport: one URL per mirror server. */
function blossomTransport() {
	vi.mocked(uploadToBlossom).mockImplementation(
		async (_file: File, _sk: string, _onProgress: unknown, server?: string) => ({
			url: `https://${new URL(server ?? 'https://x.invalid').host}/replica.mp4`,
			kind: 'video' as const,
			mimeType: 'video/mp4',
			bytes: _file.size,
			provider: 'blossom' as const
		})
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	account.current = { pk: 'a'.repeat(64), sk: 'b'.repeat(64) };
	vi.mocked(uploadViaServer).mockImplementation(async (file: File) => serverDescriptor(file));
	blossomTransport();
});

describe('media.uploadWithMirrors', () => {
	it('uploads small videos to BitOS AND a replica on every mirror server', async () => {
		const file = videoFile();
		const plans: { mirror: boolean; replicas: number }[] = [];

		const result = await media.uploadWithMirrors(file, {
			onPlan: (plan) => plans.push(plan)
		});

		expect(result.url).toBe('https://bitos.example/canonical.mp4');
		expect(result.provider).toBe('server');
		expect(result.mirrors).toHaveLength(BLOSSOM_MIRROR_SERVERS.length);
		// One sanitized copy fed every destination: replicas and canonical
		// ride the same locally-verified hash chain.
		expect(result.mirrors!.every((m) => m.sha256 === result.sha256)).toBe(true);
		expect(result.mirrors!.map((m) => m.url).sort()).toEqual(
			BLOSSOM_MIRROR_SERVERS.map((s) => `https://${new URL(s).host}/replica.mp4`).sort()
		);
		expect(uploadViaServer).toHaveBeenCalledTimes(1);
		expect(uploadToBlossom).toHaveBeenCalledTimes(BLOSSOM_MIRROR_SERVERS.length);
		expect(plans).toEqual([{ mirror: true, replicas: BLOSSOM_MIRROR_SERVERS.length }]);
	});

	it('reports per-destination progress for both servers', async () => {
		const file = videoFile();
		const canonical: number[] = [];
		const replica: number[] = [];

		await media.uploadWithMirrors(file, {
			onProgress: (p) => canonical.push(p.percent),
			onMirrorProgress: (p) => replica.push(p.percent)
		});

		// The immediate 0% pings let the UI name both destinations up front.
		expect(canonical[0]).toBe(0);
		expect(replica[0]).toBe(0);
	});

	it('keeps large videos on the single BitOS destination', async () => {
		const file = videoFile(MIRROR_REPLICA_MAX_BYTES + 1);
		const plans: { mirror: boolean; replicas: number }[] = [];

		const result = await media.uploadWithMirrors(file, {
			onPlan: (plan) => plans.push(plan)
		});

		expect(result.mirrors).toBeUndefined();
		expect(uploadViaServer).toHaveBeenCalledTimes(1);
		expect(uploadToBlossom).not.toHaveBeenCalled();
		expect(plans).toEqual([{ mirror: false, replicas: 0 }]);
	});

	it('degrades to single-destination when no Nostr identity is available', async () => {
		account.current = null;
		const file = videoFile();
		const plans: { mirror: boolean; replicas: number }[] = [];

		const result = await media.uploadWithMirrors(file, {
			onPlan: (plan) => plans.push(plan)
		});

		expect(result.mirrors).toBeUndefined();
		expect(uploadToBlossom).not.toHaveBeenCalled();
		expect(plans).toEqual([{ mirror: false, replicas: 0 }]);
	});

	it('survives one mirror server failing (quorum of the rest)', async () => {
		const file = videoFile();
		vi.mocked(uploadToBlossom).mockImplementation(
			async (_file: File, _sk: string, _onProgress: unknown, server?: string) => {
				// Permanent (non-retryable) failure keeps the test fast.
				if (server === BLOSSOM_MIRROR_SERVERS[1]) {
					throw new Error('Blossom upload failed: 401 unauthorized');
				}
				return {
					url: `https://${new URL(server ?? 'https://x.invalid').host}/replica.mp4`,
					kind: 'video' as const,
					mimeType: 'video/mp4',
					bytes: _file.size,
					provider: 'blossom' as const
				};
			}
		);
		const replicaErrors: { server: string; error: string }[] = [];

		const result = await media.uploadWithMirrors(file, {
			onReplicaError: (info) => replicaErrors.push(info)
		});

		expect(result.mirrors).toHaveLength(1);
		expect(result.mirrors![0].url).toContain(new URL(BLOSSOM_MIRROR_SERVERS[0]).host);
		expect(replicaErrors).toHaveLength(1);
		expect(replicaErrors[0].server).toBe(BLOSSOM_MIRROR_SERVERS[1]);
	});

	it('publishes from BitOS when every Blossom replica fails', async () => {
		const file = videoFile();
		vi.mocked(uploadToBlossom).mockRejectedValue(
			new Error('Blossom upload failed: 401 unauthorized')
		);

		const result = await media.uploadWithMirrors(file);

		expect(result.url).toBe('https://bitos.example/canonical.mp4');
		expect(result.mirrors).toBeUndefined();
		expect(uploadViaServer).toHaveBeenCalledTimes(1);
	});

	it('rejects when the canonical BitOS destination fails', async () => {
		const file = videoFile();
		vi.mocked(uploadViaServer).mockRejectedValue(new Error('Server upload failed: 503 down'));

		await expect(media.uploadWithMirrors(file)).rejects.toThrow(/503/);
		// The replicas dispatched too (each provider call lands after its own
		// hash pass) — the cross-abort only stops their bytes, never the start.
		await vi.waitFor(() => expect(uploadToBlossom).toHaveBeenCalled());
	});
});
