import { describe, expect, it } from 'vitest';
import {
	makeDrawingStroke,
	normalizeDrawingGroups,
	normalizeDrawingPoints,
	paintDrawingGroups,
	simplifyDrawingPoints
} from './drawing';

describe('drawing model', () => {
	it('clamps coordinates and keeps pointer times monotonic', () => {
		expect(
			normalizeDrawingPoints([
				{ x: -2, y: 2, atMs: 20, pressure: 2 },
				{ x: 0.5, y: 0.5, atMs: 4 }
			])
		).toEqual([
			{ x: 0, y: 1, atMs: 20, pressure: 1 },
			{ x: 0.5, y: 0.5, atMs: 20 }
		]);
	});

	it('normalizes eraser strokes as nondestructive destination-out paths', () => {
		const groups = normalizeDrawingGroups([
			{
				label: 'Erase',
				strokes: [{ tool: 'eraser', points: [{ x: 0.2, y: 0.3, atMs: 0 }] }]
			}
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.strokes[0]!.blendMode).toBe('destination-out');
	});

	it('smooths a straight path while retaining endpoint timing', () => {
		const points = [
			{ x: 0, y: 0, atMs: 0 },
			{ x: 0.25, y: 0.001, atMs: 100 },
			{ x: 0.5, y: 0, atMs: 200 },
			{ x: 1, y: 0, atMs: 300 }
		];
		const simplified = simplifyDrawingPoints(points, 'smooth');
		expect(simplified).toEqual([points[0], points[3]]);
		expect(simplified.map((point) => point.atMs)).toEqual([0, 300]);
	});

	it('keeps line and arrow as portable drawing tools', () => {
		expect(makeDrawingStroke({ tool: 'line' }).tool).toBe('line');
		expect(makeDrawingStroke({ tool: 'arrow' }).tool).toBe('arrow');
		expect(makeDrawingStroke({ tool: 'rectangle' }).tool).toBe('rectangle');
		expect(makeDrawingStroke({ tool: 'ellipse' }).tool).toBe('ellipse');
	});
});

describe('paintDrawingGroups', () => {
	function recordedContext() {
		const calls: string[] = [];
		const ctx = {
			calls,
			save: () => {},
			restore: () => {},
			beginPath: () => {},
			moveTo: (x: number, y: number) => calls.push(`moveTo ${x} ${y}`),
			lineTo: (x: number, y: number) => calls.push(`lineTo ${x} ${y}`),
			rect: (x: number, y: number) => calls.push(`rect ${x} ${y}`),
			ellipse: (x: number, y: number, rx: number, ry: number) =>
				calls.push(`ellipse ${x} ${y} ${rx} ${ry}`),
			arc: (x: number, y: number, r: number) => calls.push(`arc ${x} ${y} ${r}`),
			stroke: () => calls.push('stroke'),
			fill: () => calls.push('fill')
		};
		return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
	}

	it('strokes ellipses without a stray chord from the drag corner', () => {
		const ctx = recordedContext();
		const stroke = makeDrawingStroke({
			tool: 'ellipse',
			points: [
				{ x: 0.2, y: 0.2, atMs: 0 },
				{ x: 0.8, y: 0.6, atMs: 120 }
			]
		});
		paintDrawingGroups(
			ctx,
			[{ id: 'g1', label: 'Shape', playback: 'static', startMs: 0, visibleFromMs: 0, strokes: [stroke] }],
			{ width: 100, height: 100 }
		);
		// The subpath starts on the rim at angle 0 (cx+rx, cy), never on the
		// drag corner, and nothing may bridge the two with a straight line.
		expect(ctx.calls).toEqual(['moveTo 80 40', 'ellipse 50 40 30 20', 'stroke']);
	});

	it('still paths freehand strokes through every recorded point', () => {
		const ctx = recordedContext();
		const stroke = makeDrawingStroke({
			tool: 'pen',
			points: [
				{ x: 0.1, y: 0.1, atMs: 0 },
				{ x: 0.5, y: 0.5, atMs: 50 },
				{ x: 0.9, y: 0.9, atMs: 100 }
			]
		});
		paintDrawingGroups(
			ctx,
			[{ id: 'g1', label: 'Scribble', playback: 'static', startMs: 0, visibleFromMs: 0, strokes: [stroke] }],
			{ width: 100, height: 100 }
		);
		expect(ctx.calls).toEqual([
			'moveTo 10 10',
			'lineTo 50 50',
			'lineTo 90 90',
			'stroke'
		]);
	});
});
