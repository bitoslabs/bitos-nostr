<script lang="ts">
	import DocToc from '$lib/components/public/DocToc.svelte';

	const lastUpdated = 'August 8, 2026';
</script>

<svelte:head><title>Terms of Service · BitOS</title></svelte:head>

<h1 class="font-display text-[30px] font-extrabold tracking-tight sm:text-[34px]">
	Terms of Service
</h1>
<p class="mt-2 text-[13px] text-[var(--ui-text-dimmed)]">Last updated: {lastUpdated}</p>

<p class="mt-6 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	These Terms of Service govern your use of <strong class="text-[var(--ui-text)]">BitOS</strong>, an
	open-source client for the <strong class="text-[var(--ui-text)]">Nostr</strong> protocol. By using BitOS,
	you agree to these Terms. If you do not agree, do not use the app.
</p>

<div
	class="mt-5 rounded-2xl bg-[var(--ui-bg-muted)] p-4 text-[13px] leading-relaxed text-[var(--ui-text-muted)]"
>
	<p>
		<strong class="text-[var(--ui-text)]">Important:</strong> BitOS is software, not a hosted social network.
	</p>
	<p class="mt-2">
		Your keys are controlled by you, and your content is distributed through third-party relays and
		media providers that you choose.
	</p>
</div>

<!-- Jump-to-section nav for small screens (desktop uses the sticky sidebar). -->
<div class="mt-6">
	<DocToc collapsible />
</div>

<h2 id="what" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	1. What BitOS is
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS is free, open-source software that runs in your browser and connects to the decentralized
	Nostr network. BitOS does not operate a central social platform, custody your account, or
	guarantee delivery or storage of content.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	Content you publish may pass through relays, media hosts, wallet providers, and other third-party
	services. Those services are separate from BitOS and may have their own terms, fees, moderation
	policies, and retention practices.
</p>

<h2 id="keys" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	2. Your identity and keys
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	There are no BitOS accounts. Your identity is a Nostr keypair that you create and control. You are
	responsible for keeping your private key (<code class="font-mono">nsec</code>) secure, backed up,
	and private.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS cannot recover a lost key, reset access, reverse actions signed with your key, or protect
	you if your key is shared, stolen, or exposed.
</p>

<h2 id="conduct" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	3. Your content and conduct
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	You are responsible for the content you publish and for how you use BitOS. You agree not to use
	BitOS to:
</p>
<ul
	class="mt-2.5 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]"
>
	<li>Break the law or violate the rights of others.</li>
	<li>Publish unlawful, abusive, fraudulent, or infringing content.</li>
	<li>Send spam, malware, or deceptive or automated abuse.</li>
	<li>Interfere with relays, wallets, media hosts, or other third-party systems.</li>
</ul>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	Because Nostr is decentralized, BitOS cannot guarantee that content can be edited, removed,
	hidden, or fully deleted once it has been published to relays.
</p>

<h2 id="third-party" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	4. Third-party services
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS may connect you to relays, media providers, wallet software, Lightning services, and other
	third-party tools. Those services are not controlled by BitOS. Their own terms, privacy policies,
	availability, moderation, and fees apply.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS is not responsible for outages, data loss, content policies, payment issues, or security
	failures caused by third-party services.
</p>

<h2 id="warranty" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	5. Availability and no warranty
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS is provided “as is” and “as available,” without warranties of any kind, express or implied,
	including warranties of merchantability, fitness for a particular purpose, and non-infringement.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	We do not guarantee that BitOS will be uninterrupted, error-free, secure, compatible with every
	device, or that any relay or media host will store, deliver, or preserve your data.
</p>

<h2 id="liability" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	6. Limitation of liability
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	To the maximum extent permitted by law, BitOS and its contributors will not be liable for
	indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of data,
	content, followers, reputation, funds, profits, or access arising from or related to your use of
	BitOS.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	This includes losses caused by relay behavior, media hosts, wallet providers, key loss,
	compromised devices, or third-party infrastructure.
</p>

<h2 id="ip" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	7. Content and intellectual property
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	You keep whatever rights you have in the content you create. By publishing through Nostr, you
	authorize relays and other participants to receive, copy, store, index, and re-broadcast your
	signed events as required for the protocol to function.
</p>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	The BitOS source code is licensed under the terms published in its repository.
</p>

<h2 id="stopping" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	8. Stopping use
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	You may stop using BitOS at any time and clear local browser data from your device. Published
	Nostr events may remain available on relays, indexes, caches, or in other clients even after you
	stop using the app or publish a deletion request.
</p>

<h2 id="changes" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	9. Changes to these Terms
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	We may update these Terms from time to time. Changes take effect when posted on this page with an
	updated “Last updated” date. Continued use of BitOS after an update means you accept the revised
	Terms.
</p>

<h2 id="contact" class="mt-9 scroll-mt-24 font-display text-[17px] font-bold tracking-tight">
	10. Contact
</h2>
<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
	BitOS is an open-source project. For questions, bug reports, or policy feedback, visit the
	<a
		href="https://github.com/bitoslabs/bitos-nostr"
		target="_blank"
		rel="noreferrer"
		class="font-semibold text-primary-500 hover:underline">GitHub repository</a
	>.
</p>

<p
	class="mt-9 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-4 text-[12.5px] leading-relaxed text-[var(--ui-text-dimmed)]"
>
	These Terms are intended as product copy for a production app and are not legal advice. If you are
	launching commercially or operating in regulated jurisdictions, have counsel review them before
	publishing.
</p>

<p class="mt-8 text-[12.5px] text-[var(--ui-text-dimmed)]">
	See also:
	<a href="/privacy" class="font-semibold text-primary-500 hover:underline">Privacy Policy</a>
	·
	<a href="/about" class="font-semibold text-primary-500 hover:underline">About BitOS</a>
</p>
