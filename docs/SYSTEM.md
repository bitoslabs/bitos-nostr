# BitOS Web — System & Feature Reference

> Derived from the source code at **v0.6.3** (2026-08). This is the map of what
> actually exists in `src/` — routes, modules, protocol support, storage, and
> known dev-only code. When the code changes, update this file in the same PR.
> Companion docs: [`../README.md`](../README.md) (overview), 
> [`algorithm-plan.md`](algorithm-plan.md) (ranking design),
> [`client-tag-audit.md`](client-tag-audit.md) (audit script).

## 1. System model

BitOS is a **browser-only Nostr client**. There is no backend database and no
user server state:

- **Identity** — a local secp256k1 keypair (`lib/nostr/identity.svelte.ts`).
  Multi-account registry, generate/import, `localStorage` persistence.
- **Backend = relays** — all reads/writes fan out through `lib/nostr/pool.ts`
  (a `SimplePool` singleton) over the user's relay list (NIP-65 aware,
  read/write/primary flags).
- **Signed Nostr events are canonical** — anything cached locally
  (localStorage, IndexedDB) or proxied server-side is a derived projection.
- **Server endpoints are stateless helpers** — media upload fallback, media
  proxy, icon search (§6).

The root layout (`src/routes/+layout.svelte`) boots preferences → identity →
relays → pool, then starts per-account services: contacts, stories, feed, DMs,
notifications, wallet/zap receipts, NIP-29 groups, group sync, NIP-51 list
sync, outbox, call alerts. Services restart on identity or relay changes.

## 2. Surfaces & routes

| Route | Surface | Auth | What it is |
|---|---|---|---|
| `/` | Feed | optional | Live timeline: For you (ranked) / Following / pinned hashtags, stories bar, composer, zap strip, filters, rank explainer |
| `/bitz` | Bitz reels | optional | Short-video surface: Explore grid / Following / For you / Trending / Most zapped, snap-scroll player, comments, remix chain, search |
| `/studio` | Studio home | optional | Dashboard: continue-creating hero, WIP slots, saved templates |
| `/studio/create` | Editor | optional | Full-bleed editor, `?tab=meme\|bitz`; Meme Studio (desktop 3-pane / mobile-native shell) + Bitz composer; consumes handoff + PWA share target |
| `/messages` | Chats | required | E2EE DMs + BitOS private groups + WebRTC calls (voice/video, 1:1 + group) |
| `/communities` | Communities | optional | NIP-29 public group rooms (join/create/discover, admin, invite deep-links) |
| `/notifications` | Activity | required | Reactions/replies/reposts/mentions/follows/zaps; filters + grouping |
| `/discover` | Search | optional | NIP-50 search: notes / media / people / tags; trending; lightbox |
| `/profile/[pubkey]` | Profile | optional | Posts/replies/media/zaps/pinned/liked/reposts/bitz tabs, heatmap, gallery, actions |
| `/profile` | Own profile | required | Delegates to ProfileView with own pubkey |
| `/zaps` | Wallet | required | Balance, deposit/withdraw invoices, zap ledger |
| `/bookmarks` | Library | required | Saved notes |
| `/more` | "You" hub (mobile) | optional | Profile hero, identity/QR/backup, wallet strip, tiles, account switcher |
| `/more/sounds` | Trending sounds | optional | SFX ranked by real usage in recent meme bitz (recency-decayed) |
| `/note/[id]` | Permalink | optional | Single note + activity; hex/note1/nevent1/naddr1 resolution |
| `/settings` (+`/[section]`) | Settings | required | iOS-style sections: account, lightning, privacy, notifications, appearance, algorithm, security/relays, media, language, help, about |
| `/welcome` | Onboarding | — | Create/import keypair |
| `/about`, `/privacy`, `/terms` | Public site | — | Marketing + legal pages (PublicShell) |
| `/pulse` | **Dev-only showcase** | — | Premium-UI mock with fake data; 404s outside `dev` (§9) |
| `+error.svelte` | Error | — | Styled 404/500 |

**Navigation** — desktop: `NavRail` sidebar + `AppRightRail` (network pulse,
trending, follow suggestions, relay widget). Mobile: `MobileTabBar` (Home,
Bitz, Discover, Chats, Activity, "You" → `/more`). Top: `NetworkBar` relay
connectivity. Global overlays: incoming call banner, toasts, confirm dialog,
account switcher. Protected prefixes (`lib/auth/access.ts`): `/messages`,
`/notifications`, `/bookmarks`, `/settings`, `/zaps`, `/profile`.

## 3. Feature reference (by area)

### Feed & social graph
- Kind-1 timeline with reactions (kind 7), reposts (NIP-18), zaps (NIP-57),
  mentions (NIP-27 rendering), polls, media notes (NIP-92 `imeta`).
