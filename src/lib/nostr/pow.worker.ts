import { getEventHash } from 'nostr-tools/pure';
import { getPow } from 'nostr-tools/nip13';
import type { UnsignedEvent } from 'nostr-tools/pure';

/**
 * NIP-13 miner. Runs a chunked hashing loop so it can stream live progress
 * (hash count, hashrate, best difficulty found, current nonce, elapsed time)
 * back to the UI. The main thread cancels by terminating the worker.
 */
type MineRequest = { unsigned: UnsignedEvent; difficulty: number };

type MineProgress = {
	type: 'progress';
	hashes: number;
	hashrate: number;
	best: number;
	nonce: string;
	elapsedMs: number;
};
type MineDone = { type: 'done'; event: UnsignedEvent };
type MineError = { type: 'error'; error: string };
export type MineResponse = MineProgress | MineDone | MineError;

const CHUNK_SIZE = 5_000;
const REPORT_EVERY_MS = 150;

self.onmessage = (message: MessageEvent<MineRequest>) => {
	const { unsigned, difficulty } = message.data;
	// The nonce tag mutates in place; getEventHash serializes it every round
	// exactly like nostr-tools' own minePow.
	const nonceTag: [string, string, string] = ['nonce', '0', String(difficulty)];
	const template = { ...unsigned, tags: [...unsigned.tags, nonceTag] };

	try {
		const started = Date.now();
		let hashes = 0;
		let best = 0;
		let counter = 0;
		let lastReport = started;

		const step = () => {
			try {
				for (let i = 0; i < CHUNK_SIZE; i++) {
					nonceTag[1] = String(++counter);
					const zeroes = getPow(getEventHash(template));
					hashes++;
					if (zeroes > best) best = zeroes;
					if (zeroes >= difficulty) {
						self.postMessage({ type: 'done', event: template } satisfies MineDone);
						return;
					}
				}
				const now = Date.now();
				const elapsedMs = now - started;
				if (now - lastReport >= REPORT_EVERY_MS) {
					lastReport = now;
					self.postMessage({
						type: 'progress',
						hashes,
						hashrate: hashes / (elapsedMs / 1000),
						best,
						nonce: String(counter),
						elapsedMs
					} satisfies MineProgress);
				}
				setTimeout(step, 0);
			} catch (error) {
				self.postMessage({
					type: 'error',
					error: error instanceof Error ? error.message : 'Proof of Work failed'
				} satisfies MineError);
			}
		};
		step();
	} catch (error) {
		self.postMessage({
			type: 'error',
			error: error instanceof Error ? error.message : 'Proof of Work failed'
		} satisfies MineError);
	}
};
