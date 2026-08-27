<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import MemePostCaption from './MemePostCaption.svelte';
	import { SHAREABLE_LICENSES, type ShareableLicense } from '$lib/meme/shared-sounds';
	import { sharedSoundsStore } from '$lib/stores/meme-shared-sounds.svelte';
	import { soundLibrary } from '$lib/stores/meme-sounds.svelte';
	import { soundIO } from '$lib/stores/meme-sound-io.svelte';

	let { open = $bindable(false), showTrigger = true }: { open?: boolean; showTrigger?: boolean } = $props();
	let soundId = $state('');
	let title = $state('');
	let description = $state('');
	let tags = $state('');
	let attribution = $state('');
	let license = $state<ShareableLicense>('CC0-1.0');
	let coverFile = $state<File | null>(null);
	let audioInput = $state<HTMLInputElement | null>(null);
	let coverInput = $state<HTMLInputElement | null>(null);
	let pow = $state(false);
	const selectedSound = $derived(soundLibrary.list.find((sound) => sound.id === soundId) ?? null);
	const tagPreview = $derived(
		[...new Set(tags.split(/[\s,#]+/).map((tag) => tag.trim().toLowerCase()))]
			.filter((tag) => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(tag))
			.slice(0, 10)
	);

	function choose(id: string): void {
		soundId = id;
		const sound = soundLibrary.list.find((item) => item.id === id);
		if (sound && !title.trim()) title = sound.label;
	}

	async function publish(): Promise<void> {
		if (!soundId || !title.trim()) return;
		const published = await sharedSoundsStore.share(soundId, {
			label: title,
			description,
			topics: tags.split(/[\s,#]+/).filter(Boolean),
			license,
			attribution,
			cover: coverFile ?? undefined,
			pow: pow ? 16 : undefined
		});
		if (published) open = false;
	}

	async function importAudio(file: File | null): Promise<void> {
		if (!file) return;
		const durationSec = await soundIO.durationSec(file);
		const saved = await soundIO.importBlob(
			file,
			durationSec,
			'device',
			file.name.replace(/\.[^.]+$/, '')
		);
		if (saved) choose(saved.id);
	}
</script>

{#if showTrigger}
	<button
		type="button"
		onclick={() => (open = true)}
		class="flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/20"
	>
		<Icon name="i-lucide-share-2" class="size-3.5" />
		Share sound
	</button>
{/if}

<Dialog bind:open title="Publish sound">
	<input
		bind:this={audioInput}
		type="file"
		accept="audio/*"
		class="hidden"
		onchange={(event) =>
			void importAudio((event.currentTarget as HTMLInputElement).files?.[0] ?? null)}
	/>
	<input
		bind:this={coverInput}
		type="file"
		accept="image/*"
		class="hidden"
		onchange={(event) => (coverFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null)}
	/>
	<div class="space-y-4">
		<p class="text-[12px] leading-relaxed text-[var(--ui-text-muted)]">
			Publish a standalone, reusable audio post. It does not create a video.
		</p>
		<section
			aria-label="Public sound preview"
			class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/60 p-3.5"
		>
			<p class="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wide text-primary-600">
				<Icon name="i-lucide-eye" class="size-3.5" /> PUBLIC SOUND PREVIEW
			</p>
			<div class="mt-2.5 flex gap-2.5">
				<span class="grid size-8 shrink-0 place-items-center rounded-full bg-primary-500 text-white"
					><Icon name="i-lucide-user" class="size-4" /></span
				>
				<div class="min-w-0">
					<p class="text-[12px] font-bold">You</p>
					<p class="mt-1 truncate text-[12px] font-semibold">
						{title.trim() || selectedSound?.label || 'Untitled sound'}
					</p>
					<p
						class="mt-1 text-[11.5px] leading-relaxed whitespace-pre-wrap text-[var(--ui-text-muted)]"
					>
						{description.trim() || 'No public description.'}
					</p>
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#if selectedSound}<span
								class="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-bold text-primary-600"
								>{selectedSound.durationSec.toFixed(1)}s audio</span
							>{/if}
						{#each tagPreview as tag (tag)}<span
								class="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-bold text-primary-600"
								>#{tag}</span
							>{/each}
					</div>
				</div>
			</div>
		</section>
		<div class="grid grid-cols-2 gap-2">
			<button
				type="button"
				onclick={() => audioInput?.click()}
				class="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-500/45 bg-primary-500/5 px-3 py-2.5 text-[11.5px] font-bold text-primary-600"
				><Icon name="i-lucide-music-2" class="size-4" />Browse audio</button
			>
			<button
				type="button"
				onclick={() => coverInput?.click()}
				class="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--ui-border-muted)] px-3 py-2.5 text-[11.5px] font-bold text-[var(--ui-text-muted)]"
				><Icon name="i-lucide-image-plus" class="size-4" />{coverFile
					? 'Cover ready'
					: 'Add cover'}</button
			>
		</div>
		<label class="block"
			><span class="mb-1 block text-[11px] font-bold text-[var(--ui-text-muted)]">Sound</span
			><select
				bind:value={soundId}
				onchange={() => choose(soundId)}
				class="h-10 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 text-[12.5px] outline-none focus:border-primary-500"
				><option value="">Choose a sound…</option
				>{#each soundLibrary.list as sound (sound.id)}<option value={sound.id}
						>{sound.label} · {sound.durationSec.toFixed(1)}s</option
					>{/each}</select
			></label
		>
		{#if selectedSound}
			<div
				class="flex items-center gap-3 rounded-xl border border-primary-500/20 bg-primary-500/5 px-3 py-2.5"
			>
				<span
					class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/12 text-primary-600"
					><Icon name="i-lucide-audio-lines" class="size-4" /></span
				>
				<span class="min-w-0"
					><span class="block truncate text-[12.5px] font-bold">{selectedSound.label}</span><span
						class="block text-[10.5px] text-[var(--ui-text-muted)]"
						>{selectedSound.durationSec.toFixed(1)}s · {selectedSound.mime || 'audio'}</span
					></span
				>
				<button
					type="button"
					onclick={() => void soundIO.preview(selectedSound)}
					aria-label={`Play ${selectedSound.label}`}
					title="Preview sound"
					class="grid size-9 shrink-0 place-items-center rounded-full bg-primary-500 text-white transition hover:brightness-110"
				>
					<Icon name="i-lucide-play" class="size-4" />
				</button>
			</div>
		{/if}
		{#if !soundLibrary.list.length}<p
				class="rounded-lg bg-[var(--ui-bg-muted)] p-3 text-[11.5px] text-[var(--ui-text-muted)]"
			>
				Import or record a sound in My sounds first.
			</p>{/if}
		<label class="block"
			><span class="mb-1 block text-[11px] font-bold text-[var(--ui-text-muted)]">Title</span><input
				bind:value={title}
				maxlength="40"
				placeholder="Sound title"
				class="h-10 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 text-[12.5px] outline-none focus:border-primary-500"
			/></label
		>
		<section>
			<h3 class="text-[12px] font-bold">Public description</h3>
			<p class="mt-0.5 text-[11px] text-[var(--ui-text-muted)]">
				Explain how creators can use this sound.
			</p>
			<div class="mt-2">
				<MemePostCaption
					bind:value={description}
					busy={!!sharedSoundsStore.sharingId}
					softLimit={300}
					hardLimit={500}
				/>
			</div>
		</section>
		<label class="block"
			><span class="mb-1 block text-[11px] font-bold text-[var(--ui-text-muted)]">Tags</span><input
				bind:value={tags}
				maxlength="400"
				placeholder="meme, reaction, bitcoin"
				class="h-10 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 text-[12.5px] outline-none focus:border-primary-500"
			/></label
		>
		{#if tagPreview.length}
			<div class="-mt-2 flex flex-wrap gap-1.5">
				{#each tagPreview as tag (tag)}<span
						class="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10.5px] font-bold text-primary-600"
						>#{tag}</span
					>{/each}
			</div>
		{/if}
		<div class="grid grid-cols-2 gap-2">
			<label class="block"
				><span class="mb-1 block text-[11px] font-bold text-[var(--ui-text-muted)]">License</span
				><select
					bind:value={license}
					class="h-10 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2 text-[12px] outline-none focus:border-primary-500"
					>{#each SHAREABLE_LICENSES as option (option)}<option value={option}>{option}</option
						>{/each}</select
				></label
			><label class="block"
				><span class="mb-1 block text-[11px] font-bold text-[var(--ui-text-muted)]"
					>Attribution</span
				><input
					bind:value={attribution}
					maxlength="140"
					placeholder="Optional credit"
					class="h-10 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 text-[12px] outline-none focus:border-primary-500"
				/></label
			>
		</div>
		<button
			type="button"
			onclick={() => (pow = !pow)}
			aria-pressed={pow}
			class="flex w-full items-center gap-2 rounded-xl border p-3 text-left transition {pow
				? 'border-primary-500 bg-primary-500/10 text-primary-600'
				: 'border-[var(--ui-border-muted)]'}"
			><Icon name="i-lucide-gem" class="size-4" /><span
				><span class="block text-[12px] font-bold">Rare sound / PoW</span><span
					class="block text-[10.5px] text-[var(--ui-text-muted)]"
					>Mine a 16-bit NIP-13 proof before publishing.</span
				></span
			></button
		>
		<div class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-2.5">
			<p class="mb-2 text-[10.5px] font-semibold text-[var(--ui-text-muted)]">
				Your audio is published as a standalone public sound. Description and tags help creators
				find it.
			</p>
			<button
				type="button"
				disabled={!soundId || !title.trim() || !!sharedSoundsStore.sharingId}
				onclick={() => void publish()}
				class="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary-500 text-[12.5px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
				><Icon
					name={sharedSoundsStore.sharingId ? 'i-lucide-loader-circle' : 'i-lucide-send'}
					class="size-4 {sharedSoundsStore.sharingId ? 'animate-spin' : ''}"
				/>{sharedSoundsStore.sharingId ? 'Publishing…' : 'Publish public sound'}</button
			>
		</div>
		<p class="text-center text-[10.5px] leading-relaxed text-[var(--ui-text-dimmed)]">
			Only publish audio you have permission to share under the selected license.
		</p>
	</div>
</Dialog>
