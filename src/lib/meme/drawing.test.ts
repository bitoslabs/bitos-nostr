import { describe, expect, it } from 'vitest';
import { normalizeDrawingGroups, normalizeDrawingPoints } from './drawing';

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
});
