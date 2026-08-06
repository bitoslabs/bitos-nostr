<script lang="ts">
	import PublicShell from '$lib/components/PublicShell.svelte';

	const lastUpdated = 'August 2025';
</script>

<svelte:head><title>Privacy Policy · BitOS</title></svelte:head>

<PublicShell>
	<h1 class="font-display text-[30px] font-extrabold tracking-tight sm:text-[34px]">Privacy Policy</h1>
	<p class="mt-2 text-[13px] text-[var(--ui-text-dimmed)]">Last updated: {lastUpdated}</p>

	<p class="mt-6 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS (“we”, “us”) is a <strong class="text-[var(--ui-text)]">local-first client</strong> for the
		open <strong class="text-[var(--ui-text)]">Nostr</strong> protocol. This policy explains what
		information exists, where it lives, and who can see it. The short version: BitOS does not run a
		central server, does not require an account, and does not include trackers. Your private key and
		your data stay on your device unless you choose to publish.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">1. BitOS is an interface, not a service provider</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS is software that runs in your browser and speaks the Nostr protocol. It does not operate the
		relays your notes travel through, nor the media providers you may configure. Where relevant, this
		policy notes when a third party (a relay or media host) applies its own rules.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">2. Your identity &amp; keys</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		Your BitOS identity is a Nostr keypair. The private key (your <code class="font-mono">nsec</code>)
		is generated locally and stored only in this device’s browser storage. It never leaves the device
		except when you explicitly sign an event that is then published to relays. BitOS has no copy of
		your private key and cannot recover it — if you lose it, you lose access to that identity.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">3. Data stored on your device</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		The following are stored locally in your browser: your private key, the notes and direct messages
		you read, your profile, preferences, drafts, bookmarks, and caches. This data never leaves your
		device unless you publish it. Clearing your browser storage removes it.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">4. What gets published to relays</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		When you post a note, react, reply, update your profile, send a direct message, or publish a story,
		BitOS signs that event with your key and sends it to the relays you have configured. Published
		events are public on the Nostr network and may be stored and re-broadcast by any relay or
		third-party client. Assume anything you publish is permanent and publicly readable.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">5. Direct messages</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		Direct messages are end-to-end encrypted on your device using NIP-04 before they are published. The
		ciphertext passes through relays, but only you and the intended recipient can decrypt it. Metadata
		(who you message, and when) is not hidden by NIP-04.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">6. Media (images &amp; video)</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS does not host media. When you attach an image or video, it is uploaded to a provider you
		choose and configure — for example a self-hosted server, a NIP-96 blossom server, or a third-party
		service such as Cloudinary. That provider, not BitOS, stores your media and applies its own privacy
		policy and retention rules.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">7. Relays</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		Relays are independent servers run by third parties. They receive, store, and re-broadcast the
		Nostr events you publish, and deliver events from others to you. Each relay has its own terms,
		privacy practices, and data retention. BitOS lets you add, remove, and choose read/write relays at
		any time.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">8. Analytics &amp; tracking</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS does not include advertising, analytics, telemetry, or third-party trackers. It does not set
		tracking cookies or sell data, because it has no backend to collect it.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">9. Lightning payments (Zaps)</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		If you send or receive Zaps, the Lightning payment is processed by Lightning service providers and
		your wallet, not by BitOS. Standard Lightning Network privacy applies to those payments.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">10. Children</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS is not directed to children under 13. Do not use BitOS if you are under 13, and do not
		publish information about a child.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">11. Your choices</h2>
	<ul class="mt-2.5 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		<li>Stop using BitOS at any time; clear your browser storage to remove local data.</li>
		<li>Add or remove relays, and toggle read/write for each, in Settings.</li>
		<li>
			Request deletion of an event by publishing a Nostr deletion request (NIP-09); note that relays
			and other clients may or may not honor it.
		</li>
	</ul>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">12. Changes to this policy</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		We may update this Privacy Policy from time to time. Material changes will be reflected by an
		updated “Last updated” date. Continued use of BitOS after a change constitutes acceptance.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">13. Contact</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS is an open-source project. For questions about this policy, open an issue on the
		<a
			href="https://github.com/bitoslabs/bitos-svelte"
			target="_blank"
			rel="noreferrer"
			class="font-semibold text-primary-500 hover:underline">GitHub repository</a
		>.
	</p>

	<p class="mt-8 text-[12.5px] text-[var(--ui-text-dimmed)]">
		See also:
		<a href="/terms" class="font-semibold text-primary-500 hover:underline">Terms of Service</a>
		·
		<a href="/about" class="font-semibold text-primary-500 hover:underline">About BitOS</a>
	</p>
</PublicShell>
