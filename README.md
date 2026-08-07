# BitOS Nostr

A local-first **Nostr** social client — a **Feed** (kind 1 text notes) and
**Chat** (Secure DMs with NIP-04 fallback) — built with SvelteKit 2 + Svelte 5 (runes) +
Tailwind v4.

This app fuses three sources:

| Source                                | What it contributes                                                                                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`bitdigo/notes/web`** (BitOS Notes) | The _visual language & settings_ — Apple-faithful, macOS-Notes 3-pane aesthetic, system fonts, the signature **`#FFCC00` yellow** brand, traffic-light titlebar, the relay model (read/write flags + health test), and the appearance/account settings UX.     |
| **`school-erp-svelte`**               | The _component code pattern_ — Svelte 5 runes, `tailwind-variants` buttons, an offline Iconify/Lucide icon registry, a runes-based preferences singleton, `--ui-*` surface tokens, glass/surface utilities, and the desktop-sidebar + mobile-bottom-tab shell. |
| **Nostr protocol**                    | The actual _features_ — NIP-01 events, Secure DMs (NIP-17) with NIP-04 fallback, NIP-19 (`npub`/`nsec`) keys, and a `SimplePool` relay client.                                                                                                               |

## Features

- **🔑 Local-first identity** — generate a fresh keypair or import an existing
  `nsec1…`/hex key. Your private key never leaves the device (persisted to
  `localStorage`). Onboarding gate shown on first run.
- **📰 Feed (`/`)** — live global timeline of kind 1 text notes streamed from
  your relays. Compose + post (⌘⏎), ❤️ react (kind 7), copy, avatars + display
  names resolved from kind 0 metadata.
- **💬 Messages (`/messages`)** — end-to-end-encrypted direct messages with
  Secure DMs (NIP-17) and legacy NIP-04 compatibility,
  grouped into conversations with day dividers, search, and a "new message"
  dialog (paste an `npub`). Deep-links via `?to=<npub|hex>`.
- **⚙️ Settings (`/settings`)** — appearance (light/dark/system + 5 accent
  colors + font size), relays (add/remove, toggle read/write, test latency),
  account (edit display name → publishes kind 0, reveal/copy `npub`/`nsec`,
  log out).

## Stack

- **SvelteKit 2** + **Svelte 5** (runes mode, `ssr = false` — Nostr is
  browser-only)
- **Tailwind CSS v4** (`@tailwindcss/vite`) with a custom `@theme` token system
- **`nostr-tools`** for crypto (`secp256k1`/Schnorr), `nip04`, `nip19`, and the
  `SimplePool` relay client
- **`@iconify/svelte`** + **`@iconify-json/lucide`** for offline icons
- **`tailwind-variants`**, **`clsx`**, **`tailwind-merge`** for component styling

## Architecture

```
src/
├── app.css                       # Design system: bitdigo tokens × school-erp token arch
├── app.html                      # no-flash dark-mode script, theme-color, fonts
├── lib/
│   ├── components/
│   │   ├── ui/                   # Button, Icon, Input, Textarea, Avatar, Badge,
│   │   │                         #   Toaster, Slideover, Dialog  (school-erp pattern)
│   │   ├── feed/                 # NoteCard, Composer
│   │   ├── mobile/BottomTabBar.svelte
│   │   ├── AppSidebar.svelte     # nav + relay status + account
│   │   ├── AppTopbar.svelte      # macOS traffic-light titlebar
│   │   └── Onboarding.svelte     # first-run key setup
│   ├── nostr/
│   │   ├── types.ts              # Event/Profile/FeedNote/DirectMessage/Relay
│   │   ├── hex.ts                # byte ⇄ hex helpers (nostr-tools wants Uint8Array)
│   │   ├── identity.svelte.ts    # keypair store (generate/import/persist)
│   │   ├── relays.svelte.ts      # relay list (defaults from bitdigo)
│   │   ├── pool.ts               # SimplePool singleton: subscribe/query/publish
│   │   ├── profiles.svelte.ts    # kind 0 metadata cache
│   │   ├── feed.svelte.ts        # kind 1 timeline + reactions + composer
│   │   └── dms.svelte.ts         # NIP-04 conversations + send/decrypt
│   ├── stores/toasts.svelte.ts
│   ├── theme/                    # colors.ts (accents) + preferences.svelte.ts
│   ├── utils/                    # cn.ts, format.ts (timeAgo, shortKey, …)
│   └── icons.ts                  # offline Lucide registry
└── routes/
    ├── +layout.svelte            # shell: sidebar / topbar / bottom tab / onboarding gate
    ├── +layout.ts                # ssr = false
    ├── +page.svelte              # Feed
    ├── messages/+page.svelte     # Chat
    └── settings/+page.svelte     # Appearance / Relays / Account
```

### Data flow

The root layout loads `preferences`, `identity`, and `relays` on mount. When an
identity exists, effects start the **feed** and **DM** subscriptions (and
restart them when the relay list or identity changes). All Nostr reads/writes go
through `lib/nostr/pool.ts`, which selects read vs. write relays from the
`relays` store.

## Develop

```sh
npm install
npm run dev -- --open
```

### Optional server upload fallback

If a user does not configure their own Cloudinary or S3 account, BitOS can
upload media through the app server and forward it to Cloudinary. Copy
`.env.example` to `.env` and set:

```sh
BITOS_CLOUDINARY_CLOUD_NAME=...
BITOS_CLOUDINARY_API_KEY=...
BITOS_CLOUDINARY_API_SECRET=...
BITOS_CLOUDINARY_UPLOAD_PRESET=...
BITOS_CLOUDINARY_FOLDER=bitos
```

You need `BITOS_CLOUDINARY_CLOUD_NAME` plus either:

- `BITOS_CLOUDINARY_UPLOAD_PRESET` for unsigned uploads, or
- `BITOS_CLOUDINARY_API_KEY` + `BITOS_CLOUDINARY_API_SECRET` for signed uploads

The fallback endpoint lives at `/api/media/upload` and is used automatically by
notes, stories, messages, and profile media uploads when no personal provider is
selected. Server uploads are organized into Cloudinary folders like:

```text
<BITOS_CLOUDINARY_FOLDER>/nostr/<pubkey>/<purpose>
```

Examples:

- `bitos/nostr/<pubkey>/note`
- `bitos/nostr/<pubkey>/story`
- `bitos/nostr/<pubkey>/message`
- `bitos/nostr/<pubkey>/profile`

First visit → onboarding: **Create a new identity** (back up the `nsec`!) or
**import** an existing key. Then the feed and messages start streaming from the
default relays (`relay.damus.io`, `nos.lol`, `relay.nostr.band`).

## Scripts

```sh
npm run dev        # dev server
npm run build      # production build
npm run check      # svelte-check (types)
npm run lint       # prettier + eslint
npm run test       # vitest unit/component + playwright e2e
```

## Notes & caveats

- **NIP-04** DMs are used (most widely supported). NIP-44/NIP-17 can be layered
  on later behind the same `dms` API.
- The private key is stored in `localStorage` for a smooth local-first
  experience. For higher security, swap `identity.persist()` for an in-memory or
  WebAuthn-backed store.
- Icons register the **full** Lucide collection offline (~670 kB chunk); for a
  smaller bundle, switch to per-icon imports later.
