<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { stories } from '$lib/nostr/stories.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { media, providerLabel } from '$lib/stores/media.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	let { open = $bindable(false), onposted = () => {} }: { open?: boolean; onposted?: () => void } =
		$props();

	let text = $state('');
	let imageUrl = $state<string | undefined>(undefined);
	let bgIndex = $state(0);
	let uploading = $state(false);
	let posting = $state(false);
	let imageInput = $state<HTMLInputElement | null>(null);

	// IG-style gradient backgrounds for text-only stories / notes.
	const backgrounds = [
		'linear-gradient(135deg, #2f95f6, #55d69a)',
		'linear-gradient(135deg, #ff755f, #ffb86b)',
		'linear-gradient(135deg, #8b5cf6, #ec4899)',
		'linear-gradient(135deg, #0f172a, #334155)',
		'linear-gradient(135deg, #f59e0b, #ef4444)',
		'linear-gradient(135deg, #10b981, #06b6d4)'
	];

	const me = $derived(identity.current);
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const myName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const canPost = $derived((text.trim() || imageUrl) && !posting);

	function reset() {
		text = '';
		imageUrl = undefined;
		bgIndex = 0;
		uploading = false;
		posting = false;
	}

	function close() {
		open = false;
		reset();
	}

	async function onImageChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const provider =
			media.state.defaultProvider !== 'none'
				? media.state.defaultProvider
				: media.configured[0]?.id;
		uploading = true;
		try {
			const result = await media.upload(file, provider, {
				pubkey: me?.pk,
				purpose: 'story'
			});
			imageUrl = result.url;
			toasts.success(`Uploaded via ${providerLabel(provider ?? 'server')}`);
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			uploading = false;
		}
	}

	async function post() {
		if (!canPost) return;
		posting = true;
		try {
			await stories.publish(text, imageUrl, imageUrl ? undefined : backgrounds[bgIndex]);
			toasts.success('Story posted · lasts 24h');
			onposted();
			close();
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			posting = false;
		}
	}

	const onKey = (e: KeyboardEvent) => {
		if (open && e.key === 'Escape') close();
	};
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			aria-label="Close"
			tabindex="-1"
			class="animate-fade absolute inset-0 bg-black/60 backdrop-blur-[3px]"
			onclick={close}
		></button>
		<div
			class="surface-card relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/30"
			role="dialog"
			aria-modal="true"
		>
			<header
				class="flex h-14 shrink-0 items-center justify-between border-b border-[var(--ui-border)] px-4"
			>
				<h2 class="text-[16px] font-bold tracking-tight">New story / note</h2>
				<button
					type="button"
					onclick={close}
					class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
					aria-label="Close"
				>
					<Icon name="i-lucide-x" class="size-4" />
				</button>
			</header>

			<!-- Preview -->
			<div class="flex justify-center bg-[var(--ui-bg-muted)] p-4">
				<div
					class="relative grid aspect-[9/16] h-[300px] max-h-[46vh] w-auto overflow-hidden rounded-xl shadow-inner ring-1 ring-black/10"
					style={`background:${imageUrl ? '#000' : backgrounds[bgIndex]}`}
				>
					{#if imageUrl}
						<img src={imageUrl} alt="story preview" class="size-full object-cover" />
						{#if text.trim()}
							<div
								class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3"
							>
								<p class="text-[15px] font-semibold break-words whitespace-pre-wrap text-white">
									{text}
								</p>
							</div>
						{/if}
					{:else}
						<div class="flex size-full items-center justify-center p-5">
							<p
								class="max-h-full overflow-auto text-center text-[20px] leading-snug font-extrabold break-words whitespace-pre-wrap text-white"
							>
								{text || 'Type a note…'}
							</p>
						</div>
					{/if}
				</div>
			</div>

			<div class="flex flex-col gap-4 p-4">
				<!-- Text -->
				<textarea
					bind:value={text}
					rows="2"
					maxlength="280"
					placeholder={imageUrl ? 'Add a caption…' : "What's on your mind?"}
					class="w-full resize-none rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-3 text-[14px] leading-relaxed transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-primary-500 focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/20"
				></textarea>

				<!-- Background swatches (only for text stories) -->
				{#if !imageUrl}
					<div class="flex justify-center">
						<div
							class="flex [scrollbar-width:none] items-center gap-2 overflow-x-auto rounded-full bg-[var(--ui-bg-muted)] p-1.5 [&::-webkit-scrollbar]:hidden"
						>
							{#each backgrounds as bg, i (bg)}
								<button
									type="button"
									onclick={() => (bgIndex = i)}
									class="size-7 shrink-0 rounded-full border border-white/30 ring-offset-2 ring-offset-[var(--surface-bg)] transition hover:scale-105 {bgIndex ===
									i
										? 'ring-2 ring-primary-500'
										: ''}"
									style={`background:${bg}`}
									aria-label={`Use background ${i + 1}`}
								></button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Image attachment -->
				<div class="flex items-center gap-2">
					<input
						bind:this={imageInput}
						type="file"
						accept="image/*"
						class="hidden"
						onchange={onImageChosen}
					/>
					<Button
						color="neutral"
						variant="subtle"
						icon={uploading ? 'i-lucide-loader-circle' : 'i-lucide-image'}
						onclick={() => imageInput?.click()}
						disabled={uploading || posting}
						size="sm"
					>
						{uploading ? 'Uploading…' : imageUrl ? 'Replace image' : 'Add image'}
					</Button>
					{#if imageUrl}
						<Button
							color="error"
							variant="ghost"
							icon="i-lucide-trash-2"
							onclick={() => (imageUrl = undefined)}
							size="sm">Remove</Button
						>
					{:else}
						<span class="text-[11px] text-[var(--ui-text-dimmed)]">
							Uses BitOS uploads if you do not configure Cloudinary or S3
						</span>
					{/if}
				</div>

				<Button
					color="primary"
					block
					icon={posting ? 'i-lucide-loader-circle' : 'i-lucide-send'}
					onclick={post}
					disabled={!canPost}
				>
					{posting ? 'Posting…' : 'Post · 24h'}
				</Button>
				<p class="text-center text-[11px] text-[var(--ui-text-dimmed)]">
					Posted as @{myName} · disappears in 24 hours
				</p>
			</div>
		</div>
	</div>
{/if}
