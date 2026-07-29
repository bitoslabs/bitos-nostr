/**
 * Icon registry — registers the full Lucide collection offline (from
 * @iconify-json/lucide) so every `lucide:foo` / `i-lucide-foo` name resolves
 * with no network request and works with SSR. Pattern ported from
 * school-erp-svelte.
 */
import { addCollection, addIcon } from '@iconify/svelte';
import lucide from '@iconify-json/lucide/icons.json';

let registered = false;
export function registerIcons() {
	if (registered) return;
	addCollection(lucide);
	addIcon('solar:heart-bold', {
		width: 24,
		height: 24,
		body: '<path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>'
	});
	addIcon('solar:heart-linear', {
		width: 24,
		height: 24,
		body: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 20.5s-7.5-4.55-9.45-9.05C1.1 8.1 3.08 4.5 6.62 4.5c2 0 3.42 1.08 4.28 2.25.44.6 1.76.6 2.2 0 .86-1.17 2.28-2.25 4.28-2.25 3.54 0 5.52 3.6 4.07 6.95C19.5 15.95 12 20.5 12 20.5z"/>'
	});
	registered = true;
}

/** `i-lucide-foo` → `lucide:foo`; iconify names pass through. */
export function toIconify(name: string): string {
	if (!name) return '';
	if (name.includes(':')) return name;
	if (name.startsWith('i-lucide-')) return 'lucide:' + name.slice('i-lucide-'.length);
	if (name.startsWith('i-solar-')) return 'solar:' + name.slice('i-solar-'.length);
	if (name.startsWith('i-mdi-')) return 'mdi:' + name.slice('i-mdi-'.length);
	return name;
}
