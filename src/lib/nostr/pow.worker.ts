import { minePow } from 'nostr-tools/nip13';
import type { UnsignedEvent } from 'nostr-tools/pure';

type MineRequest = { unsigned: UnsignedEvent; difficulty: number };

self.onmessage = (message: MessageEvent<MineRequest>) => {
	try {
		const event = minePow(message.data.unsigned, message.data.difficulty);
		self.postMessage({ ok: true, event });
	} catch (error) {
		self.postMessage({
			ok: false,
			error: error instanceof Error ? error.message : 'Proof of Work failed'
		});
	}
};