- Follows via NIP-02 kind-3; follow suggestions in the right rail.
- Stories: NIP-38 kind-30315 with NIP-40 expiry; multi-slide, seen-state,
  optional view receipts (privacy-gated).
- Mute/block via NIP-51 lists (kind 10000 mute, kind 30000 block), synced
  additively and republished debounced.
- Hashtag interest sets (kind 30015) power pinned tags + topic signal.
- Bookmarks, drafts, outbox (signed events held until N relay ACKs),
  content-classification hides machine protocol payloads.
- Optional NIP-13 PoW mining in a Web Worker (hashrate/progress UI, badge).

### Ranking (client-side, user-controlled)
- `lib/algorithm/`: 7 signals (recency, engagement, zaps, affinity, WoT,
  novelty, topics) → weighted pipeline with thread suppression, soft
  penalties, diversity pass. Surfaces: feed, reels, discover.
- Presets: Latest / Balanced / Engagement / Trust + custom. Off = pure
  reverse-chron. `RankExplainer` shows per-note score breakdown.
- Interaction profile persists dismissals, soft-mutes, hashtag interest.

### Bitz (short video)
- Reels published as NIP-68/71 media events (kinds 20/21/22/34235/34236);
  `bitz-codec.ts` is the authoritative media extractor (imeta-first, fallback
  chains, rendition ladders, hash/dim/duration validation).
- Player: snap-scroll, adaptive renditions + mirror failover (`MediaPlayer`),
  view-mode toggle, persistent mute, emoji bursts, PoW badge.
- Comments panel (NIP-10/22 threading), zap dialog with invoice resolution,
  remix-chain dialog, author mode (`?author=npub`), 15-min reels cache.

### Meme Studio
- Versioned project schema (`com.bitos.bitz.meme` v1, `meme` tag on the
  event): text overlays normalized 0–1, fonts/colors, SFX cues, timing.
- Edit tracks: frame FX (glitch/flash/shake/pixelate/…), punch-in zooms,
  speed ramps, ambient layer motion, Draw & Record strokes (replayable),
  caption-sync, non-destructive video clips.
- Layers: images, animated GIF/WebP (WebCodecs decode), stickers, emoji packs
  (NIP-30), bundled Bitz Buddy mascot/Bitzverse SVG props, Iconify picker.
- Sound: synthesized SFX (OfflineAudioContext, no audio assets), cue mixing,
  shared sounds via NIP-78 kind-30078 (license + sha-256 verified), trending
  ranking (`/more/sounds`).
- Export: canvas WYSIWYG render → JPEG still / MediaRecorder WebM/MP4 / pure-TS
  GIF encoder (median-cut + LZW).
- Creator economy: value-splits manifest (basis points, display-only V1),
  zap-gated template marketplace, AI-provenance disclosure tag, remix chain
  (`remix` tag + compact payload + cycle guard).
- Studio persistence: drafts, named WIP slots, templates, sound library
  (meta in localStorage, audio bytes in IndexedDB), batch queue, share-inbox.

### Auto Meme (local AI)
- Pure local DSP analysis (silence spans, energy peaks, speech segments,
  pluggable face anchors) → Mild/Funny/Chaos suggestion ladder → ordinary
  editor objects (never direct-to-wire). Smart templates self-score per clip.
- No network AI calls exist in the codebase. `ai/consent.ts` is a consent
  gate for a future cloud tier — currently unwired (§9).

### Messages, groups & calls
- DMs: NIP-17 gift wrap preferred (kinds 1059/14 via `nip17`), NIP-04
  fallback; conversations, read cursors, IndexedDB cache.
- BitOS private groups: custom `bitos://group-invite|group-message|
  group-control` payloads inside the DM transport (`lib/messages/protocol.ts`).
- Public groups: NIP-29 on dedicated relays (default `wss://groups.0x.chat`)
  — kinds 9/10 chat, 9000–9007 admin, 9021/9022 join/leave, 39000–39002
  metadata; discovery, roster, attachments.
- Calls: WebRTC signaling (offer/answer/ICE/end) over DMs; 1:1 + group
  voice/video; device pickers, mic meter, speaker test, PiP, reconnect/quality
  timers, 90-s offer expiry, synthesized ringtone, call history; optional
  TURN via `PUBLIC_CALL_TURN_*`.

### Zaps & wallet
- NIP-57: zap request (kind 9734) + receipt (9735) with LNURL-pay flow,
  recipient NIP-65 relay race, `relays` tag policy; BOLT11 parsing; pending-zap
  reconciliation after tab backgrounding.
- Wallets: WebLN provider bridge (Alby/Mutiny/NWC extensions) and a minimal
  NIP-47 NWC client (NIP-04-encrypted commands, URI persisted).
