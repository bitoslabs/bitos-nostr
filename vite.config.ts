import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import pkg from './package.json';

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version)
	},
	build: {
		rollupOptions: {
			output: {
				// Vendor split (rec #2): keep the big, cold-visit libraries out of
				// the app chunk so a first feed visit parses a small entry and
				// fetches heavy code in parallel, cached separately across deploys.
				manualChunks(id) {
					if (!id.includes('node_modules')) return undefined;
					// nostr crypto/NIP toolset — used app-wide but rarely hot.
					if (id.includes('nostr-tools') || id.includes('@noble') || id.includes('@scure')) {
						return 'vendor-nostr';
					}
					// Icon JSON + runtime: big data, loads once.
					if (id.includes('@iconify')) {
						return 'vendor-icons';
					}
					// QR rendering (profile/share sheets).
					if (id.includes('qrcode')) {
						return 'vendor-qr';
					}
					return undefined;
				}
			}
		}
	},
	server: {
		host: '127.0.0.1',
		port: 5173,
		allowedHosts: ['social.bitos.space', 'www.social.bitos.space']
	},
	preview: {
		host: '127.0.0.1',
		port: 5173,
		allowedHosts: ['social.bitos.space', 'www.social.bitos.space']
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
