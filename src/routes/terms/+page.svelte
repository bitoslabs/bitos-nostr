<script lang="ts">
	import PublicShell from '$lib/components/PublicShell.svelte';

	const lastUpdated = 'August 2025';
</script>

<svelte:head><title>Terms of Service · BitOS</title></svelte:head>

<PublicShell>
	<h1 class="font-display text-[30px] font-extrabold tracking-tight sm:text-[34px]">Terms of Service</h1>
	<p class="mt-2 text-[13px] text-[var(--ui-text-dimmed)]">Last updated: {lastUpdated}</p>

	<p class="mt-6 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		These Terms govern your use of <strong class="text-[var(--ui-text)]">BitOS</strong>, an open-source
		client for the <strong class="text-[var(--ui-text)]">Nostr</strong> protocol. By opening BitOS and
		publishing any event, you agree to these Terms. If you do not agree, do not use BitOS.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">1. What BitOS is</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS is free, open-source software that runs in your browser and interacts with the decentralized
		Nostr network. It is provided “as is”, without a central server or service provider. BitOS does not
		host, store, or control the notes, media, or messages you publish — those are handled by relays and
		media providers that you choose.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">2. Your account &amp; keys</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		There are no BitOS accounts. Your identity is a Nostr keypair that you generate and control. You are
		solely responsible for keeping your private key (<code class="font-mono">nsec</code>) secure and
		backed up. BitOS cannot recover a lost or compromised key, and is not liable for any access gained
		through a key you failed to protect.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">3. Your content &amp; conduct</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		You are solely responsible for the content you publish and for your activity on the network. You
		agree not to use BitOS to:
	</p>
	<ul class="mt-2.5 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		<li>Violate any applicable law or regulation, or the rights of others.</li>
		<li>
			Publish content that is unlawful, defamatory, harassing, threatening, or that infringes
			intellectual property.
		</li>
		<li>Distribute malware, spam, or conduct coordinated inauthentic behavior.</li>
		<li>Attempt to disrupt, overload, or gain unauthorized access to relays or any third-party system.</li>
	</ul>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		Because Nostr is open and decentralized, BitOS cannot remove content from the network. Removal is
		governed by the policies of individual relays and other clients.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">4. Third-party services</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS connects to relays and media providers operated by third parties. Their separate terms,
		policies, availability, and fees apply. BitOS is not responsible for the actions, uptime, or
		content of any relay or media provider, including any Lightning wallet or service you use for Zaps.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">5. No warranty</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		BitOS is provided “as is” and “as available”, without warranties of any kind, express or implied,
		including merchantability, fitness for a particular purpose, or non-infringement. We do not warrant
		that the software will be uninterrupted, error-free, secure, or that any relay will persist or
		deliver your data.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">6. Limitation of liability</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		To the maximum extent permitted by law, BitOS and its contributors shall not be liable for any
		indirect, incidental, special, consequential, or punitive damages, or any loss of data, followers,
		funds, or profits, arising out of or related to your use of — or inability to use — the software,
		even if advised of the possibility of such damages.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">7. Intellectual property</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		You retain all rights to the content you create. By publishing, you grant relays and other Nostr
		participants the technical permission necessary to receive, store, and re-broadcast your signed
		events as the protocol requires. The BitOS source code is licensed under the terms stated in its
		repository.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">8. Termination</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		You may stop using BitOS at any time and clear your local data. Because the network is
		decentralized, “deletion” of published content depends on relays and other clients honoring a
		deletion request, which BitOS cannot guarantee.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">9. Changes to these Terms</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		We may update these Terms from time to time. Changes take effect when posted with an updated “Last
		updated” date. Your continued use of BitOS after a change constitutes acceptance of the revised
		Terms.
	</p>

	<h2 class="mt-9 font-display text-[17px] font-bold tracking-tight">10. Contact</h2>
	<p class="mt-2.5 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		These Terms are provided by an open-source project. For questions or to report issues, visit the
		<a
			href="https://github.com/bitoslabs/bitos-svelte"
			target="_blank"
			rel="noreferrer"
			class="font-semibold text-primary-500 hover:underline">GitHub repository</a
		>.
	</p>

	<p class="mt-8 text-[12.5px] text-[var(--ui-text-dimmed)]">
		See also:
		<a href="/privacy" class="font-semibold text-primary-500 hover:underline">Privacy Policy</a>
		·
		<a href="/about" class="font-semibold text-primary-500 hover:underline">About BitOS</a>
	</p>
</PublicShell>
