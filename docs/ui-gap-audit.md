# UI Gap Audit — `docs/ui.html` vs. the real app

`docs/ui.html` is the **design target** for the BitOS Nostr client. It is
faithfully reproduced as a **static showcase** at the `/pulse` route
(`src/routes/pulse/+page.svelte`, backed by `src/lib/components/premium/data.ts`
— all hardcoded seed data, no real Nostr calls).

The **real app** lives at `/`, `/messages`, `/notifications`, `/discover`,
`/bookmarks`, `/profile`, `/settings`, `/bits`, `/note/[id]` and uses live
Nostr data. This audit compares the doc against the **real app** only.

Legend: ✅ done · ⚠️ partial · ❌ missing

---

## 1. Navigation (left sidebar)

Doc nav: Home · Explore · Notifications · Messages · **Zaps** · **Relays** ·
Bookmarks · Profile · Settings, plus a **Lightning Wallet card** and a **Zaps
badge (21k)**.

Real `NavRail.svelte` (`src/lib/components/shell/NavRail.svelte`):
Home · Chats · Notifications · Bits · Discover · Bookmarks · Profile · Settings.

| Doc entry | Real app | Notes |
|---|---|---|
| Zaps | ❌ | No nav entry, no `/zaps` route |
| Relays | ⚠️ | Buried in Settings → "Security & Relay"; no top-level entry |
| Lightning Wallet card | ❌ | No wallet/balance card in the rail |
| Zaps badge (sats count) | ❌ | No aggregate sats badge |

---

## 2. ❌ Zaps page (`/zaps`) — **entirely missing**

The doc shows a full Zaps page. **There is no `/zaps` route** and no
wallet/ledger store anywhere (`src/lib/stores/`, `src/lib/nostr/` have no
balance/wallet/deposit/withdraw concepts).

Doc features missing in the real app:

- **Wallet balance hero** (e.g. "12,847 sats ≈ $4.32 USD · synced with Alby")
- **Deposit** / **Withdraw** buttons (no wallet connection at all)
- **30-day stat tiles**: Sent, Received, Zaps Sent, Avg Zap
- **Activity tabs**: All Activity · Sent · Received
- **Zap history ledger**: per-zap rows with recipient, amount, memo, txid,
  timestamp

> Note: per-note **sending** works (`src/lib/components/feed/NoteZapDialog.svelte`
> builds real NIP-57 LNURL invoices + listens for kind:9735 receipts). What's
> missing is the **aggregate wallet view** and a **history ledger**.

**To integrate**
- Add `src/lib/stores/wallet.svelte.ts` (balance, connection, history) — query
  own kind:9735 zaps (sent + received) from relays and tally sats.
- Add `src/routes/zaps/+page.svelte` (port `premium/ZapsView.svelte` to real
  data) and a nav entry in `NavRail.svelte`.

---

## 3. ❌ Lightning / WebLN integration — **missing**

The doc assumes a connected Lightning wallet (Alby) that can Deposit/Withdraw
and one-tap zaps.

- **No WebLN** anywhere — `grep` for `window.webln` / `globalThis.webln` returns
  nothing (`src/app.d.ts` has only a generic `declare global`).
- `NoteZapDialog` creates an invoice and shows a **QR + "Open wallet" deeplink**
  — the user must paste/deeplink into an external wallet. No in-app payment.
- **No "Lightning" settings section** (see §5).

**To integrate**
- Detect `window.webln` (Alby/Nostore/etc.), call `webln.enable()`, and when
  present pay invoices via `webln.sendPayment(invoice)` in `NoteZapDialog`
  instead of forcing the QR flow.
- Add deposit (generate invoice via the wallet) / withdraw (pay to an invoice)
  to the Zaps page once it exists.

---

## 4. ⚠️ Dedicated Relays page — **missing as a route**

The doc has a full Relays page. Real relay management lives inside
`src/lib/components/settings/SecuritySettings.svelte` (add / test / ping /
remove relays), reachable only via **Settings → Security & Relay**.

Doc features not surfaced in the real app:

- **Top stat tiles**: Connected x/y · Avg Latency · **Events Cached (GB)** ·
  **Total Events** — the real Security view has none of these aggregate tiles.
- **Per-relay cards** with events count, latency, mode (read/write/both),
  paid/free badge — the real view is a simpler list.
- **"Connect New Relay" form + suggested-relay chips** — exists functionally
  (add relay) but not as a prominent page.

**To integrate**
- Add `src/routes/relays/+page.svelte` (port `premium/RelaysView.svelte` to the
  real `relays` store) and a nav entry, OR surface `SecuritySettings` relay
  block as its own top-level page and link Settings to it.

