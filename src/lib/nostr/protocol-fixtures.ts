/**
 * Typed loader for the checked-in protocol fixture corpus (plan §21.1 /
 * CORE-010).
 *
 * Fixtures live in `fixtures/protocol/*.json` (repo root) and are sourced
 * from both deterministic codec outputs ("generated") and real public-shaped
 * events with keys/content anonymized ("public-shaped" — see each file's
 * `meta` block for the reviewed spec references and notes).
 *
 * `loadProtocolFixtures()` reads and validates the corpus at test time:
 * malformed files fail the run loudly instead of silently skewing coverage
 * percentages. The loader is server/node-side only (fs access).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal anonymized event shape the codec parses (no signature required). */
export interface FixtureEvent {
	id?: string;
	pubkey?: string;
	kind: number;
	content: string;
	tags: string[][];
	created_at?: number;
}

export interface ExpectedMedia {
	url: string;
	type: 'video' | 'image';
	fallbacks: string[];
	/** Alternate quality renditions (READ-002); absent goldens normalize
	 * to no key for exact-shape matching. */
	renditions?: { url: string; height: number; bitrate: number }[];
	address: string;
	hash?: string;
	dim?: string;
	duration?: number;
}

export interface ProtocolFixture {
	id: string;
	note: string;
	event: FixtureEvent;
	/** Multi-event fixtures (READ-004 replacement pairs) carry every version
	 *  here; `event` stays the representative newest for single-event paths. */
	events?: FixtureEvent[];
	/** null = the codec must refuse to parse this event into media. */
	expect: { media: ExpectedMedia } | null;
	/** Addressable-replacement selection expectations (READ-004/F-016). */
	expectSelection?: {
		winnerIds: string[];
		winnerMedia: Array<{ id: string; url: string; address: string }>;
	};
}

export interface GoldenEncodeFixture {
	note: string;
	params: {
		pubkey: string;
		caption: string;
		media: {
			url: string;
			mimeType?: string;
			bytes?: number;
			dim?: string;
			thumb?: string;
			fallback?: string;
			hash?: string;
			duration?: number;
			bitrate?: number;
		};
		prefixTags?: string[][];
		created_at?: number;
	};
	expected: {
		pubkey: string;
		kind: number;
		content: string;
		created_at: number;
		tags: string[][];
	};
}

export interface FixtureCorpusMetadata {
	schemaVersion: number;
	reviewedAt: string;
	provenance: 'generated' | 'public-shaped';
	anonymized: boolean;
	specRefs: string[];
	reviewNotes: string;
}

export interface FixtureCorpus {
	meta: FixtureCorpusMetadata;
	fixtures: ProtocolFixture[];
	goldenEncode?: GoldenEncodeFixture;
}

const FIXTURE_DIR = join(process.cwd(), 'fixtures', 'protocol');

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readStringArray(value: unknown): string[][] {
	if (!Array.isArray(value)) return [];
	return value.map((tag) => (Array.isArray(tag) ? tag.map((s) => String(s)) : []));
}

function readExpected(raw: unknown): ProtocolFixture['expect'] {
	if (raw === null) return null;
	if (!isRecord(raw) || !isRecord(raw.media)) {
		throw new Error(`fixture "expect" must be null or { media }`);
	}
	const media = raw.media as Partial<ExpectedMedia>;
	if (typeof media.url !== 'string' || (media.type !== 'video' && media.type !== 'image')) {
		throw new Error(`fixture "expect.media" needs url + type video|image`);
	}
	return {
		media: {
			url: media.url,
			type: media.type,
			fallbacks: Array.isArray(media.fallbacks) ? media.fallbacks.map(String) : [],
			...(Array.isArray(media.renditions) && media.renditions.length
				? { renditions: media.renditions }
				: {}),
			...(Array.isArray(media.renditions) && media.renditions.length
				? { renditions: media.renditions }
				: {}),
			address: typeof media.address === 'string' ? media.address : '',
			...(typeof media.hash === 'string' ? { hash: media.hash } : {}),
			...(typeof media.dim === 'string' ? { dim: media.dim } : {}),
			...(typeof media.duration === 'number' ? { duration: media.duration } : {})
		}
	};
}

