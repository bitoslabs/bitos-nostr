<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import RichText from '$lib/components/feed/RichText.svelte';
	import MemePostCaption from './MemePostCaption.svelte';
	import { SHAREABLE_LICENSES, type ShareableLicense } from '$lib/meme/shared-sounds';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { rewriteMentions } from '$lib/utils/nip27';
	import type { TrackedMention } from '$lib/utils/mentions';
	import { sharedSoundsStore } from '$lib/stores/meme-shared-sounds.svelte';
	import { soundLibrary } from '$lib/stores/meme-sounds.svelte';
	import { soundIO } from '$lib/stores/meme-sound-io.svelte';

	let { open = $bindable(false), showTrigger = true }: { open?: boolean; showTrigger?: boolean } =
		$props();
	let soundId = $state('');
	let title = $state('');
	let description = $state('');
	let descriptionMentions = $state<TrackedMention[]>([]);
	let tags = $state('');
	let attribution = $state('');
	let license = $state<ShareableLicense>('CC0-1.0');
	let coverFile = $state<File | null>(null);
	let coverUrl = $state('');
	let audioInput = $state<HTMLInputElement | null>(null);
	let coverInput = $state<HTMLInputElement | null>(null);
	let pow = $state(false);
	let importing = $state(false);
	const selectedSound = $derived(soundLibrary.list.find((sound) => sound.id === soundId) ?? null);
	const me = $derived(identity.current);
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const tagList = $derived(
		[...new Set(tags.split(/[\s,#]+/).map((tag) => tag.trim().toLowerCase()))]
			.filter((tag) => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(tag))
			.slice(0, 10)
	);
	const busy = $derived(!!sharedSoundsStore.sharingId);
	const canPublish = $derived(!!soundId && !!title.trim() && !busy);
	const publishHint = $derived(
		!soundId
			? 'Pick or import a sound first'
			: !title.trim()
				? 'Add a title first'
				: busy
					? 'Publishing…'
					: ''
	);
	const SUGGESTED_TAGS = ['meme', 'reaction', 'funny', 'sfx', 'remix'];
	const suggestedTags = $derived(
		SUGGESTED_TAGS.filter((tag) => !tagList.includes(tag)).slice(0, 4)
	);

	// Live local preview of a chosen cover (revoked on change/unmount).
	$effect(() => {
		if (!coverFile) {
			coverUrl = '';
			return;
		}
		const url = URL.createObjectURL(coverFile);
		coverUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	function choose(id: string): void {
		soundId = id;
		const sound = soundLibrary.list.find((item) => item.id === id);
		if (sound && !title.trim()) title = sound.label;
	}

	function removeTag(tag: string): void {
		tags = tagList.filter((candidate) => candidate !== tag).join(', ');
	}

	function addTag(tag: string): void {
		if (tagList.includes(tag)) return;
		tags = [...tagList, tag].join(', ');
	}

	function resetForm(): void {
		soundId = '';
		title = '';
		description = '';
		descriptionMentions = [];
		tags = '';
		attribution = '';
		coverFile = null;
		pow = false;
	}

	async function publish(): Promise<void> {
		if (!canPublish) return;
		const published = await sharedSoundsStore.share(soundId, {
			label: title,
			// @name → nostr:npub… so mentions notify (NIP-27), same as the Composer.
			description: rewriteMentions(description, descriptionMentions),
			topics: tags.split(/[\s,#]+/).filter(Boolean),
			license,
			attribution,
			cover: coverFile ?? undefined,
			pow: pow ? 16 : undefined
		});
		if (published) {
			resetForm();
			open = false;
		}
	}

	async function importAudio(file: File | null): Promise<void> {
		if (!file) return;
		importing = true;
		try {
			const durationSec = await soundIO.durationSec(file);
			const saved = await soundIO.importBlob(
				file,
				durationSec,
				'device',
				file.name.replace(/\.[^.]+$/, '')
			);
			if (saved) choose(saved.id);
		} finally {
			importing = false;
		}
	}

	function onCoverChange(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		coverFile = input.files?.[0] ?? null;
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

<Dialog bind:open title="Share public sound">
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
		onchange={onCoverChange}
	/>
	<div class="space-y-4">
		<p class="text-[12px] leading-relaxed text-[var(--ui-text-muted)]">
			Publish a standalone, reusable sound for every bitz creator — #hashtags and @mentions in the
			description work just like the composer.
		</p>

		<!-- Live public preview: exactly how the sound card reads once published. -->
		<section
			aria-label="Public sound preview"
			class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/60 p-3.5"
		>
			<p class="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wide text-primary-600">
				<Icon name="i-lucide-eye" class="size-3.5" /> PUBLIC SOUND PREVIEW
			</p>
			<div class="mt-2.5 flex gap-2.5">
				{#if me}
					<Avatar
						pubkey={me.pk}
						name={displayName}
						picture={myProfile?.picture}
						size={32}
						class="shrink-0"
					/>
				{:else}
					<span
						class="grid size-8 shrink-0 place-items-center rounded-full bg-primary-500 text-white"
						><Icon name="i-lucide-user" class="size-4" /></span
					>
				{/if}
				<div class="min-w-0 flex-1">
					<p class="text-[12px] font-bold">{displayName}</p>
					<p class="mt-0.5 truncate text-[12px] font-semibold">
						{title.trim() || selectedSound?.label || 'Untitled sound'}
					</p>
					<p class="mt-1 text-[11.5px] leading-relaxed text-[var(--ui-text)]">
						{#if description.trim()}
							<RichText content={description.trim()} />
						{:else}<span class="text-[var(--ui-text-dimmed)]">No public description.</span>{/if}
					</p>
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						{#if selectedSound}
							<span
								class="flex items-center gap-1 rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-bold text-primary-600"
								><Icon
									name="i-lucide-audio-lines"
									class="size-3"
								/>{selectedSound.durationSec.toFixed(1)}s</span
							>
						{/if}
						<span
							class="rounded-full bg-[var(--ui-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)]"
							>{license}</span
						>
						{#each tagList as tag (tag)}
							<span
								class="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-bold text-primary-600"
								>#{tag}</span
							>
						{/each}
					</div>
				</div>
				{#if coverUrl}
					<img
						src={coverUrl}
						alt="Cover preview"
						class="size-12 shrink-0 rounded-lg border border-[var(--ui-border-muted)] object-cover"
					/>
				{/if}
			</div>
		</section>

		<!-- Sound source -->
		<section aria-label="Sound">
			<div class="mb-1.5 flex items-center justify-between">
				<span class="text-[11px] font-bold text-[var(--ui-text-muted)]">Sound</span>
				<button
					type="button"
					onclick={() => audioInput?.click()}
					disabled={importing}
					class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold text-primary-600 transition hover:bg-primary-500/10 disabled:opacity-40"
				>
					<Icon
						name={importing ? 'i-lucide-loader-circle' : 'i-lucide-upload'}
						class="size-3 {importing ? 'animate-spin' : ''}"
					/>{importing ? 'Importing…' : 'Import audio'}
				</button>
			</div>
			<select
				bind:value={soundId}
				onchange={() => choose(soundId)}
				class="h-10 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 text-[12.5px] outline-none focus:border-primary-500"
			>
				<option value="">Choose a sound…</option>
				{#each soundLibrary.list as sound (sound.id)}
					<option value={sound.id}>{sound.label} · {sound.durationSec.toFixed(1)}s</option>
				{/each}
			</select>
			{#if selectedSound}
				<div
					class="mt-2 flex items-center gap-3 rounded-xl border border-primary-500/20 bg-primary-500/5 px-3 py-2.5"
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
			{:else if !soundLibrary.list.length}
				<p
					class="mt-2 rounded-lg bg-[var(--ui-bg-muted)] p-3 text-[11.5px] text-[var(--ui-text-muted)]"
				>
					Import or record a sound in My sounds first — then share it here.
				</p>
			{/if}
		</section>

		<!-- Title -->
		<label class="block">
			<span
				class="mb-1 flex items-center justify-between text-[11px] font-bold text-[var(--ui-text-muted)]"
				><span>Title</span><span class="tabular-nums">{title.length}/40</span></span
			>
			<input
				bind:value={title}
				maxlength="40"
				placeholder="Sound title"
				class="h-10 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 text-[12.5px] outline-none focus:border-primary-500"
			/>
		</label>

		<!-- Public description: composer-grade input with @mention autocomplete -->
		<section>
			<h3 class="text-[12px] font-bold">Public description</h3>
			<p class="mt-0.5 text-[11px] text-[var(--ui-text-muted)]">
				Explain how creators can use this sound — @mentions notify, #hashtags become topics.
			</p>
			<div class="mt-2">
				<MemePostCaption
					bind:value={description}
					bind:mentions={descriptionMentions}
					{busy}
					softLimit={300}
					hardLimit={500}
					onSubmit={() => void publish()}
				/>
			</div>
		</section>

		<!-- Discovery tags -->
		<section>
			<label class="block">
				<span class="mb-1 block text-[11px] font-bold text-[var(--ui-text-muted)]">Tags</span>
				<input
					bind:value={tags}
					maxlength="400"
					placeholder="meme, reaction, bitcoin"
					class="h-10 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 text-[12.5px] outline-none focus:border-primary-500"
				/>
			</label>
			{#if tagList.length}
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#each tagList as tag (tag)}
						<button
							type="button"
							onclick={() => removeTag(tag)}
							aria-label={`Remove tag ${tag}`}
							title="Remove tag"
							class="group flex items-center gap-1 rounded-full bg-primary-500/10 py-0.5 pr-1 pl-2 text-[10.5px] font-bold text-primary-600 transition hover:bg-primary-500/20"
						>
							#{tag}
							<Icon
								name="i-lucide-x"
								class="size-3 opacity-50 transition group-hover:opacity-100"
							/>
						</button>
					{/each}
				</div>
			{/if}
			{#if suggestedTags.length}
				<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
					<span class="text-[10px] font-semibold text-[var(--ui-text-dimmed)]">Quick add:</span>
					{#each suggestedTags as tag (tag)}
						<button
							type="button"
							onclick={() => addTag(tag)}
							class="rounded-full border border-[var(--ui-border-muted)] px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-primary-600"
							>+{tag}</button
						>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Cover -->
		<section aria-label="Cover image">
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => coverInput?.click()}
					class="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--ui-border-muted)] px-3 py-2.5 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500/45 hover:text-primary-600"
				>
					<Icon name="i-lucide-image-plus" class="size-4" />
					{coverFile ? coverFile.name.slice(0, 24) : 'Add cover (optional)'}
				</button>
				{#if coverFile}
					<img src={coverUrl} alt="" class="size-10 rounded-lg object-cover" />
					<button
						type="button"
						onclick={() => (coverFile = null)}
						aria-label="Remove cover"
						class="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
					>
						<Icon name="i-lucide-trash-2" class="size-4" />
					</button>
				{/if}
			</div>
		</section>

		<!-- License + attribution -->
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

		<p class="text-center text-[10.5px] leading-relaxed text-[var(--ui-text-dimmed)]">
			Only publish audio you have permission to share under the selected license.
		</p>
	</div>
	{#snippet footer()}
		<div class="flex w-full items-center justify-between gap-3">
			<p class="min-w-0 flex-1 truncate text-[10.5px] text-[var(--ui-text-dimmed)]">
				{publishHint || 'Public to your write relays · ⌘↵ to publish'}
			</p>
			<button
				type="button"
				disabled={!canPublish}
				onclick={() => void publish()}
				class="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary-500 px-5 text-[12.5px] font-bold text-white transition hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
			>
				<Icon
					name={busy ? 'i-lucide-loader-circle' : 'i-lucide-send'}
					class="size-4 {busy ? 'animate-spin' : ''}"
				/>
				{busy ? 'Publishing…' : 'Publish public sound'}
			</button>
		</div>
	{/snippet}
</Dialog>
