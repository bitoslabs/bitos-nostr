# Feed Negative Feedback — Protocol Noise & "Not Interested" Learning

> Status: **shipped.** Detection in `src/lib/nostr/content-classification.ts`,
> learning in `src/lib/algorithm/interaction-profile.svelte.ts`, enforcement
> in `penalties.ts` + `pipeline.ts`.

## 1. Problem

Two classes of junk were reaching the ranked feed:

1. **Machine protocol notes.** Kind-1 events whose content is a serialized
   protocol message, not a human note. Real samples captured from relays
   (`docs/source/events.json`):

   | Envelope | Tag | What it is |
   |---|---|---|
   | `{"v":1,"t":"hello","to":"*","from":"peer_…","hello":{…kemPub…}}` | `aegis50442a25bdbd01aa` | Encrypted-swarm handshake w/ post-quantum key material |
   | `{"v":1,"to":"*","from":"peer_…","t":"mixbeacon"}` | `aegismixv2` | Mix-network beacon |
   | `{"cipher":"…","iv":"…"}` | `v:kuchupuchukylie` | Encrypted transport frame |
   | `{"sonda":"s5","seq":71,"enviado_ms":…}` | `skillmsg-s5` | Telemetry probe ("sonda" = probe, Spanish) |

2. **Feedback that didn't generalize.** "Not interested" only hid one event
   id — useless against protocols that mint a fresh id per message. And with
   the surface's algorithm toggle off, dismissed notes came back.

## 2. Design principles

1. **Structural detection over name-chasing.** Protocol families evolve
   (`udal-…` → `aegis…` → `skillmsg-…`). We detect the *shape* of the
   envelope, so unknown protocols are caught without a code change.
2. **Hide is intent; rank is opinion.** Explicit "Not interested" survives
   every mode switch. Soft penalties only steer the ranking.
3. **Learn, don't just hide.** Each dismissal teaches the profile about the
   author/topic, so *future* similar notes sink without further taps.
4. **Everything reversible and decaying.** No negative state lasts forever;
   ~30-day half-lives and ledger ceilings prevent fossilized shadow-mutes.
5. **Local-first.** All state stays in `localStorage` (roamed via the
   encrypted NIP-30078 settings backup through `settings-sync`).

## 3. Machine-envelope detection

### 3.1 `isMachineEnvelope(content)` — the content signal

`src/lib/nostr/content-classification.ts`. Applies only when the trimmed
content is a JSON object (`{…}`). It walks the object recursively,
collecting every key and string value, then classifies as **machine** when
any rule fires — **unless** the prose guard says a human wrote it:

| Rule | Catches | Example |
|---|---|---|
| `cipher` **and** `iv` keys present | encrypted transport | sample 3 |
| ≥2 keys from the protocol vocabulary `v, t, to, from, seq, ts, peerId, room, nym, kemPub, dsaPub, dhPub, sigKemPub, sonda, beacon, cipher, iv, enviado_ms` | handshakes, beacons, probes | samples 1, 2, 4 |
| any string value contains a ≥120-char unbroken base64/hex run | key material | `kemPub` blobs |

**Prose guard:** if any string value matches ≥3 consecutive
whitespace-separated words, the note is human — a pasted-but-readable API
response stays visible.

### 3.2 `isMachineTag(tag)` — the tag fast path

Extended pattern (still one regex, case-insensitive):

```
^(?:udal-(?:friend|peer|node)-[0-9a-f]{8,}|aegis(?:mixv\d+|[0-9a-f]{8,})|skillmsg-\w+)$
```

- `udal-friend-<hex8+>` / `udal-peer-…` / `udal-node-…` — swarm rosters
- `aegis<room-hex≥8>` and `aegismixv<n>` — mix-net rooms/beacons
- `skillmsg-<id>` — skill telemetry channels

Plain `aegis` (a real Greek word people tag) is deliberately **not**
matched; the hex/v-suffix requirements keep human hashtags safe.

### 3.3 Where detection is enforced

| Consumer | Behavior |
|---|---|
| **Feed** (`src/routes/+page.svelte`) | Machine envelopes are filtered alongside channel rosters, behind the existing **Settings → Algorithm → "Show protocol messages"** opt-in. |
| **Topics signal** (`signals/topics.ts` via `extractTags`) | `extractTags()` returns `[]` for machine envelopes → no tag ever boosts them, and "Show less about #x" can't burn a mute on an unrepeatable routing id. |
| **Trends** (`AppRightRail.addTrendEvent`) | Machine envelopes are skipped entirely → `skillmsg-s5` / `aegis…` can't swamp the trending list. |
| **Card chips** (`PostCard` / bitz reels) | Chips render from `extractTags` → machine notes show no tag chips. |