- Ledger: received zaps recovered from receipts (sender re-derived from the
  embedded 9734), sent zaps tracked locally; deposit/withdraw invoices with
  paid detection (polling + NWC 7375 push watcher).

### Media pipeline
- Uploaders (`lib/media/uploaders.ts`): **Blossom BUD-02** (kind-24242 auth
  event, sha-256 verify, default `blossom.nostr.build`), **Cloudinary**
  (unsigned preset or signed), **S3/R2** (client-side AWS SigV4 via Web Crypto);
  XHR progress/retry/abort. Server Cloudinary fallback at `/api/media/upload`.
- `publish-machine.ts`: render → verify (hash) → sign (+ optional PoW) →
  publish; blocked on hash mismatch.
- Video: client probe (size/duration/megapixel bomb guards), draft trim,
  browser re-encode (MediaRecorder), portability-ranked codec policy.
- Privacy: EXIF strip + neutral filenames on upload.

### PWA
- `src/service-worker.ts`: shell precache; **share target** banks shared files
  into a cache and redirects to `/studio/create?tab=meme&shared=1`
  (`share-inbox.ts` drains it).

## 4. Core module reference

| Module | Size | Responsibility |
|---|---|---|
| `lib/nostr/` | ~48 files | Protocol core: pool, identity, relays, types/kinds, feed, stories, dms, notifications, groups (NIP-29), group-sync (legacy), contacts, profiles, list-sync (NIP-51), nip65, bitz-codec, zaps, zap-invoice, wallet, webln, nwc, pow (+worker), reports, comments, origin-notes, event-ref, client-tag, content-classification |
| `lib/meme/` | ~74 files | Meme Studio: schema, tracks, drawing, layers/stickers/buddy, render + export (JPEG/WebM/GIF), synth SFX, cue mixing, remix, shared templates/sounds (NIP-78), marketplace, trending, emoji packs (NIP-30), source fetch/CORS retry |
| `lib/stores/` | ~49 files | Runes singletons persisted to localStorage/IndexedDB: account, moderation (blocks/mutes), feed prefs, bitz session/search, outbox, pending zaps, meme studio (12 stores), media/wallet/pow/call prefs, UI (toasts/confirms/popovers/badges/call alerts), drafts, studio handoff |
| `lib/components/` | 15 groups | `ui` (design system, 36), `feed` (31), `bitz` (48: studio + reel composer), `shell` (16), `premium` (12, showcase-only), `settings` (10), `profile` (6), `studio` (+mobile), `groups`, `zaps`, `calls`, `support`, `media`, `public`, `auth` |
| `lib/algorithm/` | 13 + signals | Ranking pipeline, signals, presets, preferences, interaction profile, penalties, diversity |
| `lib/media/` | 13 | Uploaders, publish machine, video probe/trim/cut, codec policy, upload privacy |
| `lib/ai/` | 8 | Auto Meme: extract, suggest, smart templates, consent (unwired) |
| `lib/messages/` | 6 | Group/call wire protocol, call admission/lifecycle guards |
| `lib/auth/` | 4 | `NostrSigner` seam (Local + Test signers; NIP-46 anticipated), route access rules |
| `lib/utils/` | 25 | NIP-27 entities, note tokenizer, mentions autocomplete, imeta, blurhash, sensitive media, profile stats, verification badges, formatting, share inbox |
| `lib/theme/`, `lib/settings/`, `lib/calls/` | — | Appearance prefs + palettes; settings section registry; ringtone synth |

## 5. NIP support matrix

| NIP | Area | Where |
|---|---|---|
| 01 | Events, metadata, feed | `nostr/types.ts`, `feed`, `profiles` |
| 02 | Follow lists | `nostr/contacts.svelte.ts` |
| 04 | Legacy DMs (fallback) | `nostr/dms.svelte.ts` |
| 10/22 | Reply/thread markers | `nostr/feed-note.ts`, `comments` |
| 11 | `min_pow_difficulty` readback | feed note adapter |
| 13 | Proof of work | `nostr/pow.ts` + worker |
| 17 | Secure DMs (gift wrap 1059/14) | `nostr/dms.svelte.ts` |
| 18 | Reposts | feed + types |
| 19 | npub/nsec/nevent/naddr | identity, note routes |
| 25 | Reactions (incl. story views) | feed, stories |
| 27 | Text note references | `utils/nip27.ts` |
| 29 | Relay-based public groups | `nostr/groups.svelte.ts` |
| 30 | Emoji packs (30030) | `meme/emoji-packs.ts` |
| 38 | Stories (30315) | `nostr/stories.svelte.ts` |
| 40 | Expiration | stories |
| 47 | Nostr Wallet Connect | `nostr/nwc.ts` |
| 50 | Relay search | `stores/bitz-search` |
| 51 | Lists (mute/block/interests) | `nostr/list-sync.ts` |
| 56 | Reporting (1984) | `nostr/reports.ts` |
| 57 | Zaps | `nostr/zaps.ts`, `zap-invoice.ts`, `wallet` |
| 65 | Relay lists (10002) | `nostr/nip65.ts` |
| 68/71 | Bitz media reels (20/21/22, 34235/36) | `nostr/bitz-codec.ts` |
| 78 | App data (30078 shared templates/sounds) | `meme/shared-*.ts` |
| 89 | Client tag (opt-out) | `nostr/client-tag.ts` |
| 92 | Media metadata (`imeta`) | `utils/imeta.ts`, feed |
| 94 | Blossom descriptors / BUD-02 upload | `media/uploaders.ts` |

