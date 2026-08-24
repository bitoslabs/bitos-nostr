/**
 * Draw & Record's portable, editable drawing model. Coordinates stay
 * normalized so a stroke drawn on a phone preview renders identically on any
 * artboard. This module is browser-free: it validates persisted projects and
 * paints deterministic paths for both preview and export.
 */

export type DrawingTool = 'pen' | 'marker' | 'eraser';
export type StrokeBlendMode = 'source-over' | 'destination-out';
export type DrawingPlayback = 'static' | 'replay' | 'hold';

export interface DrawingPoint {
	x: number;
	y: number;
	atMs: number;
	pressure?: number;
}

export interface DrawingStroke {
	id: string;
	tool: DrawingTool;
	color: string;
	width: number;
	opacity: number;
	blendMode: StrokeBlendMode;
	points: DrawingPoint[];
}

export interface DrawingGroup {
	id: string;
	label: string;
	playback: DrawingPlayback;
	startMs: number;
	endMs?: number;
	visibleFromMs: number;
	visibleUntilMs?: number;
	strokes: DrawingStroke[];
	locked?: boolean;
	hidden?: boolean;
}

export const MAX_DRAWING_GROUPS = 16;
export const MAX_STROKES_PER_GROUP = 100;
export const MAX_POINTS_PER_STROKE = 1500;
export const MAX_POINTS_PER_PROJECT = 12_000;

const COLOR = /^#[0-9a-f]{6}$/i;

function id(prefix: string): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function finite(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function makeDrawingStroke(
	partial: Partial<Omit<DrawingStroke, 'id' | 'points'>> & { points?: DrawingPoint[] } = {}
): DrawingStroke {
	const tool: DrawingTool =
		partial.tool === 'marker' || partial.tool === 'eraser' ? partial.tool : 'pen';
	return {
		id: id('stroke'),
		tool,
		color:
			typeof partial.color === 'string' && COLOR.test(partial.color) ? partial.color : '#ffffff',
		width: clamp(finite(partial.width, 0.012), 0.002, 0.15),
		opacity: clamp(finite(partial.opacity, tool === 'marker' ? 0.45 : 1), 0.05, 1),
		blendMode: tool === 'eraser' ? 'destination-out' : 'source-over',
		points: normalizeDrawingPoints(partial.points ?? [])
	};
}

export function normalizeDrawingPoints(raw: unknown): DrawingPoint[] {
	if (!Array.isArray(raw)) return [];
	const points: DrawingPoint[] = [];
	let lastAt = 0;
	for (const value of raw.slice(0, MAX_POINTS_PER_STROKE)) {
		if (!value || typeof value !== 'object') continue;
		const point = value as Record<string, unknown>;
		const x = finite(point.x, Number.NaN);
		const y = finite(point.y, Number.NaN);
		const at = finite(point.atMs, Number.NaN);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(at)) continue;
		const atMs = Math.max(lastAt, Math.round(Math.max(0, at)));
		lastAt = atMs;
		const pressure = finite(point.pressure, Number.NaN);
		points.push({
			x: clamp(x, 0, 1),
			y: clamp(y, 0, 1),
			atMs,
			...(Number.isFinite(pressure) ? { pressure: clamp(pressure, 0, 1) } : {})
		});
	}
	return points;
}

