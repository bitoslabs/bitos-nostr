<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import SectionCard from '$lib/components/settings/SectionCard.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import { MEDIA_PROVIDERS, media, providerLabel } from '$lib/stores/media.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	let revealS3Secret = $state(false);
	let revealCldSecret = $state(false);
	let testingProvider = $state<MediaProviderId | null>(null);

	async function testUpload(id: MediaProviderId) {
		if (testingProvider) return;
		if (!media.isConfigured(id)) {
			toasts.error('Fill in the required fields first');
			return;
		}
		testingProvider = id;
		try {
			const blob = new Blob(['BitOS upload test\n'], { type: 'text/plain' });
			const file = new File([blob], 'bitos-test.txt', { type: 'text/plain' });
			const result = await media.upload(file, id, { purpose: 'test' });
			toasts.success(`Test upload OK via ${providerLabel(id)}`);
			void result;
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			testingProvider = null;
		}
	}
</script>

<h2 class="mb-1 font-display text-[24px] font-extrabold">Media & Uploads</h2>
<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
	Choose where photos and videos are hosted when you attach them to a note. If you leave these
	empty, BitOS can fall back to the server upload API when it is configured.
</p>

<SectionCard class="mb-5 border-primary-500/20 bg-primary-500/5" bodyClass="p-4">
	<div class="flex items-start gap-3">
		<Icon name="i-lucide-shield-check" class="mt-0.5 size-[18px] text-primary-500" />
		<div>
			<h3 class="text-[14px] font-bold">Upload privacy</h3>
			<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
				Supported images are rewritten in your browser before upload so EXIF data like GPS location
				is dropped. Uploads also use neutral filenames instead of the original file name. Video
				metadata is not fully stripped yet.
			</p>
		</div>
	</div>
</SectionCard>

