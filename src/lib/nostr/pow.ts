/**
 * Shared NIP-13 Proof-of-Work helpers.
 *
 * `minePowAsync` spins up the Web Worker (`pow.worker.ts`) which brute-forces
 * a `nonce` tag until the event id carries the requested number of leading
 * zero bits. Used by every publishing surface (notes, replies, stories) so
 * mining behaves identically everywhere: live progress, cancellable, off the
 * main thread.
 *
 * `eventPow` reads back the difficulty of an already-published event — a
 * `nonce` tag with a positive target whose id actually hashes to it (per
 * NIP-13 the commitment is the tag, the proof is the id).
 */
import { getPow } from 'nostr-tools/nip13';
import type { UnsignedEvent } from 'nostr-tools/pure';

/** Live stats streamed from the NIP-13 worker while mining. */
export type PowProgress = {
	hashes: number;
	hashrate: number;
	best: number;
	/** Hex id of the best candidate so far (grows its zero prefix live). */
	bestHash: string;
	nonce: string;
	elapsedMs: number;
};

export function minePowAsync(
	unsigned: UnsignedEvent,
	difficulty: number,
	options: { onProgress?: (progress: PowProgress) => void; signal?: AbortSignal } = {}
) {
	return new Promise<UnsignedEvent>((resolve, reject) => {
		const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
		let settled = false;
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			worker.onmessage = null;
			worker.onerror = null;
			worker.terminate();
			fn();
		};
		const onAbort = () => settle(() => reject(new Error('Proof of Work cancelled')));
		if (options.signal) {
			if (options.signal.aborted) {
				onAbort();
				return;
			}
			options.signal.addEventListener('abort', onAbort, { once: true });
		}
		worker.onmessage = (
			message: MessageEvent<{
				type: 'progress' | 'done' | 'error';
				event?: UnsignedEvent;
				error?: string;
				progress?: PowProgress;
			}>
		) => {
			const data = message.data;
			if (data.type === 'progress') {
				options.onProgress?.(data.progress!);
				return;
			}
			if (data.type === 'done' && data.event) settle(() => resolve(data.event!));
			else if (data.type === 'error')
				settle(() => reject(new Error(data.error || 'Proof of Work failed')));
		};
		worker.onerror = () => settle(() => reject(new Error('Proof of Work worker failed')));
		worker.postMessage({ unsigned, difficulty });
	});
}

/**
 * Difficulty (leading zero bits) of a published event, or undefined when it
 * was not mined. Mirrors the FeedNote pow logic: a `nonce` tag with a finite,
 * positive target commits to mining; the id proves it.
 */
export function eventPow(ev: { id: string; tags: string[][] }): number | undefined {
	const nonceTag = ev.tags.find((t) => t[0] === 'nonce');
	const target = Number(nonceTag?.[2]);
	return nonceTag && Number.isFinite(target) && target > 0 ? getPow(ev.id) : undefined;
}
