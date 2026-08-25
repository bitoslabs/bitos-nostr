/**
 * NIP-47 capability/error vocabulary for the NWC client (PAY-001).
 *
 * Pure helpers - transport stays in `nwc.ts`. These encode:
 *   - method capability sets parsed from `get_info.result.methods`
 *   - typed error classification so callers can react to
 *     RATE_LIMITED (backoff), NOT_ENOUGH_FUNDS (UX copy), QUOTA_EXCEEDED
 *     (persistent deny) instead of string-matching raw messages
 *   - URI redaction for logs/toasts (the spending secret must never
 *     reach a string that gets displayed)
 */

export const NWC_METHODS = [
	'get_info',
	'get_balance',
	'pay_invoice',
	'make_invoice',
	'lookup_invoice',
	'list_transactions'
] as const;

export type NwcMethod = (typeof NWC_METHODS)[number];

/** Methods this build actually calls. */
export const NWC_USED_METHODS: readonly NwcMethod[] = [
	'get_info',
	'get_balance',
	'pay_invoice',
	'make_invoice',
	'lookup_invoice'
];

export interface NwcCapabilities {
	/** Methods the wallet reports granting. */
	methods: NwcMethod[];
	/** Raw methods we do not model (future NIP-47 extensions). */
	unknownMethods: string[];
}

/** Tolerant parse of `get_info.result`: lists may be missing or malformed. */
export function parseNwcCapabilities(result: unknown): NwcCapabilities {
	const methods: NwcMethod[] = [];
	const unknownMethods: string[] = [];
	if (result && typeof result === 'object') {
		const raw = (result as Record<string, unknown>).methods;
		if (Array.isArray(raw)) {
			for (const entry of raw) {
				if (typeof entry !== 'string') continue;
				if ((NWC_METHODS as readonly string[]).includes(entry)) {
					const typed = entry as NwcMethod;
					if (!methods.includes(typed)) methods.push(typed);
				} else if (!unknownMethods.includes(entry)) {
					unknownMethods.push(entry);
				}
			}
		}
	}
	return { methods, unknownMethods };
}

/** True when every method this build calls was granted. */
export function nwcGrantsUsedMethods(caps: NwcCapabilities): boolean {
	return NWC_USED_METHODS.every((m) => caps.methods.includes(m));
}

/** NIP-47 error codes the client can act on. */
export const NWC_ERROR_CODES = [
	'RATE_LIMITED',
	'NOT_ENOUGH_FUNDS',
	'QUOTA_EXCEEDED',
	'RESTRICTED',
	'UNAUTHORIZED',
	'INTERNAL',
	'NOT_IMPLEMENTED',
	'PAYMENT_FAILED',
	'PAYMENT_PENDING'
] as const;

export type NwcErrorCode = (typeof NWC_ERROR_CODES)[number];

export type NwcErrorAction =
	'retry-with-backoff' | 'insufficient-funds' | 'deny-persistent' | 'auth' | 'fatal';

export interface NwcClassifiedError {
	code: NwcErrorCode | 'UNKNOWN';
	action: NwcErrorAction;
	message: string;
}

const ACTION_BY_CODE: Record<NwcErrorCode, NwcErrorAction> = {
	RATE_LIMITED: 'retry-with-backoff',
	NOT_ENOUGH_FUNDS: 'insufficient-funds',
	QUOTA_EXCEEDED: 'deny-persistent',
	RESTRICTED: 'deny-persistent',
	UNAUTHORIZED: 'auth',
	INTERNAL: 'fatal',
	NOT_IMPLEMENTED: 'fatal',
	PAYMENT_FAILED: 'fatal',
	PAYMENT_PENDING: 'retry-with-backoff'
};

/**
 * Classify a wallet error. Accepts the raw NIP-47 `{code?, message?}` shape
 * OR an already-thrown Error whose message may embed a code. Never throws.
 */
export function classifyNwcError(raw: unknown): NwcClassifiedError {
	let code: string | undefined;
	let message: string | undefined;
	// Error instances FIRST - typeof Error === 'object', so the wallet-shape
	// branch below would otherwise swallow them.
	if (raw instanceof Error) {
		message = raw.message;
		// Longest-first alternation so PAYMENT_PENDING wins over PAYMENT.
		const sorted = [...NWC_ERROR_CODES].sort((a, b) => b.length - a.length).join('|');
		const match = message.match(new RegExp(`\\b(${sorted})\\b`));
		if (match) code = match[1];
	} else if (raw && typeof raw === 'object') {
		const err = (raw as { error?: { code?: unknown; message?: unknown } }).error;
		if (err && typeof err === 'object') {
			const e = err as Record<string, unknown>;
			if (typeof e.code === 'string') code = e.code;
			if (typeof e.message === 'string') message = e.message;
		}
	} else if (typeof raw === 'string') {
		message = raw;
	}
	const known =
		code && (NWC_ERROR_CODES as readonly string[]).includes(code)
			? (code as NwcErrorCode)
			: undefined;
	return {
		code: known ?? 'UNKNOWN',
		action: known ? ACTION_BY_CODE[known] : 'fatal',
		message: message || 'Wallet request failed.'
	};
}

/**
 * Redact a wallet-connect URI for display/logs. Keeps the wallet pubkey and
 * relay hosts (useful in support), murders the secret.
 */
export function redactNwcUri(uri: string): string {
	try {
		const parsed = new URL(uri.trim());
		const wallet = (parsed.pathname || parsed.host).replace(/^\//, '');
		const relays = parsed.searchParams.getAll('relay');
		if (!wallet) return 'nostr+walletconnect:<invalid>';
		return `nostr+walletconnect:${wallet.slice(0, 8)}…?relay=${relays.join(',')}&secret=…`;
	} catch {
		return 'nostr+walletconnect:<invalid>';
	}
}