**Why filter tags via content?** Sample 3's `v:kuchupuchukylie` isn't even a
`t` tag — only the content rule catches it. Content shape is the invariant;
tag names are fashion.

## 4. "Not interested" that learns

### 4.1 The disfavor ledger

`interactionProfile.state` gains two records (persisted + decayed like
affinity):

```ts
authorDisfavor: Record<pubkey, number>;  // +1 per dismissal of their note
tagDisfavor:   Record<string, number>;   // +0.8 per dismissal of a #topic
```

- `dismissNote(noteId, note?)` now takes the note. Callers updated:
  `PostCard.notInterested()` and bitz `notInterestedIn()` pass it; the
  legacy id-only call still works (pure hide, no learning).
- **Ceiling:** each entry caps at `8`, so pressure normalizes (log-scaled)
  to 0–1: `disfavorFor(pk) = log10(1+raw)/log10(9)`.
- **Decay:** same ~30-day half-life as affinity — stop dismissing and old
  grudges fade.
- **Bounds:** 400 authors / 120 tags, weakest-dropped — same caps as the
  positive ledger.

### 4.2 Scoring — `negativePenalty(note)`

Applied as a multiplier after the weighted signal sum. Layers combine
multiplicatively:

| Layer | Effect |
|---|---|
| Dismissed note id | `0` — hard-filtered before scoring |
| Learned disfavor (author or topic, max of the two) | `× (1 − 0.85 × disfavor)` — one tap ≈ ×0.73 nudging down, repeated taps converge to ≈ ×0.15 near-mute |
| Soft-muted author ("Show less from @x") | ×0.25 |
| Soft-muted tag ("Show less about #x") | ×0.4 |

Calibration: 1 dismissal → ×0.73, 2 → ×0.55, 4 → ×0.36, 6 → ×0.25,
ceiling ×0.15. Gentle first, escalating with evidence, always reversible.

### 4.3 Dismissal survives "algorithm off"

`rankNotes` / `rankNotesWithBreakdown` now filter `isDismissed` **before**
the `cfg.enabled` chronological bail-out. Rationale: "Off = chronological,
never hidden" was meant to protect *discovery*, not to resurrect notes the
user explicitly asked to never see again. Soft penalties (mutes, disfavor)
still only apply when ranking is on.

```
candidates → strip dismissed (always) → [ algo off? chronological | score → ×penalties → diversity ]
```

## 5. User-visible behavior

| Action | Immediate | Learned | Where |
|---|---|---|---|
| **Hide note** | removed from feed | — | PostCard menu |
| **Not interested** | hidden (any mode) | author −1, tags −0.8 → future similar notes sink | PostCard / bitz reels menu |
| **Show less from @x** | ×0.25 penalty | — | PostCard / profile menu |
| **Show less about #x** | ×0.4 penalty | — | tag chip menu |
| **Show protocol messages** (Settings → Algorithm → Feed readability) | machine envelopes visible again | — | toggle |

## 6. Data & sync

- **Storage:** `localStorage["bitos:algorithm-interaction-profile"]` — the
  new fields ride the existing payload; older payloads simply load with
  empty disfavor ledgers (no migration).
- **Roaming:** included in the encrypted NIP-30078 settings backup
  (`settings-sync.svelte.ts` already serializes the whole profile blob).
- **Reactivity:** every write bumps `interactionProfile.version`, which
  ranked surfaces already watch to re-rank cheaply.

## 7. Testing

- `src/lib/nostr/content-classification.test.ts` — all four real-world
  envelope families (from `docs/source/events.json`), tag pattern additions,
  prose/JSON-human false-positive guards, malformed-input safety.
- `src/lib/algorithm/algorithm.test.ts` —
  - dismissal hidden in ranked **and** chronological mode (both pipeline
    variants),
  - one dismissal sinks the author's next equal-signal note,
  - six dismissals converge to the near-mute band (0.15–0.3 multiplier),
  - `extractTags` returns `[]` for machine envelopes.

## 8. Future work

- **"Mute @x?" escalation prompt** — after 3+ dismissals of the same author,
  offer the explicit mute instead of silently nearing it.
- **NIP-51 mute lists** — reconcile local soft mutes with the user's
  published mute list where available.
- **Envelope vocabulary** — extend `ENVELOPE_PROTOCOL_KEYS` as new machine
  protocol families appear on relays; the blob/prose guards already cover
  most unknown shapes.
