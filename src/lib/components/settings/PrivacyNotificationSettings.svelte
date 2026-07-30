<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { SettingsSectionKey } from '$lib/settings/sections';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';

	type Props = {
		section: Extract<SettingsSectionKey, 'privacy' | 'notifications'>;
	};

	let { section }: Props = $props();

	const privacyItems = [
		['privateAcc', 'Private account', 'Only approved followers can see your posts'],
		['activity', 'Activity status', "Show when you're active"],
		['readReceipts', 'Read receipts', 'Let others know you saw their messages']
	] as const;

	const notificationItems = [
		[
			'likes',
			'i-lucide-heart',
			'text-primary-500',
			'Likes and reactions',
			'When someone likes your post'
		],
		[
			'comments',
			'i-lucide-message-circle',
			'text-accent-500',
			'Comments',
			'When someone comments on your post'
		],
		[
			'followers',
			'i-lucide-user-plus',
			'text-warm-500',
			'New followers',
			'When you get a new follower'
		],
		['dms', 'i-lucide-send', 'text-primary-500', 'Direct messages', 'When you receive a message'],
		['mentions', 'i-lucide-at-sign', 'text-accent-500', 'Mentions', 'When someone mentions you']
	] as const;
</script>

{#if section === 'privacy'}
	<h2 class="mb-1 font-display text-[24px] font-extrabold">Privacy</h2>
	<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
		Control who can see and interact with your content
	</p>
	<div class="post-card mb-5 p-5">
		<h3 class="mb-4 text-[15px] font-bold">Account privacy</h3>
		<div class="space-y-3">
			{#each privacyItems as [k, title, desc] (k)}
				<div
					class="flex items-center justify-between {k !== 'privateAcc'
						? 'border-t border-[var(--ui-border-muted)] pt-3'
						: ''}"
				>
					<div>
						<p class="text-[13.5px] font-semibold">{title}</p>
						<p class="text-[11px] text-[var(--ui-text-muted)]">{desc}</p>
					</div>
					<button
						type="button"
						class="toggle {privacyNotificationSettings.state[k] ? 'on' : ''}"
						aria-label={title}
						aria-pressed={privacyNotificationSettings.state[k]}
						onclick={() => privacyNotificationSettings.toggle(k)}
					></button>
				</div>
			{/each}
		</div>
	</div>
	<div class="post-card p-5">
		<h3 class="mb-4 text-[15px] font-bold">Interactions</h3>
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-[13.5px] font-semibold">Who can message you</p>
					<p class="text-[11px] text-[var(--ui-text-muted)]">Everyone, followers, or no one</p>
				</div>
				<select
					class="rounded-lg bg-[var(--ui-bg-muted)] px-3 py-1.5 text-[12px] font-semibold outline-none"
					><option>Followers</option><option>Everyone</option><option>No one</option></select
				>
			</div>
			<div class="flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-3">
				<div>
					<p class="text-[13.5px] font-semibold">Who can comment on posts</p>
					<p class="text-[11px] text-[var(--ui-text-muted)]">Control who can leave comments</p>
				</div>
				<select
					class="rounded-lg bg-[var(--ui-bg-muted)] px-3 py-1.5 text-[12px] font-semibold outline-none"
					><option>Everyone</option><option>Followers</option><option>Friends</option></select
				>
			</div>
			<div class="flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-3">
				<div>
					<p class="text-[13.5px] font-semibold">Story sharing</p>
					<p class="text-[11px] text-[var(--ui-text-muted)]">Allow others to share your stories</p>
				</div>
				<button
					type="button"
					class="toggle {privacyNotificationSettings.state.storyShare ? 'on' : ''}"
					aria-label="Story sharing"
					aria-pressed={privacyNotificationSettings.state.storyShare}
					onclick={() => privacyNotificationSettings.toggle('storyShare')}
				></button>
			</div>
		</div>
	</div>
{/if}

{#if section === 'notifications'}
	<h2 class="mb-1 font-display text-[24px] font-extrabold">Notifications</h2>
	<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
		Choose what you want to be notified about
	</p>
	<div class="post-card mb-5 p-5">
		<h3 class="mb-4 text-[15px] font-bold">Push notifications</h3>
		<div class="space-y-3">
			{#each notificationItems as [k, ic, col, title, desc] (k)}
				<div
					class="flex items-center justify-between {k !== 'likes'
						? 'border-t border-[var(--ui-border-muted)] pt-3'
						: ''}"
				>
					<div class="flex items-center gap-3">
						<div class="grid size-9 place-items-center rounded-xl bg-current/10">
							<Icon name={ic} class="size-4 {col}" />
						</div>
						<div>
							<p class="text-[13.5px] font-semibold">{title}</p>
							<p class="text-[11px] text-[var(--ui-text-muted)]">{desc}</p>
						</div>
					</div>
					<button
						type="button"
						class="toggle {privacyNotificationSettings.state[k] ? 'on' : ''}"
						aria-label={title}
						aria-pressed={privacyNotificationSettings.state[k]}
						onclick={() => privacyNotificationSettings.toggle(k)}
					></button>
				</div>
			{/each}
		</div>
	</div>
{/if}