export function normalizeDrawingGroup(raw: unknown): DrawingGroup | null {
	if (!raw || typeof raw !== 'object') return null;
	const group = raw as Record<string, unknown>;
	const strokes = (Array.isArray(group.strokes) ? group.strokes : [])
		.slice(0, MAX_STROKES_PER_GROUP)
		.map((stroke) => {
			if (!stroke || typeof stroke !== 'object') return null;
			const item = stroke as Partial<DrawingStroke>;
			return {
				...makeDrawingStroke(item),
				id: typeof item.id === 'string' ? item.id.slice(0, 64) : id('stroke')
			};
		})
		.filter((stroke): stroke is DrawingStroke => !!stroke && stroke.points.length > 0);
	const playback: DrawingPlayback =
		group.playback === 'replay' || group.playback === 'hold' ? group.playback : 'static';
	const startMs = Math.round(Math.max(0, finite(group.startMs, 0)));
	const visibleFromMs = Math.round(Math.max(0, finite(group.visibleFromMs, startMs)));
	const end = finite(group.endMs, Number.NaN);
	const visibleUntil = finite(group.visibleUntilMs, Number.NaN);
	return {
		id: typeof group.id === 'string' && group.id.trim() ? group.id.slice(0, 64) : id('drawing'),
		label:
			typeof group.label === 'string' && group.label.trim()
				? group.label.trim().slice(0, 40)
				: 'Drawing',
		playback,
		startMs,
		visibleFromMs,
		...(Number.isFinite(end) && end > startMs ? { endMs: Math.round(end) } : {}),
		...(Number.isFinite(visibleUntil) && visibleUntil >= visibleFromMs
			? { visibleUntilMs: Math.round(visibleUntil) }
			: {}),
		strokes,
		...(group.locked === true ? { locked: true } : {}),
		...(group.hidden === true ? { hidden: true } : {})
	};
}

export function normalizeDrawingGroups(raw: unknown): DrawingGroup[] {
	const groups = (Array.isArray(raw) ? raw : [])
		.slice(0, MAX_DRAWING_GROUPS)
		.map(normalizeDrawingGroup)
		.filter((group): group is DrawingGroup => !!group);
	let remaining = MAX_POINTS_PER_PROJECT;
	return groups.flatMap((group) => {
		const strokes = group.strokes.flatMap((stroke) => {
			if (remaining <= 0) return [];
			const points = stroke.points.slice(0, remaining);
			remaining -= points.length;
			return points.length ? [{ ...stroke, points }] : [];
		});
		return strokes.length ? [{ ...group, strokes }] : [];
	});
}

function groupVisible(group: DrawingGroup, atMs: number | undefined): boolean {
	if (group.hidden) return false;
	if (atMs === undefined) return true;
	if (atMs < group.visibleFromMs) return false;
	return group.visibleUntilMs === undefined || atMs <= group.visibleUntilMs;
}

/** Paint groups after image layers and before captions, matching the studio stage. */
export function paintDrawingGroups(
	ctx: CanvasRenderingContext2D,
	groups: DrawingGroup[],
	canvas: { width: number; height: number },
	atMs?: number
): void {
	for (const group of groups) {
		if (!groupVisible(group, atMs)) continue;
		if (
			atMs !== undefined &&
			(group.playback === 'replay' || group.playback === 'hold') &&
			atMs < group.startMs
		)
			continue;
		for (const stroke of group.strokes) {
			const limit =
				atMs === undefined || group.playback === 'static' || group.playback === 'hold'
					? Infinity
					: Math.max(0, atMs - group.startMs);
			const points = stroke.points.filter((point) => point.atMs <= limit);
			if (!points.length) continue;
			ctx.save();
			ctx.globalCompositeOperation = stroke.blendMode;
			ctx.globalAlpha = stroke.opacity;
			ctx.strokeStyle = stroke.color;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.lineWidth = Math.max(1, stroke.width * canvas.height);
			ctx.beginPath();
			ctx.moveTo(points[0]!.x * canvas.width, points[0]!.y * canvas.height);
			for (let index = 1; index < points.length; index++) {
				const point = points[index]!;
				ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
			}
			if (points.length === 1) {
				ctx.fillStyle = stroke.color;
				ctx.arc(
					points[0]!.x * canvas.width,
					points[0]!.y * canvas.height,
					ctx.lineWidth / 2,
					0,
					Math.PI * 2
				);
				ctx.fill();
			} else ctx.stroke();
			ctx.restore();
		}
	}
}
