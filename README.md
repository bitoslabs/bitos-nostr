# BitOS — Nostr Social Platform (Web)

Live: [social.bitos.space](https://social.bitos.space) · Version 0.6.x

A **local-first Nostr client** — feed, short-video reels, a full meme/reel
studio, end-to-end encrypted chats with group calls, Lightning zaps, and
public communities. Built with **SvelteKit 2 + Svelte 5 (runes) + Tailwind v4**
and `nostr-tools`. There is no backend database: relays are the backend, the
private key never leaves the browser, and everything (identity, preferences,
drafts, caches) lives on-device.

> Full system + feature reference, generated from the code: **[docs/SYSTEM.md](docs/SYSTEM.md)**

## Feature areas

**Identity & accounts** — generate a keypair or import `nsec1…`/hex; multi-account
registry with switcher; npub/nsec reveal + QR; guest browsing with sign-in gates.

**Feed (`/`)** — live global timeline + **Following** (NIP-02) + pinned hashtags;
algorithmic **For you** ranking that is fully toggleable and explainable
("why am I seeing this?"); stories bar (24h NIP-38); polls; emoji reactions,
reposts, mentions; optional NIP-13 proof-of-work mining; bookmarks; filters;
outbox durability for unsigned-event retries.

**Bitz (`/bitz`)** — short-video reels surface (Explore grid / Following /
For you / Trending / Most zapped) with snap-scroll player, comments, zaps,
remix chain, NIP-50 search, adaptive renditions, sensitive-media blurring.

**Studio (`/studio`)** — two creation modes on one production system:
- **Meme Studio** — desktop 3-pane editor + native-feeling mobile shell:
  captions, image/sticker layers (incl. Bitz Buddy mascot packs), FX / zoom /
  speed tracks, synthesized SFX + shared sound library (NIP-78), Draw &
  Record, GIF input, templates, zap-gated template marketplace, batch queue,
  remix lineage, value-splits manifest.
- **Bitz composer** — fast-lane 9:16 short-video composer with trim, browser
  re-encode, PoW "rare bitz" option, and a verify→sign→publish state machine.

**Auto Meme (local AI)** — on-device DSP clip analysis (silence/energy/speech
anchors) driving suggestion ladders and smart templates. No cloud AI calls;
AI-assisted memes carry a provenance tag.

**Messages (`/messages`)** — E2EE DMs (NIP-17 with NIP-04 fallback), BitOS
private group chats (custom protocol over DM transport), media attachments,
and **WebRTC voice/video calls** (1:1 and group) with device pickers, PiP,
call history, synthesized ringtone, optional TURN relay.

**Communities (`/communities`)** — public NIP-29 relay-based group chat rooms
(join/create/discover, roster + admin tools, attachments, invite cards).

**Zaps & wallet (`/zaps`)** — send/receive NIP-57 zaps (note zap dialog, live
zap strip, receipts), WebLN providers (Alby/NWC extensions), NIP-47 Nostr
Wallet Connect, balance + deposit/withdraw invoices, full zap ledger.

**Discover (`/discover`)** — NIP-50 search across notes / media / people /
tags, trending hashtags, media lightbox, follow suggestions.

**Notifications (`/notifications`)** — reactions, replies, reposts, mentions,
follows, zap receipts; filters, grouping, media previews, read cursor.

**Profile (`/profile/[pubkey]`)** — posts/replies/media/zaps/pinned/liked/
reposts/bitz tabs, GitHub-style activity heatmap, media gallery, follow/block
actions, NIP-05 / lud16 verification badges.

**Settings (`/settings`)** — appearance (theme, accent, density, font),
algorithm tuning (presets + per-signal weights), relays (read/write/primary +
NIP-65 publish, latency tests), privacy (client tag, read receipts, sensitive
media), media upload providers, security (keys, encrypted settings sync),
language, help, about.

**Media pipeline** — client-side uploaders for **Blossom (BUD-02)**,
Cloudinary, and S3/R2 (client-signed); optional server Cloudinary fallback;
EXIF stripping + neutral filenames; video probe/trim/re-encode; NIP-92
`imeta` on every media note.

**PWA** — service worker shell, share-target into Meme Studio, offline
caching.

## Stack

- SvelteKit 2 + Svelte 5 runes, client-rendered (`ssr = false` — Nostr is browser-only)
- Tailwind CSS v4 with a custom `@theme` token system
- `nostr-tools` (Schnorr keys, NIPs, `SimplePool`)
- `@iconify/svelte` + full offline Lucide registry
- Vitest (browser + node projects) and Playwright e2e

## Architecture

```
src/
├── lib/
│   ├── nostr/        # protocol core: pool, identity, relays, feed, stories,
│   │                 #   dms, groups (NIP-29), zaps/wallet (WebLN/NWC),
│   │                 #   notifications, NIP-65, NIP-51 list sync, PoW worker
│   ├── meme/         # Meme Studio: schema, tracks (fx/zoom/speed/draw),
│   │                 #   canvas render + export (JPEG/WebM/GIF), synth SFX,
│   │                 #   remix chain, shared templates/sounds (NIP-78)
│   ├── algorithm/    # client-side feed ranking: signals, presets, pipeline
│   ├── media/        # uploaders (Blossom/Cloudinary/S3), publish machine,
│   │                 #   video probe/trim/cut, EXIF privacy
│   ├── ai/           # Auto Meme: local DSP analysis + suggestions
│   ├── messages/     # group-chat + WebRTC call signaling protocol
│   ├── stores/       # ~49 runes singletons persisted to localStorage/IndexedDB
│   ├── components/   # ui (design system), feed, bitz (studio), shell, settings,
│   │                 #   profile, groups, zaps, calls, studio/mobile, premium
│   ├── auth/         # signer seam + route access rules
│   ├── settings/     # settings section registry
│   ├── theme/        # appearance preferences + palettes
│   └── utils/        # NIP-27 rendering, imeta, blurhash, formatting, …
├── routes/           # all pages (see docs/SYSTEM.md) + 3 server endpoints
└── service-worker.ts # PWA precache + share target
```

**Data flow** — the root layout boots preferences, identity, relays and the
pool, then starts per-account subscriptions (feed, stories, DMs, groups,
notifications, contacts, zaps). All reads/writes go through `lib/nostr/pool.ts`,
which fans out across the user's relays (NIP-65 aware). Signed events are the
source of truth; anything on a server is a derived projection.

## Develop

```sh
yarn install        # or npm install
npm run dev         # dev server on 127.0.0.1:5173
npm run build       # production build
npm run check       # svelte-check
npm run lint        # prettier + eslint
npm run test        # vitest (browser + node) then playwright e2e
npm run check:client-tags  # optional public client-tag audit (docs/client-tag-audit.md)
```

First run → `/welcome`: create a new identity (back up the `nsec`!) or import
one. The app then streams from six default relays (yakihonne, nos.lol,
damus, nostr.band, wellorder, relay.bitos.space) — editable in Settings.

### Server endpoints (optional, stateless)

| Endpoint | Purpose | Config |
|---|---|---|
| `POST /api/media/upload` | Cloudinary upload fallback when the user has no personal provider | `BITOS_CLOUDINARY_*` env vars (see `.env.example`) |
| `GET /api/media/proxy` | SSRF-guarded HTTPS media proxy for CORS-hostile hosts | none |
| `GET /api/icons/search` | Same-origin Iconify search relay for the sticker picker | none |

WebRTC calls can use a TURN relay via `PUBLIC_CALL_TURN_*` env vars (optional).

## Documentation

- `docs/SYSTEM.md` — full system + feature reference derived from the code
- `docs/algorithm-plan.md` — feed ranking design (shipped)
- `docs/client-tag-audit.md` — how to run the client-tag audit script
- `docs/ui.html`, `docs/ui/`, `docs/source/` — local design references and
  specs (gitignored; referenced from code comments)

## Security notes

- The private key is stored in `localStorage` for a local-first experience;
  `lib/auth/signer.ts` is the seam for a future NIP-46/bunker signer.
- Media uploads strip EXIF and use neutral filenames; publish is blocked on
  hash mismatch (`lib/media/publish-machine.ts`).
- No cloud AI: meme analysis is pure local DSP; the AI consent gate
  (`lib/ai/consent.ts`) exists for a future cloud tier.
- `/api/media/proxy` blocks private/loopback targets and enforces HTTPS.
