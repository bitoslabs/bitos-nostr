/**
 * Icon registry — registers the full Lucide collection offline (from
 * @iconify-json/lucide) so every `lucide:foo` / `i-lucide-foo` name resolves
 * with no network request and works with SSR. Pattern ported from
 * school-erp-svelte.
 */
import { addCollection } from '@iconify/svelte';
import lucide from '@iconify-json/lucide/icons.json';

let registered = false;
export function registerIcons() {
	if (registered) return;
	addCollection(lucide);
	registered = true;
}

/** `i-lucide-foo` → `lucide:foo`; iconify names pass through. */
export function toIconify(name: string): string {
	if (!name) return '';
	if (name.includes(':')) return name;
	if (name.startsWith('i-lucide-')) return 'lucide:' + name.slice('i-lucide-'.length);
	if (name.startsWith('i-mdi-')) return 'mdi:' + name.slice('i-mdi-'.length);
	return name;
}
