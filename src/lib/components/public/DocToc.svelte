<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import HexMark from '$lib/components/ui/HexMark.svelte';
	import { BOLT_PATH } from '$lib/brand';

	/**
	 * Auto-generated "On this page" table of contents for long public docs
	 * (Privacy / Terms). Scans `article[data-doc]` for `h2[id]` headings and
	 * tracks scroll position to highlight the section in view.
	 *
	 * - default: sidebar list (sticky positioning is owned by the parent).
	 * - `collapsible`: a compact `<details>` dropdown for mobile views.
	 */
	let { collapsible = false, label = 'On this page' }: { collapsible?: boolean; label?: string } =
		$props();

	interface Heading {
		id: string;
		text: string;
	}

	let headings = $state<Heading[]>([]);
	let activeId = $state('');

	function findArticle(): HTMLElement | null {
		return document.querySelector<HTMLElement>('article[data-doc]');
	}

	function headingOffset(el: HTMLElement) {
		return el.getBoundingClientRect().top + window.scrollY;
	}

	/** Compute the in-view section from a list (NOT the `headings` state —
	 * reading it inside the effect below would create a circular dep). */
	function computeActive(list: Heading[]): string {
		const threshold = window.scrollY + 110;
		let current = list[0]?.id ?? '';
		for (const heading of list) {
			const el = document.getElementById(heading.id);
			if (el && headingOffset(el) <= threshold) current = heading.id;
		}
		return current;
	}

	function jump(event: MouseEvent, id: string) {
		event.preventDefault();
		activeId = id;
		const el = document.getElementById(id);
		if (!el) return;
		const top = el.getBoundingClientRect().top + window.scrollY - 88;
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
		history.replaceState(null, '', `#${id}`);
	}

	// Re-scan on every route change. This component lives in PublicShell,
	// which stays mounted across client-side navigations (privacy → terms →
	// about), so a one-shot onMount would keep the previous page's headings.
	// The effect only *reads* page.url.pathname; writes to headings/activeId
	// are un-read, and computeActive takes the list as a parameter so the
	// effect never tracks the state it writes.
	$effect(() => {
		void page.url.pathname;

		const list = findArticle()
			? Array.from(document.querySelectorAll<HTMLHeadingElement>('article[data-doc] h2[id]')).map(
					(h) => ({ id: h.id, text: h.textContent?.replace(/\s+/g, ' ').trim() ?? '' })
				)
			: [];
		headings = list;
		if (!list.length) {
			activeId = '';
			return;
		}
		activeId = computeActive(list);

		const update = () => (activeId = computeActive(list));
		window.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', update);
		return () => {
			window.removeEventListener('scroll', update);
			window.removeEventListener('resize', update);
		};
	});
</script>

{#if headings.length}
	<!-- Hex cell marker — the boot-splash "charged cell" language: an inert
	     outline hex per section; the active one fills with the brand gradient
	     and carries the white bolt (the BitOS hex system design). -->
	{#snippet cell(active: boolean)}
		<span
			class="hex-clip mt-px grid size-3.5 shrink-0 scale-100 place-items-center border transition duration-200 {active
				? 'scale-110 border-transparent bg-[linear-gradient(135deg,#FFB51B,#F7931A)] shadow-[0_1px_6px_rgb(247_147_26_/_0.4)]'
				: 'border-[var(--ui-border-muted)] bg-[var(--surface-bg)]'}"
			aria-hidden="true"
		>
			{#if active}
				<svg viewBox="0 0 664 297" width="8" class="relative">
					<path d={BOLT_PATH} fill="#fff" fill-rule="evenodd" />
				</svg>
			{/if}
		</span>
	{/snippet}
	{#if collapsible}
		<details
			class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] lg:hidden"
		>
			<summary
				class="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[13px] font-bold text-[var(--ui-text)] select-none"
			>
				<span class="inline-flex items-center gap-2">
					<HexMark size={16} />
					{label}
				</span>
				<Icon name="i-lucide-chevron-down" class="size-4 text-[var(--ui-text-dimmed)]" />
			</summary>
			<ul class="border-t border-[var(--ui-border-muted)] px-4 py-2.5">
				{#each headings as heading (heading.id)}
					<li>
						<a
							href="#{heading.id}"
							onclick={(event) => jump(event, heading.id)}
							class="flex items-start gap-2.5 py-1.5 pr-2 text-[12.5px] transition {activeId ===
							heading.id
								? 'font-semibold text-primary-500'
								: 'font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							{@render cell(activeId === heading.id)}
							<span>{heading.text}</span>
						</a>
					</li>
				{/each}
			</ul>
		</details>
	{:else}
		<nav aria-label={label} class="hidden lg:block">
			<p class="text-[10.5px] font-bold tracking-[0.14em] text-[var(--ui-text-dimmed)] uppercase">
				{label}
			</p>
			<ul class="mt-3 space-y-0.5">
				{#each headings as heading (heading.id)}
					<li>
						<a
							href="#{heading.id}"
							onclick={(event) => jump(event, heading.id)}
							class="flex items-start gap-2.5 py-1.5 pr-2 text-[12.5px] leading-snug transition {activeId ===
							heading.id
								? 'font-semibold text-primary-500'
								: 'font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							{@render cell(activeId === heading.id)}
							<span>{heading.text}</span>
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
{/if}
