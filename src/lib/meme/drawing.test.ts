import { describe, expect, it } from 'vitest';
import {
	makeDrawingStroke,
	normalizeDrawingGroups,
	normalizeDrawingPoints,
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
