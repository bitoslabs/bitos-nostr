#!/usr/bin/env node

import fs from 'node:fs/promises';
import process from 'node:process';
import { nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';

const DEFAULT_RELAYS = [
	'wss://nostr-01.yakihonne.com',
	'wss://nos.lol',
	'wss://relay.damus.io',
	'wss://relay.nostr.band',
	'wss://relay.primal.net',
	'wss://nostr-pub.wellorder.net',
	'wss://relay.0xchat.com'
];

function help(error) {
	if (error) console.error(`Error: ${error}\n`);
	console.error(`Usage:
  ./scripts/check-client-tags.sh --all [options]
  ./scripts/check-client-tags.sh --users users.txt [options]

Options:
  --all                 Find all BitOS-tagged public notes on the relays
  --pubkey <hex|npub>   Check one user; may be repeated
  --users <file>        One hex pubkey or npub per line
  --relay <wss-url>    Use a relay; may be repeated
  --since <date|unix>  Only check notes after this time
  --until <date|unix>  Only check notes before this time
  --limit <number>     Notes per user (default: 1000)
  --json               Print JSON output
`);
	process.exit(error ? 1 : 0);
}

function getValues(args, option) {
	const values = [];
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] !== option) continue;
		if (!args[i + 1] || args[i + 1].startsWith('--')) help(`${option} needs a value`);
		values.push(args[++i]);
	}
	return values;
}

function parseTime(value, option) {
	if (!value) return undefined;
	if (/^\d+$/.test(value)) return Number(value);
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) help(`${option} must be a date or Unix timestamp`);
	return Math.floor(parsed / 1000);
}

function pubkey(value) {
	const input = value.trim().toLowerCase();
	if (/^[0-9a-f]{64}$/.test(input)) return input;
	if (input.startsWith('npub1')) {
		try {
			const decoded = nip19.decode(input);
			if (decoded.type === 'npub' && typeof decoded.data === 'string') return decoded.data;
		} catch {
			/* handled by the error below */
		}
	}
	throw new Error(`Invalid pubkey: ${value}`);
}

function hasBitOsTag(event) {
	return event.tags.some((tag) => tag[0] === 'client' && tag[1] === 'BitOS');
}

const args = process.argv.slice(2);
if (args.includes('--help')) help();

const allBitOsNotes = args.includes('--all');
const pubkeys = [...getValues(args, '--pubkey')];
for (const file of getValues(args, '--users')) {
	let content;
	try {
		content = await fs.readFile(file, 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT')
			help(
				`users file not found: ${file} (run this command from the project root or provide its path)`
			);
		throw error;
	}
	pubkeys.push(
		...content
			.split(/\r?\n/)
			.map((line) => line.replace(/#.*/, '').trim())
			.filter(Boolean)
	);
}
if (!pubkeys.length && !allBitOsNotes) help('provide --pubkey, --users, or --all');
if (allBitOsNotes && pubkeys.length) help('--all cannot be combined with --pubkey or --users');

const users = [...new Set(pubkeys.map(pubkey))];
const relays = [...new Set(getValues(args, '--relay'))];
const relayUrls = relays.length ? relays : DEFAULT_RELAYS;
const since = parseTime(getValues(args, '--since')[0], '--since');
const until = parseTime(getValues(args, '--until')[0], '--until');
const limit = Number(getValues(args, '--limit')[0] ?? 1000);
const json = args.includes('--json');
if (!Number.isInteger(limit) || limit < 1) help('--limit must be a positive integer');

const pool = new SimplePool();
const events = new Map();
const queryErrors = [];

try {
	if (allBitOsNotes) {
		const result = await pool
			.querySync(relayUrls, { kinds: [1], '#client': ['BitOS'], since, until, limit })
			.catch((error) => {
				if (queryErrors.length < 20)
					queryErrors.push(error instanceof Error ? error.message : String(error));
				return [];
			});
		for (const event of result) events.set(event.id, event);
	} else {
		await Promise.all(
			users.map(async (author) => {
				const results = await Promise.allSettled([
					pool.querySync(relayUrls, { kinds: [0], authors: [author], limit: 10 }),
					pool.querySync(relayUrls, { kinds: [1], authors: [author], since, until, limit })
				]);
				for (const result of results) {
					if (result.status === 'fulfilled') {
						for (const event of result.value) events.set(event.id, event);
					} else if (queryErrors.length < 20) {
						queryErrors.push(
							result.reason instanceof Error ? result.reason.message : String(result.reason)
						);
					}
				}
			})
		);
	}

	const reportUsers = allBitOsNotes
		? [...new Set([...events.values()].filter((event) => event.kind === 1).map((event) => event.pubkey))]
		: users;
	const report = reportUsers.map((author) => {
		const notes = [...events.values()]
			.filter((event) => event.kind === 1 && event.pubkey === author)
			.sort((a, b) => b.created_at - a.created_at)
			.slice(0, limit);
		const tagged = notes.filter(hasBitOsTag).length;
		return {
			pubkey: author,
			notes: notes.length,
			bitosTagged: tagged,
			missingBitOsTag: notes.length - tagged,
			coverage: notes.length ? Number((tagged / notes.length).toFixed(4)) : 0,
			noteIdsMissingTag: notes.filter((event) => !hasBitOsTag(event)).map((event) => event.id)
		};
	});
	const summary = {
		users: report.length,
		totalNotes: report.reduce((total, item) => total + item.notes, 0),
		totalBitOsTagged: report.reduce((total, item) => total + item.bitosTagged, 0),
		totalMissingBitOsTag: report.reduce((total, item) => total + item.missingBitOsTag, 0)
	};

	if (json) {
		console.log(
			JSON.stringify(
				{
					scope: allBitOsNotes ? 'all-bitos-tagged-notes' : 'selected-users',
					relays: relayUrls,
					since: since ?? null,
					until: until ?? null,
					summary,
					queryErrors,
					users: report
				},
				null,
				2
			)
		);
	} else {
		if (allBitOsNotes) console.log(`Scanned all BitOS-tagged notes (limit: ${limit})`);
		console.log(
			`Users: ${summary.users} · Notes: ${summary.totalNotes} · BitOS tagged: ${summary.totalBitOsTagged}`
		);
		if (queryErrors.length) console.error(`Relay query warnings: ${queryErrors.join(' | ')}`);
		for (const item of report) {
			console.log(
				`${item.pubkey} — ${item.bitosTagged}/${item.notes} tagged (${Math.round(item.coverage * 100)}%)`
			);
		}
	}
} finally {
	pool.close(relayUrls);
}
