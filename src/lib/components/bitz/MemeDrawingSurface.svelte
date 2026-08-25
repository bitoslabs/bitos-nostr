<script lang="ts">
	import { tick } from 'svelte';
	import {
		makeDrawingStroke,
		paintDrawingGroups,
		simplifyDrawingPoints,
		type DrawingGroup,
		type DrawingPoint,
		type DrawingSmoothing,
		type DrawingTool
	} from '$lib/meme/drawing';

	let {
		active = false,
		groups = [],
		tool = 'pen',
		color = '#ffffff',
		width = 0.012,
		opacity = 1,
		atMs,
		pressureEnabled = true,
		drawWithFinger = true,
		smoothing = 'off',
		onAddStroke
	}: {
		active?: boolean;
		groups?: DrawingGroup[];
		tool?: DrawingTool;
		color?: string;
		width?: number;
		opacity?: number;
		/** Timeline position for replay/visibility previews; omitted for still canvases. */
		atMs?: number;
		pressureEnabled?: boolean;
		drawWithFinger?: boolean;
		smoothing?: DrawingSmoothing;
		onAddStroke: (stroke: ReturnType<typeof makeDrawingStroke>) => void;
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let activePoints = $state<DrawingPoint[]>([]);
	let strokeStartedAt = 0;
	let activePointerId: number | null = null;

	function redraw() {
		const el = canvas;
		if (!el) return;
		const box = el.getBoundingClientRect();
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = Math.max(1, Math.round(box.width * dpr));
		const h = Math.max(1, Math.round(box.height * dpr));
		if (el.width !== w || el.height !== h) {
			el.width = w;
			el.height = h;
		}
		const ctx = el.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, w, h);
		paintDrawingGroups(ctx, groups, el, atMs);
		if (activePoints.length) {
			paintDrawingGroups(
				ctx,
				[
					{
						id: 'live',
						label: 'Live',
						playback: 'static',
						startMs: 0,
						visibleFromMs: 0,
						strokes: [makeDrawingStroke({ tool, color, width, opacity, points: activePoints })]
					}
				],
				el
			);
		}
	}

	$effect(() => {
		void groups;
		void activePoints;
		void tool;
		void color;
		void width;
		void opacity;
		void atMs;
		void tick().then(redraw);
	});

	function point(event: PointerEvent): DrawingPoint | null {
		const box = canvas?.getBoundingClientRect();
		if (!box || box.width <= 0 || box.height <= 0) return null;
		return {
			x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
			y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
			// Stroke times are relative to their group. This lets Replay reveal the
			// gesture at its recorded pace while the group itself starts on the timeline.
			atMs: Math.max(0, Math.round(performance.now() - strokeStartedAt)),
			...(pressureEnabled && event.pointerType === 'pen' && event.pressure > 0
				? { pressure: Math.min(1, event.pressure) }
				: {})
		};
	}
	function start(event: PointerEvent) {
		if (
			!active ||
			(event.pointerType === 'touch' && (!drawWithFinger || event.isPrimary === false))
		)
			return;
		const next = point(event);
		if (!next) return;
		event.preventDefault();
		(event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
		strokeStartedAt = performance.now();
		activePointerId = event.pointerId;
		activePoints = [{ ...next, atMs: 0 }];
	}
	function move(event: PointerEvent) {
		if (!activePoints.length || event.pointerId !== activePointerId) return;
		let next = point(event);
		if (!next) return;
		const start = activePoints[0]!;
		if (event.shiftKey && ['line', 'arrow', 'rectangle', 'ellipse'].includes(tool)) {
			const dx = next.x - start.x;
			const dy = next.y - start.y;
			if (tool === 'line' || tool === 'arrow') {
				const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
				const length = Math.hypot(dx, dy);
				next = {
					...next,
					x: Math.max(0, Math.min(1, start.x + Math.cos(angle) * length)),
					y: Math.max(0, Math.min(1, start.y + Math.sin(angle) * length))
				};
			} else {
				const side = Math.max(Math.abs(dx), Math.abs(dy));
				next = {
					...next,
					x: Math.max(0, Math.min(1, start.x + Math.sign(dx || 1) * side)),
					y: Math.max(0, Math.min(1, start.y + Math.sign(dy || 1) * side))
				};
			}
		}
		const last = activePoints[activePoints.length - 1]!;
		if (Math.hypot(next.x - last.x, next.y - last.y) < 0.0015) return;
		activePoints = [...activePoints, next];
	}
	function finish() {
		if (!activePoints.length) return;
		onAddStroke(
			makeDrawingStroke({
				tool,
				color,
				width,
				opacity,
				points: simplifyDrawingPoints(activePoints, smoothing)
			})
		);
		activePoints = [];
		activePointerId = null;
	}
</script>

<canvas
	bind:this={canvas}
	class="absolute inset-0 size-full {active
		? 'cursor-crosshair touch-none'
		: 'pointer-events-none'}"
	aria-label="Drawing surface"
	onpointerdown={start}
	onpointermove={move}
	onpointerup={finish}
	onpointercancel={finish}
></canvas>