## 6. Server endpoints & environment

| Endpoint | Purpose | Notes |
|---|---|---|
| `POST/GET /api/media/upload` | Cloudinary fallback upload | Requires `BITOS_CLOUDINARY_CLOUD_NAME` + preset or key/secret; 100 MB cap; folder `<folder>/nostr/<pubkey>/<purpose>`; 503 when unconfigured |
| `GET /api/media/proxy` | HTTPS media proxy | SSRF-guarded (blocks private/loopback/link-local, ≤3 redirects), 1 h cache |
| `GET /api/icons/search` | Iconify search relay | Same-origin CSP workaround, 48-icon cap, cached |

Env vars: `BITOS_CLOUDINARY_*` (upload fallback), `PUBLIC_CALL_TURN_URLS /
_USERNAME / _CREDENTIAL` (optional TURN). See `.env.example`.

## 7. Storage model (all device-local)

- **localStorage** under the `bitos:` namespace — identity + account
  registry, relays (schema-versioned), prefs (theme, algorithm, feed,
  privacy, wallet, media, pow, calls), moderation lists, bookmarks,
  drafts, outbox, sent-zaps, story/seen state, caches (profiles, trending).
- **IndexedDB** — DM cache, notifications cache, sound-library audio bytes,
  decoded GIF frame cache.
- **Service worker caches** — app shell, share-inbox (`bitos-share-inbox`).
- Clearing account data: account switch clears caches
  (`stores/account-cache.ts`).

## 8. Security & privacy model

- Private key never leaves the device; `auth/signer.ts` is the seam for a
  remote signer (NIP-46 anticipated, not implemented).
- No `nsec`/secret is logged or serialized outside identity code paths.
- Publish is blocked on media hash verification (`media/publish-machine.ts`).
- Uploads strip EXIF + neutral filenames; sensitive media is blurred until
  tapped; "private account" and read-receipt toggles in privacy settings.
- Server proxy is SSRF-guarded and HTTPS-only; no server-side user state.
- AI is local-only; no cloud provider calls exist.

## 9. Dev-only & known-unused code

Kept deliberately; do not mistake for product features:

- `/pulse` showcase (dev-only, 404 in prod) and its `components/premium/`
  dataset, plus showcase-only shells/widgets (`PremiumShell`, `PremiumSidebar`,
  `NetworkStats`, `TopZapped`, `NotificationSummary`, `YourStats`,
  `PremiumComposer/PostCard`, `ChatBubble`, `ConversationItem`, `PeopleGrid`,
  `TrendingGrid`, `RelayCard`, `ZapRow`).
- `components/ui/Slideover.svelte`, `components/feed/NotesRail.svelte` —
  unreferenced.
- `ai/consent.ts` — implemented consent gate, unwired at call sites.
- `nostr/nwc-capabilities.ts` — NIP-47 vocabulary, imported only by its test.
- `nostr/protocol-fixtures.ts` — node-only fixture loader for tests.
- `nostr/group-sync.svelte.ts` — legacy local groups, superseded by NIP-29
  but still wired.

## 10. Testing & tooling

- **Unit/component**: Vitest with two projects — `client` (browser mode,
  Playwright chromium; `src/**/*.svelte.{test,spec}.ts`) and `server`
  (node; `src/**/*.{test,spec}.ts`); assertions required.
- **Protocol fixtures**: `fixtures/protocol/*.json` pin bitz-media event
  shapes (generated + public-shaped).
- **e2e**: Playwright (`npm run test:e2e`).
- **Lint/format**: ESLint + Prettier (Svelte + Tailwind class sorting).
- **`npm run check:client-tags`**: read-only relay audit of the `["client",
  "BitOS"]` tag — see [`client-tag-audit.md`](client-tag-audit.md).
- **Bundle**: vendor split in `vite.config.ts` (`vendor-nostr`,
  `vendor-icons`, `vendor-qr`); `__APP_VERSION__` injected from package.json.
