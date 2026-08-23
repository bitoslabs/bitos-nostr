/**
 * NostrEventRef — the plan §6.1 value object for referencing a bitz event in
 * the domain layer instead of raw id/coordinate strings.
 *
 * Two variants with canonical serializations used for storage, comparison and
 * cross-surface identity:
 *   • regular     → `event:<64-hex id>`
 *   • addressable → `addr:<kind>:<pubkey>:<d-tag>` (NIP-01 coordinate)
 *
 * Addressable refs are IDENTICAL across replacement versions (new event id,
 * same coordinate), which is exactly the identity rule readers must dedupe
 * and reconcile by — the same rule `addressKey` encodes today, now wrapped in
 * one comparable value.
 */
import { addressKey } from './types';

export interface RegularEventRef {
	variant: 'event';
	/** 32-byte lowercase hex event id. */
	id: string;
}

export interface AddressableEventRef {
	variant: 'address';
	/** Bare NIP-01 coordinate `<kind>:<pubkey>:<d>`. */
	coordinate: string;
}

export type NostrEventRef = RegularEventRef | AddressableEventRef;

const HEX64_RE = /^[0-9a-f]{64}$/;
const COORDINATE_RE = /^(0*\d{1,5}):([0-9a-fA-F]{64}):(.+)$/;

/** A valid regular ref for a 64-hex id (case-insensitive input), else null. */
export function regularEventRef(id: string): RegularEventRef | null {
	const normalized = id.trim().toLowerCase();
	return HEX64_RE.test(normalized) ? { variant: 'event', id: normalized } : null;
}

/** A valid addressable ref for a `kind:pubkey:d` coordinate, else null. */
export function addressableEventRef(coordinate: string): AddressableEventRef | null {
	const trimmed = coordinate.trim();
	const match = COORDINATE_RE.exec(trimmed);
	if (!match) return null;
	const [, kind, pubkey, d] = match;
	// Normalize kind/pubkey to their canonical lowercased forms; the d-tag is
	// case-sensitive by NIP-01 and preserved verbatim.
	return { variant: 'address', coordinate: `${Number(kind)}:${pubkey.toLowerCase()}:${d}` };
}

/** Build a ref from an event shape — addressable coordinate wins when the
 *  kind carries one, otherwise the regular id decides. Null when neither. */
export function eventRefFor(event: {
	id?: string;
	pubkey?: string;
	kind: number;
	tags: string[][];
}): NostrEventRef | null {
	if (event.pubkey) {
		const coordinate = addressKey(event.kind, event.pubkey, event.tags);
		if (coordinate) return { variant: 'address', coordinate };
	}
	if (event.id) return regularEventRef(event.id);
	return null;
}

/** Canonical §6.1 serialization — the single comparison key for refs. */
export function eventRefKey(ref: NostrEventRef): string {
	return ref.variant === 'event' ? `event:${ref.id}` : `addr:${ref.coordinate}`;
}

/** Two refs are the same domain object when their canonical keys match. */
export function sameEventRef(a: NostrEventRef, b: NostrEventRef): boolean {
	return eventRefKey(a) === eventRefKey(b);
}

/** The bare `<kind>:<pubkey>:<d>` coordinate, '' for regular refs. */
export function coordinateOf(ref: NostrEventRef): string {
	return ref.variant === 'address' ? ref.coordinate : '';
}

/** Parse a canonical §6.1 string back into a ref (tolerant). */
export function parseEventRef(raw: string): NostrEventRef | null {
	const trimmed = raw.trim();
	if (trimmed.startsWith('event:')) return regularEventRef(trimmed.slice('event:'.length));
	if (trimmed.startsWith('addr:')) return addressableEventRef(trimmed.slice('addr:'.length));
	return null;
}