---

## 5. ⚠️ Settings sections — **structure differs**

Doc Settings has 7 sections: **Account · Lightning · Privacy · Appearance ·
Network · Keys · About**.

Real `settingsSections` (`src/lib/settings/sections.ts`): Account · Privacy ·
Notifications · Appearance · Algorithm · **Security & Relay** · Media &
Uploads · Language & Region · Help & Support · About.

Missing/merged:

| Doc section | Real app | Status |
|---|---|---|
| **Lightning** (wallet connect, default zap amounts, anon-zap, non-zap reactions) | — | ❌ missing |
| **Keys** (nsec reveal/blur, export encrypted backup, QR; npub copy) | partly in Account ("Danger zone") + Security | ⚠️ no dedicated Keys surface |
| **Network** (max concurrent relays, cache size, event-kind subscriptions) | — | ❌ missing |

> The real app's **Algorithm** and **Media & Uploads** sections are *not* in the
> doc (they are real-app extras — fine).

**To integrate**
- Add a `lightning` settings section wired to a wallet store (see §3) and zap
  prefs (default amounts, anonymous zaps).
- Add a `keys` section (nsec reveal/export/QR + npub copy) — the building
  blocks exist in `SecuritySettings`/Account, just not consolidated.
- Add a `network` section (cache size, relay connection cap, subscribed kinds).

---

## 6. ⚠️ Notifications filters

Doc tabs: All · Zaps · Mentions · Reposts · Likes · Follows.

Real `notifications/+page.svelte` filters: **All · Unread · Mentions** (plus a
text search). Per-type buckets (Zaps / Likes / Reposts / Follows) are **not
selectable as tabs** — all types are shown together with grouping by note.

The data for per-type counts exists (`notifications.countByType`), so adding
type tabs is low-effort.

---

## 7. Profile tabs

Doc: Notes · Replies · Zaps · Media · Likes.
Real `ProfileView.svelte`: Posts · Replies · Media (+ Pinned / Liked / Repost
when present).

- **"Zaps" tab on profiles** (zaps sent/received by that pubkey) — ❌ not
  present. The real profile shows a *total sats-received* summary but no tab to
  browse the zap history.

---

## 8. Minor / cosmetic gaps

- **Zap confirmation particle burst** — the doc animates a burst from the zap
  button. `NoteZapDialog` is functional but has no celebratory animation.
- **Left-rail "New Note" PoW + relay-broadcast picker** — real `Composer` has
  the PoW slider + `HashViz` ✅, but no **relay broadcast picker** (select which
  relays to publish to). The doc shows a "Broadcast to Relays" multi-select.
- **Network Pulse live counters** (active pubkeys, events/min, relays online,
  sats/24h) — `AppRightRail` computes live throughput & active pubkeys ✅, but
  **sats/24h** is always `0` (no global zap aggregation).

---

## Priority summary

| # | Gap | Severity | Effort |
|---|---|---|---|
| 1 | Zaps page + wallet ledger (`/zaps`) | High | Med-High |
| 2 | WebLN wallet integration (in-app pay/deposit/withdraw) | High | Med |
| 3 | Lightning settings section | Med | Low-Med |
| 4 | Relays as a top-level page + nav entry | Med | Low |
| 5 | Network settings section | Med | Low |
| 6 | Keys settings section (consolidated nsec/npub) | Med | Low |
| 7 | Notifications type tabs (Zaps/Likes/Reposts/Follows) | Low | Low |
| 8 | Profile "Zaps" tab | Low | Low-Med |

## ✅ Already fully implemented (no action)

- Home feed: For You / Following / pinned tags, algorithm ranking, live new-note
  banner, infinite scroll.
- Composer: PoW slider + `HashViz` + NIP-13 mining via Web Worker
  (`src/lib/nostr/pow.worker.ts`).
- Per-note zaps: real NIP-57 LNURL invoices + receipt listening.
- Messages: NIP-44 E2E DMs, conversation list + chat + voice/video calls.
- Notifications: real zaps/likes/reposts/follows/mentions with grouping + search.
- Profile: banner/avatar/bio/NIP-05/Lightning, Posts/Replies/Media/Pinned/Liked/
  Reposts tabs, activity heatmap, completion meter.
- Discover: search + trending tags + suggested people.
- Bookmarks (NIP-51), Relays (in Settings), Appearance/Algorithm/Media settings.
- Right rail: Network Pulse (live throughput), Trending tags, Active relays,
  People-you-might-like.
