<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import GifPicker, { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import { MAX_IMAGE_OVERLAYS, type MemeImageOverlay } from '$lib/meme/image-overlay';
	import { formatDuration } from '$lib/utils/format';

	let {
		id,
		layers,
		selectedId = $bindable(null),
		timingId = $bindable(null),
		showUrlForm = $bindable(false),
		url = $bindable(''),
		mediaKind,
		timelineActive,
		stageSeconds,
		busy,
		loading,
		urlBusy,
		loadedSources,
		renderSrcs,
		onBrowse,
		onInsertFrame,
		onAddUrl,
		onAddGif,
		onMove,
		onPatch,
		onRemove
	}: {
		id: string;
		layers: MemeImageOverlay[];
		selectedId: string | null;
		timingId: string | null;
		showUrlForm: boolean;
		url: string;
		mediaKind: 'image' | 'video' | null;
		timelineActive: boolean;
		stageSeconds: number;
		busy: boolean;
		loading: boolean;
		urlBusy: boolean;
		loadedSources: { has(key: string): boolean };
		renderSrcs: Map<string, string>;
		onBrowse: () => void;
		onInsertFrame: () => void;
		onAddUrl: () => void;
		onAddGif: (gif: GifChoice, atMs?: number) => void;
		onMove: (id: string, direction: -1 | 1) => void;
		onPatch: (id: string, patch: Partial<MemeImageOverlay>) => void;
		onRemove: (id: string) => void;
	} = $props();
</script>

<Popover
	{id}
	float
	placement="top-start"
	width="auto"
	label="Add an image layer"
	triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	triggerActiveClass="bg-warm-500/15 text-warm-600"
>
	{#snippet trigger()}
		<Icon name="i-lucide-image-plus" class="size-3.5" />
		Image
		{#if loading}
			<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
		{/if}
	{/snippet}
	<div class="w-auto max-w-[100vw] p-2">
		<div class="flex items-center gap-1">
			<button
				type="button"
				onclick={onBrowse}
				disabled={loading}
				class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
			>
				<Icon name="i-lucide-upload" class="size-3.5" />
				Upload file
			</button>
			<button
				type="button"
				onclick={(e) => {
					// keep the popover open — the global click-close would eat it
					e.stopPropagation();
					showUrlForm = !showUrlForm;
				}}
				disabled={loading}
				class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
			>
				<Icon name="i-lucide-link" class="size-3.5" />
				URL
			</button>
		</div>
		<!-- Insert another source from the stage itself: grab the current video
								     frame at the playhead and drop it in as a movable layer. -->
		{#if mediaKind === 'video'}
			<button
				type="button"
				onclick={() => void onInsertFrame()}
				disabled={loading || busy}
				title="Grab the frame at the playhead and add it as a movable image layer"
				class="mt-1.5 flex w-full items-center gap-1.5 rounded-lg bg-warm-500/10 px-2.5 py-2 text-[11.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
			>
				<Icon
					name={loading ? 'i-lucide-loader-circle' : 'i-lucide-image-up'}
					class="size-3.5 {loading ? 'animate-spin' : ''}"
				/>
				Frame from video @ {formatDuration(stageSeconds)}
			</button>
		{/if}
		{#if showUrlForm}
			<!-- keydown-Enter (not a <form> submit) — popover panels unmount
										     on the global click-close before deferred submits fire. -->
			<div class="mt-1.5 flex items-center gap-1">
				<input
					type="url"
					inputmode="url"
					bind:value={url}
					placeholder="https://…/sticker.png"
					class="h-8 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-[11.5px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
					disabled={urlBusy}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void onAddUrl();
						}
					}}
				/>
				<button
					type="button"
					class="flex h-8 shrink-0 items-center gap-1 rounded-full bg-warm-500/10 px-3 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
					disabled={urlBusy || !url.trim()}
					onclick={() => void onAddUrl()}
				>
					<Icon
						name={urlBusy ? 'i-lucide-loader-circle' : 'i-lucide-check'}
						class="size-3 {urlBusy ? 'animate-spin' : ''}"
					/>
				</button>
			</div>
		{/if}
		<p class="mt-1.5 flex items-center gap-1 px-0.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
			<Icon name="i-lucide-sticker" class="size-3" />
			pick GIFs or transparent stickers — tap several, then Add
		</p>
		<!-- Multi-select for mass production: tap several stickers,
									     confirm once — each lands as a layer with a 2s window at
									     the playhead, staggered 250ms apart. -->
		<GifPicker
			multiple
			max={Math.max(1, MAX_IMAGE_OVERLAYS - layers.length)}
			onpick={(g) => void onAddGif(g)}
			onbrowse={onBrowse}
			onpickmany={(gifs) => {
				const base = Math.round(stageSeconds * 1000);
				for (let i = 0; i < gifs.length; i++) {
					void onAddGif(gifs[i]!, timelineActive ? base + i * 250 : undefined);
				}
			}}
		/>
		{#if layers.length}
			<div class="mt-1.5 border-t border-[var(--ui-border-muted)] pt-1.5">
				<p class="mb-1 px-0.5 text-[10px] font-bold text-[var(--ui-text-dimmed)] uppercase">
					Layers ({layers.length}/{MAX_IMAGE_OVERLAYS})
				</p>
				<div class="flex flex-col gap-1">
					{#each layers as layer, li (layer.id)}
						<div
							class="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition {selectedId ===
							layer.id
								? 'bg-warm-500/15'
								: 'hover:bg-[var(--ui-bg-muted)]'}"
						>
							<button
								type="button"
								onclick={() => (selectedId = layer.id)}
								class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
							>
								<span
									class="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-black/40"
								>
									{#if loadedSources.has(layer.src)}
										<img
											src={renderSrcs.get(layer.src) ?? layer.src}
											alt=""
											class="max-h-full max-w-full"
										/>
									{:else}
										<Icon name="i-lucide-image" class="size-3.5 text-white/60" />
									{/if}
								</span>
								<span class="truncate text-[11px] font-semibold text-[var(--ui-text)]">
									Layer {li + 1}
								</span>
							</button>
							<!-- Z-order: later layers paint on top — stack controls.
														     stopPropagation keeps the popover open (global click-close). -->
							<span class="flex shrink-0 items-center">
								<button
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										onMove(layer.id, 1);
									}}
									disabled={busy || li === layers.length - 1}
									aria-label={`Bring layer ${li + 1} forward`}
									title="Bring forward (on top)"
									class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
								>
									<Icon name="i-lucide-chevron-up" class="size-3" />
								</button>
								<button
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										onMove(layer.id, -1);
									}}
									disabled={busy || li === 0}
									aria-label={`Send layer ${li + 1} backward`}
									title="Send backward (behind)"
									class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
								>
									<Icon name="i-lucide-chevron-down" class="size-3" />
								</button>
							</span>
							<!-- Layer timing (timed sources): chip toggles an edit row — same
														     model as caption windows; missing window = always visible. -->
							{#if timelineActive}
								<button
									type="button"
									onclick={(e) => {
										// keep the popover open — the global click-close would eat it
										e.stopPropagation();
										timingId = timingId === layer.id ? null : layer.id;
									}}
									disabled={busy}
									aria-expanded={timingId === layer.id}
									title="Show this layer only during part of the timeline"
									class="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-bold transition {timingId ===
										layer.id ||
									layer.startMs !== undefined ||
									layer.endMs !== undefined
										? 'bg-emerald-500/15 text-emerald-600'
										: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'}"
								>
									{layer.startMs !== undefined || layer.endMs !== undefined
										? `${((layer.startMs ?? 0) / 1000).toFixed(1)}–${layer.endMs !== undefined ? (layer.endMs / 1000).toFixed(1) : '∞'}s`
										: 'always'}
								</button>
							{/if}
							<button
								type="button"
								onclick={() => onRemove(layer.id)}
								aria-label={`Remove layer ${li + 1}`}
								class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
							>
								<Icon name="i-lucide-x" class="size-3.5" />
							</button>
						</div>
						{#if timelineActive && timingId === layer.id}
							<div
								class="mb-1 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2"
							>
								<label
									class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
								>
									Show from
									<input
										type="number"
										min="0"
										step="0.1"
										value={((layer.startMs ?? 0) / 1000).toFixed(1)}
										oninput={(e) => {
											const seconds = Number((e.currentTarget as HTMLInputElement).value);
											onPatch(layer.id, {
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
										value={layer.endMs !== undefined ? (layer.endMs / 1000).toFixed(1) : ''}
										placeholder="end"
										oninput={(e) => {
											const raw = (e.currentTarget as HTMLInputElement).value;
											const seconds = Number(raw);
											onPatch(layer.id, {
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
									onclick={() => onPatch(layer.id, { startMs: undefined, endMs: undefined })}
									class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]"
								>
									Always visible
								</button>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/if}
	</div>
</Popover>
