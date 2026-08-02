<script lang="ts">
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { media, MEDIA_PROVIDERS, providerLabel } from '$lib/stores/media.svelte';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import type { UploadedMedia } from '$lib/media/uploaders';
	import { humanBytes } from '$lib/media/uploaders';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import StoryRing from './StoryRing.svelte';
	import PollComposer from './PollComposer.svelte';

	let text = $state('');
	let posting = $state(false);
	let uploading = $state(false);
	let attachments = $state<UploadedMedia[]>([]);
	let sensitive = $state(false);

	// Per-post provider selection. Defaults to the configured default and stays
	// valid as the user toggles providers in Settings.
	let selectedProvider = $state<MediaProviderId | 'none'>(media.state.defaultProvider);

	let imageInput = $state<HTMLInputElement | null>(null);
	let videoInput = $state<HTMLInputElement | null>(null);
	let pollOpen = $state(false);

	const me = $derived(identity.current);
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const SOFT_LIMIT = 4_000;
	const HARD_LIMIT = 16_000;
	const remaining = $derived(HARD_LIMIT - text.length);
	const overSoftLimit = $derived(text.length > SOFT_LIMIT);
	const overHardLimit = $derived(text.length > HARD_LIMIT);
	const countLabel = $derived(
		text.length <= SOFT_LIMIT
			? `${text.length.toLocaleString()} / ${SOFT_LIMIT.toLocaleString()}`
			: `${text.length.toLocaleString()} / ${HARD_LIMIT.toLocaleString()}`
	);

	const configuredProviders = $derived(MEDIA_PROVIDERS.filter((p) => media.isConfigured(p.id)));
	const canPost = $derived(
		(posting || uploading || overHardLimit || (!text.trim() && attachments.length === 0)) === false
	);

	// Keep the selection valid whenever providers/defaults change.
	$effect(() => {
		const current = selectedProvider;
		const valid = (id: MediaProviderId | 'none') => id === 'none' || media.isConfigured(id);
		if (valid(current)) {
			// Prefer the user's default when it becomes available and nothing valid is chosen.
			if (
				current === 'none' &&
				media.state.defaultProvider !== 'none' &&
				media.isConfigured(media.state.defaultProvider)
			) {
				selectedProvider = media.state.defaultProvider;
			}
			return;
		}
		const def = media.state.defaultProvider;
		if (def !== 'none' && media.isConfigured(def)) {
			selectedProvider = def;
			return;
		}
		selectedProvider = configuredProviders[0]?.id ?? 'none';
	});

	$effect(() => {
		if (me) profiles.ensure([me.pk]);
	});

	const attachActions = [
		{
			icon: 'i-lucide-image',
			label: 'Photo',
			color: 'text-primary-500',
			accept: 'image/*',
			multiple: true,
			pick: () => imageInput?.click()
		},
		{
			icon: 'i-lucide-video',
			label: 'Video',
			color: 'text-accent-500',
			accept: 'video/*',
			multiple: true,
			pick: () => videoInput?.click()
		}
	];

	const stubActions = [
		{ icon: 'i-lucide-clapperboard', label: 'Reel', color: 'text-warm-500', toast: 'Reel creator' },
		{
			icon: 'i-lucide-bar-chart-3',
			label: 'Poll',
			color: 'text-ink',
			onClick: () => (pollOpen = true)
		}
	];

	async function handleFiles(files: FileList | null) {
		if (!files || !files.length) return;
		const provider = selectedProvider;
		uploading = true;
		let ok = 0;
		try {
			for (const file of Array.from(files)) {
				try {
					const uploaded = await media.upload(file, provider === 'none' ? undefined : provider, {
						pubkey: me?.pk,
						purpose: 'note'
					});
					attachments = [...attachments, uploaded];
					ok++;
				} catch (e) {
					toasts.error(`${file.name}: ${(e as Error).message}`);
				}
			}
			if (ok)
				toasts.success(
					`Uploaded ${ok} ${ok === 1 ? 'file' : 'files'} via ${providerLabel(provider === 'none' ? 'server' : provider)}`
				);
		} finally {
			uploading = false;
		}
	}

	function onImageInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		void handleFiles(input.files);
		input.value = '';
	}

	function removeAttachment(idx: number) {
		attachments = attachments.filter((_, i) => i !== idx);
	}

	async function submit() {
		if (!canPost || posting) return;
		posting = true;
		try {
			let content = text.trim();
			if (attachments.length) {
				const links = attachments
					.map((a) => (a.kind === 'image' ? `![${a.kind}](${a.url})` : a.url))
					.join('\n');
				content = content ? `${content}\n\n${links}` : links;
			}
			await feed.post(content, { sensitive });
			text = '';
			attachments = [];
			sensitive = false;
			toasts.success('Posted to Nostr');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			posting = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
</script>

{#if me}
	<div class="post-card p-4">
		<div class="flex items-start gap-3">
			<StoryRing pubkey={me.pk} interactive={false}>
				<Avatar pubkey={me.pk} name={displayName} picture={myProfile?.picture} size={40} />
			</StoryRing>
			<div class="min-w-0 flex-1">
				<Textarea
					id="composer-input"
					bind:value={text}
					autoGrow
					rows={2}
					placeholder="What's happening on Nostr?"
					onkeydown={onKey}
					maxlength={HARD_LIMIT + 1000}
					class="min-h-[64px] rounded-xl border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-4 py-3"
				/>
				{#if overSoftLimit}
					<p
						class="mt-2 text-[11.5px] {overHardLimit
							? 'text-[var(--tone-error-text)]'
							: 'text-warm-500'}"
					>
						{#if overHardLimit}
							This is too long for a normal note. Shorten it or use a long-form article later.
						{:else}
							Long note. Most relays should accept it, but shorter posts render better in feeds.
						{/if}
					</p>
				{/if}

				<!-- Attachment previews -->
				{#if attachments.length}
					<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
						{#each attachments as a, i (a.url)}
							<div
								class="group relative overflow-hidden rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]"
							>
								{#if a.kind === 'image'}
									<img src={a.url} alt="attachment" class="aspect-square w-full object-cover" />
								{:else if a.kind === 'video'}
									<video src={a.url} class="aspect-square w-full object-cover" muted></video>
								{:else}
									<div class="grid aspect-square place-items-center p-2 text-center">
										<div>
											<Icon
												name="i-lucide-file"
												class="mx-auto size-6 text-[var(--ui-text-dimmed)]"
											/>
											<p class="mt-1 text-[10px] break-all text-[var(--ui-text-muted)]">
												{humanBytes(a.bytes)}
											</p>
										</div>
									</div>
								{/if}
								<button
									type="button"
									onclick={() => removeAttachment(i)}
									class="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100 hover:bg-black/80"
									aria-label="Remove attachment"
								>
									<Icon name="i-lucide-x" class="size-3.5" />
								</button>
								<span
									class="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white uppercase"
								>
									{providerLabel(a.provider)}
								</span>
							</div>
						{/each}
					</div>
				{/if}
				{#if uploading}
					<p class="mt-2 flex items-center gap-1.5 text-[11.5px] text-primary-500">
						<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
						Uploading via {providerLabel(selectedProvider === 'none' ? 'server' : selectedProvider)}…
					</p>
				{/if}
			</div>
		</div>

		<!-- Hidden file pickers -->
		<input
			bind:this={imageInput}
			type="file"
			accept="image/*"
			multiple
			class="hidden"
			onchange={onImageInput}
		/>
		<input
			bind:this={videoInput}
			type="file"
			accept="video/*"
			multiple
			class="hidden"
			onchange={onImageInput}
		/>

		<div
			class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ui-border-muted)] pt-3"
		>
			<div class="flex flex-wrap items-center gap-1">
				{#each attachActions as a (a.label)}
					<button
						type="button"
						onclick={a.pick}
						disabled={uploading}
						title={`Upload via ${providerLabel(selectedProvider === 'none' ? 'server' : selectedProvider)}`}
						class="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-primary-500/5 disabled:pointer-events-none disabled:opacity-40"
					>
						<Icon
							name={uploading ? 'i-lucide-loader-circle' : a.icon}
							class="size-4 {a.color} {uploading ? 'animate-spin' : ''}"
						/>
						<span class="hidden sm:inline">{a.label}</span>
					</button>
				{/each}
				{#each stubActions as a (a.label)}
					<button
						type="button"
						onclick={a.onClick ?? (() => toasts.info(a.toast))}
						class="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-primary-500/5"
					>
						<Icon name={a.icon} class="size-4 {a.color}" />
						<span class="hidden sm:inline">{a.label}</span>
					</button>
				{/each}
			</div>

			<div class="flex flex-wrap items-center justify-end gap-2">
				<label
					class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-primary-500/5"
				>
					<input
						bind:checked={sensitive}
						type="checkbox"
						class="size-4 rounded border border-[var(--ui-border)] accent-primary-500"
					/>
					<span>Sensitive content</span>
				</label>
				<!-- Provider selector -->
				<label class="flex items-center gap-1.5 text-[11.5px] text-[var(--ui-text-muted)]">
					<Icon name="i-lucide-cloud-upload" class="size-3.5" />
					<select
						value={selectedProvider}
						onchange={(e) => (selectedProvider = e.currentTarget.value as MediaProviderId | 'none')}
						class="max-w-[140px] rounded-lg bg-[var(--ui-bg-muted)] px-2 py-1.5 text-[12px] font-semibold outline-none"
					>
						<option value="none">BitOS uploads</option>
						{#each configuredProviders as p (p.id)}
							<option value={p.id}>{p.label}</option>
						{/each}
					</select>
				</label>

				{#if text.length > 0}
					<span
						class="text-[11.5px] font-medium tabular-nums {overHardLimit
							? 'text-[var(--tone-error-text)]'
							: overSoftLimit
								? 'text-warm-500'
								: 'text-[var(--ui-text-dimmed)]'}">{countLabel}</span
					>
				{/if}
				<button
					type="button"
					onclick={submit}
					disabled={!canPost}
					class="flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
				>
					<Icon
						name={posting ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
						class="size-4 {posting ? 'animate-spin' : ''}"
					/>
					{posting ? 'Posting…' : 'Post'}
				</button>
			</div>
		</div>
	</div>
{/if}

<PollComposer bind:open={pollOpen} />