<!-- Default provider -->
<SectionCard title="Default provider" icon="i-lucide-cloud-upload" class="mb-5">
	<p class="mb-3 text-[12px] text-[var(--ui-text-muted)]">
		Used by the composer unless you pick another one while posting. Selecting none keeps uploads on
		the BitOS server fallback path.
	</p>
	<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
		<button
			type="button"
			onclick={() => media.setDefaultProvider('none')}
			class="rounded-xl border p-3 text-left transition {media.state.defaultProvider === 'none'
				? 'border-primary-500 bg-primary-500/10 text-primary-500'
				: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
		>
			<p class="text-[13px] font-bold text-[var(--ui-text)]">None</p>
			<p class="mt-0.5 text-[11px]">Use BitOS server uploads</p>
		</button>
		{#each MEDIA_PROVIDERS as p (p.id)}
			<button
				type="button"
				onclick={() => media.setDefaultProvider(p.id)}
				class="rounded-xl border p-3 text-left transition {media.state.defaultProvider === p.id
					? 'border-primary-500 bg-primary-500/10 text-primary-500'
					: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
			>
				<div class="flex items-center gap-2">
					<Icon name={p.icon} class="size-4" />
					<p class="text-[13px] font-bold text-[var(--ui-text)]">{p.label}</p>
					{#if media.isConfigured(p.id)}
						<Badge tone="success" class="ml-auto">ready</Badge>
					{:else}
						<Badge tone="warning" class="ml-auto">setup</Badge>
					{/if}
				</div>
				<p class="mt-1 text-[11px]">{p.description}</p>
			</button>
		{/each}
	</div>
</SectionCard>

<!-- Cloudinary -->
<SectionCard title="Cloudinary" icon="i-lucide-cloud-sun" class="mb-5">
	{#snippet actions()}
		{#if media.isConfigured('cloudinary')}
			{#if media.state.cloudinary.apiKey?.trim() && media.state.cloudinary.apiSecret?.trim()}
				<Badge tone="primary">signed</Badge>
			{:else}<Badge tone="success">connected</Badge>{/if}
		{/if}
	{/snippet}
	<p class="mb-4 text-[12px] text-[var(--ui-text-muted)]">
		Two options: (1) an <strong>unsigned upload preset</strong> (safest — no secret in the browser),
		or (2) your <strong>API key + API secret</strong> for signed uploads with full control. Since BitOS
		keeps everything on this device, the secret never leaves it.
	</p>
	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label
				for="cld-cloud-name"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Cloud name</label
			>
			<Input
				id="cld-cloud-name"
				value={media.state.cloudinary.cloudName}
				oninput={(e) => media.updateCloudinary({ cloudName: e.currentTarget.value })}
				icon="i-lucide-cloud"
				placeholder="my-cloud"
				class="w-full"
			/>
		</div>
		<div>
			<label
				for="cld-preset"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Upload preset (optional)</label
			>
			<Input
				id="cld-preset"
				value={media.state.cloudinary.uploadPreset ?? ''}
				oninput={(e) => media.updateCloudinary({ uploadPreset: e.currentTarget.value })}
				icon="i-lucide-shield"
				placeholder="unsigned_preset"
				class="w-full"
			/>
		</div>
		<div>
			<label
				for="cld-api-key"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>API key (optional)</label
			>
			<Input
				id="cld-api-key"
				value={media.state.cloudinary.apiKey ?? ''}
				oninput={(e) => media.updateCloudinary({ apiKey: e.currentTarget.value })}
				icon="i-lucide-key-round"
				placeholder="123456789012345"
				autocomplete="off"
				class="w-full font-mono text-[11.5px]"
			/>
		</div>
		<div>
			<label
				for="cld-api-secret"
				class="mb-1.5 flex items-center justify-between text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
			>
				<span>API secret (optional)</span>
				<button
					type="button"
					onclick={() => (revealCldSecret = !revealCldSecret)}
					class="flex items-center gap-1 text-[11px] font-medium text-primary-500"
					><Icon
						name={revealCldSecret ? 'i-lucide-eye-off' : 'i-lucide-eye'}
						class="size-3.5"
					/>{revealCldSecret ? 'Hide' : 'Reveal'}</button
				>
			</label>
			<Input
				id="cld-api-secret"
				value={media.state.cloudinary.apiSecret ?? ''}
				oninput={(e) => media.updateCloudinary({ apiSecret: e.currentTarget.value })}
				icon="i-lucide-lock"
				type={revealCldSecret ? 'text' : 'password'}
				placeholder="••••••••"
				autocomplete="off"
				class="w-full font-mono text-[11.5px]"
			/>
		</div>
		<div class="sm:col-span-2">
			<label
				for="cld-folder"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Folder (optional)</label
			>
			<Input
				id="cld-folder"
				value={media.state.cloudinary.folder ?? ''}
				oninput={(e) => media.updateCloudinary({ folder: e.currentTarget.value })}
				icon="i-lucide-folder"
				placeholder="bitos"
				class="w-full"
			/>
		</div>
	</div>
	<div class="mt-5 flex gap-2 border-t border-[var(--ui-border-muted)] pt-5">
		<Button
			color="primary"
			variant="subtle"
			icon={testingProvider === 'cloudinary' ? 'i-lucide-loader-circle' : 'i-lucide-upload-cloud'}
			onclick={() => testUpload('cloudinary')}
			disabled={!!testingProvider}>Test upload</Button
		>
		<Button
			color="neutral"
			variant="ghost"
			onclick={() =>
				media.updateCloudinary({
					cloudName: '',
					uploadPreset: '',
					apiKey: '',
					apiSecret: '',
					folder: ''
				})}>Clear</Button
		>
	</div>
</SectionCard>

<!-- S3 / R2 -->
<SectionCard title="S3 / R2 / B2" icon="i-lucide-database" class="mb-5">
	{#snippet actions()}{#if media.isConfigured('s3')}<Badge tone="success">connected</Badge
			>{/if}{/snippet}
	<p class="mb-4 text-[12px] text-[var(--ui-text-muted)]">
		Works with AWS S3 and S3-compatible storage. Enable CORS on the bucket to allow PUT requests
		from this site. The secret key is stored locally on this device.
	</p>
	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label
				for="s3-bucket"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Bucket</label
			>
			<Input
				id="s3-bucket"
				value={media.state.s3.bucket}
				oninput={(e) => media.updateS3({ bucket: e.currentTarget.value })}
				icon="i-lucide-bucket"
				placeholder="my-bucket"
				class="w-full"
			/>
		</div>
		<div>
			<label
				for="s3-region"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Region</label
			>
			<Input
				id="s3-region"
				value={media.state.s3.region}
				oninput={(e) => media.updateS3({ region: e.currentTarget.value })}
				icon="i-lucide-globe"
				placeholder="us-east-1 / auto"
				class="w-full"
			/>
		</div>
		<div class="sm:col-span-2">
			<label
				for="s3-endpoint"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Endpoint (optional — R2 / MinIO)</label
			>
			<Input
				id="s3-endpoint"
				value={media.state.s3.endpoint ?? ''}
				oninput={(e) => media.updateS3({ endpoint: e.currentTarget.value })}
				icon="i-lucide-link"
				placeholder="https://<acct>.r2.cloudflarestorage.com"
				type="url"
				class="w-full"
			/>
		</div>
		<div>
			<label
				for="s3-access-key"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Access key</label
			>
			<Input
				id="s3-access-key"
				value={media.state.s3.accessKey}
				oninput={(e) => media.updateS3({ accessKey: e.currentTarget.value })}
				icon="i-lucide-key-round"
				placeholder="AKIA…"
				autocomplete="off"
				class="w-full font-mono text-[11.5px]"
			/>
		</div>
		<div>
			<label
				for="s3-secret"
				class="mb-1.5 flex items-center justify-between text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
			>
				<span>Secret key</span>
				<button
					type="button"
					onclick={() => (revealS3Secret = !revealS3Secret)}
					class="flex items-center gap-1 text-[11px] font-medium text-primary-500"
					><Icon
						name={revealS3Secret ? 'i-lucide-eye-off' : 'i-lucide-eye'}
						class="size-3.5"
					/>{revealS3Secret ? 'Hide' : 'Reveal'}</button
				>
			</label>
			<Input
				id="s3-secret"
				value={media.state.s3.secretKey}
				oninput={(e) => media.updateS3({ secretKey: e.currentTarget.value })}
				icon="i-lucide-lock"
				type={revealS3Secret ? 'text' : 'password'}
				placeholder="••••••••"
				autocomplete="off"
				class="w-full font-mono text-[11.5px]"
			/>
		</div>
		<div class="sm:col-span-2">
			<label
				for="s3-public"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Public URL base (optional — CDN)</label
			>
			<Input
				id="s3-public"
				value={media.state.s3.publicUrlBase ?? ''}
				oninput={(e) => media.updateS3({ publicUrlBase: e.currentTarget.value })}
				icon="i-lucide-globe"
				placeholder="https://cdn.example.com"
				type="url"
				class="w-full"
			/>
		</div>
		<div class="sm:col-span-2">
			<label
				for="s3-folder"
				class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
				>Folder prefix (optional)</label
			>
			<Input
				id="s3-folder"
				value={media.state.s3.folder ?? ''}
				oninput={(e) => media.updateS3({ folder: e.currentTarget.value })}
				icon="i-lucide-folder"
				placeholder="bitos"
				class="w-full"
			/>
		</div>
	</div>
	<div class="mt-5 flex gap-2 border-t border-[var(--ui-border-muted)] pt-5">
		<Button
			color="primary"
			variant="subtle"
			icon={testingProvider === 's3' ? 'i-lucide-loader-circle' : 'i-lucide-upload-cloud'}
			onclick={() => testUpload('s3')}
			disabled={!!testingProvider}>Test upload</Button
		>
		<Button
			color="neutral"
			variant="ghost"
			onclick={() =>
				media.updateS3({
					bucket: '',
					region: 'us-east-1',
					endpoint: '',
					accessKey: '',
					secretKey: '',
					publicUrlBase: '',
					folder: ''
				})}>Clear</Button
		>
	</div>
</SectionCard>

<SectionCard bodyClass="p-5">
	<div class="flex items-start gap-2.5">
		<Icon
			name="i-lucide-shield-alert"
			class="mt-px size-4 shrink-0 text-[var(--tone-warning-text)]"
		/>
		<div class="text-[12px] leading-relaxed text-[var(--ui-text-muted)]">
			<p>
				Credentials are stored only in this browser (localStorage), exactly like your Nostr private
				key. For S3, restrict the IAM key to a single bucket with write-only (or read+write)
				permissions.
			</p>
			<button
				type="button"
				onclick={() => {
					media.reset();
					toasts.success('Media settings cleared');
				}}
				class="mt-2 font-semibold text-[var(--tone-error-text)] hover:underline"
				>Erase all media credentials</button
			>
		</div>
	</div>
</SectionCard>
