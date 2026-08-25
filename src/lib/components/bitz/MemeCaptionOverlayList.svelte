<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		MAX_OVERLAY_CHARS,
		MEME_COLORS,
		MEME_FONTS,
		type MemeTextOverlay
	} from '$lib/meme/schema';
	import { MEME_FX_OPTIONS } from '$lib/meme/fx';

	let {
		overlays,
		selectedId = $bindable(null),
		timingId = $bindable(null),
		fxId = $bindable(null),
		mediaKind,
		timelineActive,
		busy,
		patchOverlay,
		moveOverlay,
		moveOverlayRow,
		removeOverlay,
		onAddClassic
	}: {
		overlays: MemeTextOverlay[];
		selectedId: string | null;
		timingId: string | null;
		fxId: string | null;
		mediaKind: 'image' | 'video' | null;
		timelineActive: boolean;
		busy: boolean;
		patchOverlay: (id: string, patch: Partial<MemeTextOverlay>) => void;
		moveOverlay: (id: string, deltaY: number) => void;
		moveOverlayRow: (id: string, direction: -1 | 1) => void;
		removeOverlay: (id: string) => void;
		onAddClassic: () => void;
	} = $props();

	function isCustomCaptionColor(color: string): boolean {
		return !(MEME_COLORS as readonly string[]).includes(color);
	}
</script>

