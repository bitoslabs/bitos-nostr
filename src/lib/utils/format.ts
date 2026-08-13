/** Nostr-related formatting helpers. */

/** Shorten an npub/hex key: `npub1x…abc` / middle-truncated hex. */
export function shortKey(key: string | null | undefined, head = 8, tail = 6): string {
	if (!key) return '';
	const k = key.trim();
	if (k.startsWith('npub') || k.startsWith('nsec') || k.startsWith('note')) {
		return k.length > head + tail + 3 ? `${k.slice(0, head)}…${k.slice(-tail)}` : k;
	}
	if (/^[0-9a-f]{64}$/i.test(k)) {
		return `${k.slice(0, head)}…${k.slice(-tail)}`;
	}
	return k.length > head + tail + 1 ? `${k.slice(0, head)}…${k.slice(-tail)}` : k;
}

/** Initials from a name, handle, or key. */
export function initialsFrom(name: string | null | undefined): string {
	if (!name) return '?';
	const base = name.trim();
	if (!base) return '?';
	const parts = base.split(/\s+/).filter(Boolean);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A stable hue (0–359) for an avatar gradient from any pubkey. */
export function hueFromKey(key: string | null | undefined): number {
	if (!key) return 45;
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
	return h % 360;
}

/** "just now", "5m", "3h", "2d", or a localized date. */
export function timeAgo(unixSeconds: number): string {
	const now = Math.floor(Date.now() / 1000);
	let diff = now - unixSeconds;
	if (diff < 0) diff = 0;
	if (diff < 60) return 'now';
	const mins = Math.floor(diff / 60);
	if (mins < 60) return `${mins}m`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h`;
	const days = Math.floor(hrs / 24);
	if (days < 7) return `${days}d`;
	return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric'
	});
}

/** Full timestamp for tooltips / message headers. */
export function timeFull(unixSeconds: number): string {
	return new Date(unixSeconds * 1000).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

/** Group a list by calendar day for chat/conversation dividers. */
export function dayLabel(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	const today = new Date();
	const yesterday = new Date();
	yesterday.setDate(today.getDate() - 1);
	const sameDay = (a: Date, b: Date) =>
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate();
	if (sameDay(d, today)) return 'Today';
	if (sameDay(d, yesterday)) return 'Yesterday';
	return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Compact number formatting for stats: 12847 → "12.8k", 2_400_000 → "2.4M". */
export function formatCompact(n: number): string {
	const abs = Math.abs(n);
	if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
	if (abs >= 1_000) return `${trim(n / 1_000)}k`;
	return Math.round(n).toString();
}

function trim(value: number): string {
	return value.toFixed(1).replace(/\.0$/, '');
}
