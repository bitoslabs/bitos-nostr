<script lang="ts">
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import type { Person } from '$lib/components/premium/data';

	let {
		person,
		following = false,
		onFollow
	}: { person: Person; following?: boolean; onFollow?: (p: Person) => void } = $props();
</script>

<div class="premium-card p-4">
	<div class="flex items-start gap-3">
		<HexAvatar name={person.name} picture={person.picture} pubkey={person.npub} verified={person.verified} size={48} />
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span class="text-sm font-semibold">{person.name}</span>
			</div>
			<div class="font-mono text-[11px] text-[var(--ui-text-muted)]">{person.npub}</div>
		</div>
	</div>
	<p class="my-2.5 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">{person.bio}</p>
	<div class="flex items-center justify-between">
		<div class="font-mono text-[11px] text-[var(--ui-text-muted)]">
			{person.followers} followers · {person.mutuals} mutuals
		</div>
		<button
			type="button"
			disabled={following}
			onclick={() => onFollow?.(person)}
			class="glow-accent rounded-full bg-[var(--ui-color-primary-500)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ui-text-inverted)] transition-all disabled:opacity-50"
		>
			{following ? 'Following' : 'Follow'}
		</button>
	</div>
</div>