<!-- Overlay list -->
{#if overlays.length}
	<div class="flex flex-col gap-2">
		{#each overlays as overlay, i (overlay.id)}
			<div
				class="rounded-xl border px-3 py-2.5 transition {selectedId === overlay.id
					? 'border-warm-500/50 bg-warm-500/[0.06]'
					: 'border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]'}"
			>
				<div class="flex items-center gap-2">
					<span
						class="grid size-6 shrink-0 place-items-center rounded-full bg-warm-500/12 font-mono text-[10px] font-bold text-warm-500"
					>
						{i + 1}
					</span>
					<!-- The input always shows the RAW typed text ('Hi' stays 'Hi') —
					     only the STAGE applies the ALL-CAPS styling, so editing is
					     never visually mangled. -->
					<input
						value={overlay.text}
						maxlength={MAX_OVERLAY_CHARS}
						placeholder="Caption text…"
						aria-label={`Caption ${i + 1} text`}
						disabled={busy}
						oninput={(e) =>
							patchOverlay(overlay.id, {
								text: (e.currentTarget as HTMLInputElement).value
							})}
						onfocus={() => (selectedId = overlay.id)}
						class="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold text-[var(--ui-text)] outline-none placeholder:font-normal placeholder:text-[var(--ui-text-dimmed)]"
					/>
					<!-- Case quick-toggle, always visible: free-write (Aa) vs
					     classic ALL CAPS (AA) — one click, no selection needed. -->
					<button
						type="button"
						onclick={() => patchOverlay(overlay.id, { caps: !overlay.caps })}
						disabled={busy}
						aria-pressed={overlay.caps}
						title={overlay.caps
							? 'ALL CAPS on — click to keep your own casing'
							: 'Keeping your casing — click for ALL CAPS'}
						class="grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-extrabold transition {overlay.caps
							? 'bg-warm-500/15 text-warm-500'
							: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
					>
						{overlay.caps ? 'AA' : 'Aa'}
					</button>
					{#if mediaKind === 'video'}
						<button
							type="button"
							onclick={() => moveOverlay(overlay.id, -0.05)}
							disabled={busy}
							aria-label="Move caption up"
							class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-40"
						>
							<Icon name="i-lucide-chevron-up" class="size-3.5" />
						</button>
						<button
							type="button"
							onclick={() => moveOverlay(overlay.id, 0.05)}
							disabled={busy}
							aria-label="Move caption down"
							class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-40"
						>
							<Icon name="i-lucide-chevron-down" class="size-3.5" />
						</button>
					{/if}
					<!-- Z-order (2+ captions): later slots paint on top. -->
					{#if overlays.length > 1}
						<button
							type="button"
							onclick={() => moveOverlayRow(overlay.id, 1)}
							disabled={busy || i === overlays.length - 1}
							aria-label={`Stack caption ${i + 1} on top`}
							title="Bring forward (paints on top)"
							class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-30"
						>
							<Icon name="i-lucide-bring-to-front" class="size-3.5" />
						</button>
						<button
							type="button"
							onclick={() => moveOverlayRow(overlay.id, -1)}
							disabled={busy || i === 0}
							aria-label={`Send caption ${i + 1} backward`}
							title="Send backward (paints behind)"
							class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-30"
						>
							<Icon name="i-lucide-send-to-back" class="size-3.5" />
						</button>
					{/if}
					<button
						type="button"
						onclick={() => removeOverlay(overlay.id)}
						disabled={busy}
						aria-label={`Remove caption ${i + 1}`}
						class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--tone-error-text)]/10 hover:text-[var(--tone-error-text)] disabled:opacity-40"
					>
						<Icon name="i-lucide-x" class="size-3.5" />
					</button>
				</div>
				{#if selectedId === overlay.id}
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						<!-- Font -->
						{#each MEME_FONTS as font (font)}
							<button
								type="button"
								onclick={() => patchOverlay(overlay.id, { font })}
								disabled={busy}
								class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {overlay.font ===
								font
									? 'bg-warm-500 text-white'
									: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
							>
								{font}
							</button>
						{/each}
						<span class="mx-1 h-4 w-px bg-[var(--ui-border-muted)]"></span>
						<!-- Colors -->
						{#each MEME_COLORS as color (color)}
							<button
								type="button"
								onclick={() => patchOverlay(overlay.id, { color })}
								disabled={busy}
								aria-label={`Text color ${color}`}
								class="grid size-5 place-items-center rounded-full border border-black/20 transition hover:scale-110 {overlay.color ===
								color
									? 'ring-2 ring-warm-500 ring-offset-1 ring-offset-[var(--ui-bg-muted)]'
									: ''}"
								style={`background:${color}`}
							></button>
						{/each}
						<!-- Custom color: any hex via the native picker; shows the
						     current color when it's outside the preset palette. -->
						<label
							class="relative grid size-5 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed transition hover:scale-110 {isCustomCaptionColor(
								overlay.color
							)
								? 'border-warm-500 ring-2 ring-warm-500 ring-offset-1 ring-offset-[var(--ui-bg-muted)]'
								: 'border-[var(--ui-border-accented)]'}"
							title="Custom text color"
							style={isCustomCaptionColor(overlay.color) ? `background:${overlay.color};` : ''}
						>
							{#if !isCustomCaptionColor(overlay.color)}
								<Icon name="i-lucide-pipette" class="size-3 text-[var(--ui-text-muted)]" />
							{/if}
							<input
								type="color"
								value={/^#[0-9a-f]{6}$/i.test(overlay.color) ? overlay.color : '#ffffff'}
								disabled={busy}
								aria-label="Custom text color"
								class="absolute inset-0 size-full cursor-pointer opacity-0"
								oninput={(e) => {
									const color = (e.currentTarget as HTMLInputElement).value;
									if (/^#[0-9a-f]{6}$/i.test(color)) patchOverlay(overlay.id, { color });
								}}
							/>
						</label>
						<span class="mx-1 h-4 w-px bg-[var(--ui-border-muted)]"></span>
						<button
							type="button"
							onclick={() => patchOverlay(overlay.id, { caps: !overlay.caps })}
							disabled={busy}
							aria-pressed={overlay.caps}
							class="rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase transition {overlay.caps
								? 'bg-warm-500/15 text-warm-500'
								: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							Aa
						</button>
						<button
							type="button"
							onclick={() => patchOverlay(overlay.id, { stroke: !overlay.stroke })}
							disabled={busy}
							aria-pressed={overlay.stroke}
							title="Classic outline around the letters"
							class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {overlay.stroke
								? 'bg-warm-500/15 text-warm-500'
								: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							Ⓞ
						</button>
						<button
							type="button"
							onclick={() => patchOverlay(overlay.id, { bar: !overlay.bar })}
							disabled={busy}
							aria-pressed={overlay.bar}
							title="Contrast bar behind the text"
							class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {overlay.bar
								? 'bg-warm-500/15 text-warm-500'
								: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							▬
						</button>
						<!-- Size slider -->
						<input
							type="range"
							min="3"
							max="22"
							step="1"
							value={Math.round(overlay.size * 100)}
							oninput={(e) =>
								patchOverlay(overlay.id, {
									size: Number((e.currentTarget as HTMLInputElement).value) / 100
								})}
							disabled={busy}
							aria-label={`Caption ${i + 1} size`}
							class="h-1.5 min-w-16 flex-1 accent-[var(--color-warm-500)]"
						/>
						{#if timelineActive}
							<button
								type="button"
								onclick={() => (fxId = fxId === overlay.id ? null : overlay.id)}
								disabled={busy}
								aria-expanded={fxId === overlay.id}
								title="Motion effect — pop, fade, shake or spin, baked into the export"
								class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {fxId ===
									overlay.id ||
								(overlay.fx && overlay.fx !== 'none')
									? 'bg-primary-500/15 text-primary-600'
									: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
							>
								<Icon name="i-lucide-wand-sparkles" class="size-3" />
								{overlay.fx && overlay.fx !== 'none' ? overlay.fx : 'fx'}
							</button>
						{/if}
						{#if timelineActive && fxId === overlay.id}
							<div
								class="mt-2 flex flex-wrap items-center gap-1 rounded-lg bg-[var(--ui-bg-accented)] px-2 py-1.5"
							>
								{#each MEME_FX_OPTIONS as opt (opt.id)}
									<button
										type="button"
										onclick={() => {
											patchOverlay(overlay.id, { fx: opt.id });
											fxId = null;
										}}
										title={opt.hint}
										class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {(overlay.fx ??
											'none') === opt.id
											? 'bg-primary-500 text-white'
											: 'bg-[var(--ui-bg)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
									>
										{opt.label}
									</button>
								{/each}
							</div>
						{/if}
						{#if mediaKind === 'video'}
							<button
								type="button"
								onclick={() => (timingId = timingId === overlay.id ? null : overlay.id)}
								disabled={busy}
								aria-expanded={timingId === overlay.id}
								title="Show this caption only during part of the video"
								class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {timingId ===
									overlay.id ||
								overlay.startMs !== undefined ||
								overlay.endMs !== undefined
									? 'bg-warm-500/15 text-warm-500'
									: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
							>
								<Icon name="i-lucide-timer" class="size-3" />
								{overlay.startMs !== undefined || overlay.endMs !== undefined
									? `${((overlay.startMs ?? 0) / 1000).toFixed(1)}–${overlay.endMs !== undefined ? (overlay.endMs / 1000).toFixed(1) : '∞'}s`
									: 'always'}
							</button>
						{/if}
						{#if mediaKind === 'video' && timingId === overlay.id}
							<div
								class="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2"
							>
								<label
									class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
								>
									Show from
									<input
										type="number"
										min="0"
										step="0.1"
										value={((overlay.startMs ?? 0) / 1000).toFixed(1)}
										oninput={(e) => {
											const seconds = Number((e.currentTarget as HTMLInputElement).value);
											patchOverlay(overlay.id, {
												startMs:
													Number.isFinite(seconds) && seconds > 0
														? Math.round(seconds * 1000)
														: undefined
											});
										}}
										class="w-16 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
									/>
									s
								</label>
								<label
									class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
								>
									until
									<input
										type="number"
										min="0"
										step="0.1"
										value={overlay.endMs !== undefined ? (overlay.endMs / 1000).toFixed(1) : ''}
										placeholder="end"
										oninput={(e) => {
											const raw = (e.currentTarget as HTMLInputElement).value;
											const seconds = Number(raw);
											patchOverlay(overlay.id, {
												endMs:
													raw !== '' && Number.isFinite(seconds) && seconds > 0
														? Math.round(seconds * 1000)
														: undefined
											});
										}}
										class="w-16 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
									/>
									s
								</label>
								<button
									type="button"
									onclick={() =>
										patchOverlay(overlay.id, {
											startMs: undefined,
											endMs: undefined
										})}
									class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]"
								>
									Always visible
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{:else}
	<button
		type="button"
		onclick={onAddClassic}
		disabled={busy}
		class="flex items-center gap-2 rounded-xl border-2 border-dashed border-[var(--ui-border-accented)] px-3.5 py-3 text-left transition hover:border-warm-500/60 hover:bg-[var(--ui-bg-muted)] disabled:opacity-40"
	>
		<Icon name="i-lucide-letter-text" class="size-5 shrink-0 text-warm-500" />
		<span>
			<span class="block text-[13px] font-bold text-[var(--ui-text)]">Add captions</span>
			<span class="block text-[11px] text-[var(--ui-text-muted)]">
				Start with the classic top/bottom template or add your own
			</span>
		</span>
	</button>
{/if}
