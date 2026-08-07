<script lang="ts">
	const lastUpdated = 'August 8, 2026';
</script>

<svelte:head><title>Privacy Policy · BitOS</title></svelte:head>

<h1 class="font-display text-[30px] font-extrabold tracking-tight sm:text-[34px]">Privacy Policy</h1>
<p class="mt-2 text-[13px] text-[var(--ui-text-dimmed)]">Last updated: {lastUpdated}</p>

<p class="mt-6 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS is a <strong class="text-[var(--ui-text)]">local-first client</strong> for the open
	<strong class="text-[var(--ui-text)]">Nostr</strong> protocol. This policy explains what data BitOS
	stores, what data is published to the network, and where third-party services are involved.
</p>

<div class="mt-5 rounded-2xl bg-[var(--ui-bg-muted)] p-4 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
	<p><strong class="text-[var(--ui-text)]">Short version:</strong> BitOS does not run a central backend, does not require a traditional account, and does not include trackers.</p>
	<p class="mt-2">
		Your private key and local app data stay on your device unless you choose to publish content or use
		third-party services such as relays, media hosts, or wallets.
	</p>
</div>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">1. BitOS is software, not a hosted network</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS runs in your browser and connects to the Nostr protocol. It does not operate the relays your
	content travels through, the media providers you may use, or the wallets you may connect. Those third
	parties may collect or process data under their own policies.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">2. Your identity and keys</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	Your BitOS identity is a Nostr keypair. Your private key (your <code class="font-mono">nsec</code>)
	is generated or imported locally and stored in this device’s browser storage.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS does not send your private key to a BitOS server because BitOS does not run one for account
	storage. BitOS cannot recover your key if it is lost.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">3. Data stored on your device</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS stores app data locally in your browser. Depending on how you use the app, this may include your
	private key, profile data, preferences, relay settings, bookmarks, drafts, cached notes, cached direct
	messages, media metadata, and other app state needed to make the client work.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	Clearing your browser storage may remove this local data from your device, but it will not remove data
	that has already been published to relays or uploaded to third-party media hosts.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">4. What gets published to relays</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	When you post, react, reply, edit your profile, follow someone, send a direct message, or publish other
	Nostr events, BitOS signs those events with your key and sends them to the relays you have configured.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	Most Nostr events are public and may be copied, indexed, cached, and re-broadcast by relays, clients,
	and other third parties. In practice, public network activity should be treated as widely visible and
	potentially permanent.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">5. Direct messages</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	Direct messages are encrypted on your device before publication. The encrypted payload may pass through
	relays, but relay operators can still observe some metadata, such as timing, sender, recipient, relay
	usage patterns, and message volume depending on the protocol and relay behavior.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">6. Media uploads</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS does not permanently host your media. When you upload images or video, the files are sent to a
	media provider that you configure or use, such as a self-hosted service, a NIP-96-compatible server,
	or another third-party host.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	That provider may collect file contents, IP address information, access logs, and related metadata
	under its own privacy policy and retention rules.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">7. Relays</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	Relays are independent servers run by third parties. They receive the events you publish, may store
	them, and may send you events published by others. Each relay may maintain logs, moderation rules,
	retention practices, access controls, and jurisdiction-specific policies of its own.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">8. Analytics and tracking</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS does not include advertising, analytics, telemetry, or third-party tracking scripts by default.
	It does not operate a backend that profiles users or sells personal data.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">9. Lightning payments and wallets</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	If you send or receive Zaps, payment processing is handled by your wallet and Lightning-related
	providers, not by BitOS. Those tools may process payment metadata, invoices, wallet identifiers, and
	network information under their own policies.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">10. Children</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS is not directed to children under 13. If local law sets a higher minimum age, that higher age
	should apply.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">11. Your choices</h2>
<ul class="mt-2.5 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	<li>Stop using BitOS at any time.</li>
	<li>Clear your browser storage to remove local app data from your device.</li>
	<li>Add, remove, or change relays in Settings.</li>
	<li>Choose which media providers and wallet tools you use.</li>
	<li>Publish a Nostr deletion request where supported, understanding that relays and other clients may ignore it.</li>
</ul>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">12. Changes to this policy</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	We may update this Privacy Policy from time to time. Changes will be reflected on this page with an
	updated “Last updated” date. Continued use of BitOS after an update means you accept the revised
	policy.
</p>

<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">13. Contact</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS is an open-source project. For questions about this policy, visit the
	<a
		href="https://github.com/bitoslabs/bitos-svelte"
		target="_blank"
		rel="noreferrer"
		class="font-semibold text-primary-500 hover:underline">GitHub repository</a
	>.
</p>

<p class="mt-9 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-4 text-[12.5px] leading-relaxed text-[var(--ui-text-dimmed)]">
	This Privacy Policy is clearer and more production-ready product copy, but it is not legal advice. If
	you are launching commercially or need compliance with specific privacy laws, have counsel review it
	before publishing.
</p>

<p class="mt-8 text-[12.5px] text-[var(--ui-text-dimmed)]">
	See also:
	<a href="/terms" class="font-semibold text-primary-500 hover:underline">Terms of Service</a>
	·
	<a href="/about" class="font-semibold text-primary-500 hover:underline">About BitOS</a>
</p>
