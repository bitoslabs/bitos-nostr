<script lang="ts">
	import { RMS_WINDOW_SEC } from '$lib/ai/extract';

	/**
	 * CueWaveform — canvas rendering of a clip's AI-001 anchors under the cue
	 * sheet: energy envelope, silence strips, peak ticks and speech segments.
	 * Purely visual (no pointer logic in v1) — draw-once per analysis.
	 */

	let {
		durationSec,
		windows,
		silence = [],
		peaks = [],
		speech = [],
		height = 44
	}: {
		durationSec: number;
		/** Raw RMS windows from AI-001's windowRms (one per RMS_WINDOW_SEC). */
		windows: Float32Array;
		silence?: ReadonlyArray<{ startSec: number; endSec: number }>;
		peaks?: ReadonlyArray<{ atSec: number; rms?: number }>;
		speech?: ReadonlyArray<{ startSec: number; endSec: number }>;
		height?: number;
	} = $props();

	let canvasEl = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		// Track every input so analysis changes redraw (void-reads satisfy the
		// linter while keeping the reactive dependencies).
		void [durationSec, windows, silence, peaks, speech];
		const canvas = canvasEl;
		if (!canvas || !(durationSec > 0)) return;
		const parent = canvas.parentElement;
		const width = parent?.clientWidth ?? 300;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, width, height);

		const css = getComputedStyle(canvas);
		const dim = css.getPropertyValue('--ui-text-dimmed') || '#9ca3af';
		const warm = css.getPropertyValue('--tone-warning-text') || '#f59e0b';
		const primary = css.getPropertyValue('--primary-500') || '#6366f1';

		const x = (sec: number) => (sec / durationSec) * width;
		const mid = height / 2;

		// Speech spans as soft background blocks.
		ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
		for (const seg of speech) {
			ctx.fillRect(x(seg.startSec), 0, Math.max(1, x(seg.endSec) - x(seg.startSec)), height);
		}

		// Silence strips.
		ctx.fillStyle = 'rgba(156, 163, 175, 0.15)';
		for (const span of silence) {
			ctx.fillRect(x(span.startSec), height - 4, Math.max(1, x(span.endSec) - x(span.startSec)), 4);
		}

		// Energy envelope (mirrored around mid).
		ctx.strokeStyle = dim;
		ctx.lineWidth = 1;
		ctx.globalAlpha = 0.85;
		ctx.beginPath();
		for (let i = 0; i < windows.length; i++) {
			const px = x(i * RMS_WINDOW_SEC);
			const amp = Math.min(1, windows[i]! * 4) * (height / 2 - 2);
			ctx.moveTo(px, mid - amp);
			ctx.lineTo(px, mid + amp);
		}
		ctx.stroke();
		ctx.globalAlpha = 1;

		// Peak ticks on top.
		ctx.strokeStyle = warm;
		ctx.lineWidth = 1.5;
		for (const peak of peaks) {
			const px = x(peak.atSec);
			ctx.beginPath();
			ctx.moveTo(px, 2);
			ctx.lineTo(px, 10);
			ctx.stroke();
		}

		// Midline.
		ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)';
		ctx.beginPath();
		ctx.moveTo(0, mid);
		ctx.lineTo(width, mid);
		ctx.stroke();
		ctx.strokeStyle = primary;
	});
</script>

<div class="relative w-full overflow-hidden rounded-lg bg-[var(--ui-bg-muted)]">
	<canvas bind:this={canvasEl} class="block w-full" aria-hidden="true"></canvas>
</div>