function readFixture(raw: unknown, file: string): ProtocolFixture {
	if (!isRecord(raw)) throw new Error(`${file}: fixture entry is not an object`);
	if (typeof raw.id !== 'string' || !raw.id) throw new Error(`${file}: fixture missing id`);
	if (!isRecord(raw.event)) throw new Error(`${file}:${raw.id}: missing event`);
	const event = raw.event;
	if (typeof event.kind !== 'number' || typeof event.content !== 'string') {
		throw new Error(`${file}:${raw.id}: event needs kind:number + content:string`);
	}
	if (!Array.isArray(event.tags)) {
		throw new Error(`${file}:${raw.id}: event.tags must be an array`);
	}
	return {
		id: raw.id,
		note: typeof raw.note === 'string' ? raw.note : '',
		event: {
			...(typeof event.id === 'string' ? { id: event.id } : {}),
			...(typeof event.pubkey === 'string' ? { pubkey: event.pubkey } : {}),
			kind: event.kind,
			content: event.content,
			tags: readStringArray(event.tags),
			...(typeof event.created_at === 'number' ? { created_at: event.created_at } : {})
		},
		...(Array.isArray(raw.events)
			? {
					events: raw.events.map((one, i) => {
						if (!isRecord(one)) throw new Error(`${file}:${raw.id}: events[${i}] not an object`);
						if (typeof one.kind !== 'number' || typeof one.content !== 'string') {
							throw new Error(`${file}:${raw.id}: events[${i}] needs kind + content`);
						}
						return {
							...(typeof one.id === 'string' ? { id: one.id } : {}),
							...(typeof one.pubkey === 'string' ? { pubkey: one.pubkey } : {}),
							kind: one.kind as number,
							content: one.content as string,
							tags: readStringArray(one.tags),
							...(typeof one.created_at === 'number' ? { created_at: one.created_at } : {})
						};
					})
				}
			: {}),
		expect: readExpected(raw.expect),
		...(isRecord(raw.expectSelection)
			? {
					expectSelection: {
						winnerIds: Array.isArray(raw.expectSelection.winnerIds)
							? raw.expectSelection.winnerIds.map(String)
							: [],
						winnerMedia: Array.isArray(raw.expectSelection.winnerMedia)
							? (raw.expectSelection.winnerMedia.map((m) => ({
									id: String((m as Record<string, unknown>).id ?? ''),
									url: String((m as Record<string, unknown>).url ?? ''),
									address: String((m as Record<string, unknown>).address ?? '')
								})) as NonNullable<ProtocolFixture['expectSelection']>['winnerMedia'])
							: []
					}
				}
			: {})
	};
}

function readGoldenEncode(raw: unknown): GoldenEncodeFixture {
	if (!isRecord(raw) || !isRecord(raw.params) || !isRecord(raw.expected)) {
		throw new Error('goldenEncode needs params + expected');
	}
	const params = raw.params;
	if (typeof params.pubkey !== 'string' || typeof params.caption !== 'string') {
		throw new Error('goldenEncode.params needs pubkey + caption');
	}
	if (!isRecord(params.media) || typeof (params.media as { url?: unknown }).url !== 'string') {
		throw new Error('goldenEncode.params.media needs url');
	}
	const expected = raw.expected;
	if (
		typeof expected.pubkey !== 'string' ||
		typeof expected.kind !== 'number' ||
		typeof expected.content !== 'string' ||
		typeof expected.created_at !== 'number' ||
		!Array.isArray(expected.tags)
	) {
		throw new Error('goldenEncode.expected needs pubkey/kind/content/created_at/tags');
	}
	return {
		note: typeof raw.note === 'string' ? raw.note : '',
		params: {
			pubkey: params.pubkey,
			caption: params.caption,
			media: params.media as GoldenEncodeFixture['params']['media'],
			...(Array.isArray(params.prefixTags)
				? { prefixTags: readStringArray(params.prefixTags) }
				: {}),
			...(typeof params.created_at === 'number' ? { created_at: params.created_at } : {})
		},
		expected: {
			pubkey: expected.pubkey,
			kind: expected.kind,
			content: expected.content,
			created_at: expected.created_at,
			tags: readStringArray(expected.tags)
		}
	};
}

function readCorpus(raw: unknown, file: string): FixtureCorpus {
	if (!isRecord(raw)) throw new Error(`${file}: corpus root is not an object`);
	const meta = raw.meta;
	if (
		!isRecord(meta) ||
		meta.schemaVersion !== 1 ||
		typeof meta.reviewedAt !== 'string' ||
		(meta.provenance !== 'generated' && meta.provenance !== 'public-shaped')
	) {
		throw new Error(
			`${file}: meta needs schemaVersion 1, reviewedAt, "generated"|"public-shaped" provenance`
		);
	}
	if (!Array.isArray(raw.fixtures) || raw.fixtures.length === 0) {
		throw new Error(`${file}: fixtures array must be non-empty`);
	}
	const fixtures = raw.fixtures.map((entry) => readFixture(entry, file));
	const ids = new Set(fixtures.map((f) => f.id));
	if (ids.size !== fixtures.length) throw new Error(`${file}: duplicate fixture ids`);
	return {
		meta: {
			schemaVersion: meta.schemaVersion,
			reviewedAt: meta.reviewedAt,
			provenance: meta.provenance,
			anonymized: meta.anonymized === true,
			specRefs: Array.isArray(meta.specRefs) ? meta.specRefs.map(String) : [],
			reviewNotes: typeof meta.reviewNotes === 'string' ? meta.reviewNotes : ''
		},
		fixtures,
		...(raw.goldenEncode ? { goldenEncode: readGoldenEncode(raw.goldenEncode) } : {})
	};
}

/** Load and validate every JSON corpus in fixtures/protocol. */
export function loadProtocolFixtures(dir: string = FIXTURE_DIR): FixtureCorpus[] {
	const files = readdirSync(dir)
		.filter((name) => name.endsWith('.json'))
		.sort();
	if (!files.length) throw new Error(`no fixture corpora found in ${dir}`);
	return files.map((name) => {
		const raw: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
		return readCorpus(raw, name);
	});
}
