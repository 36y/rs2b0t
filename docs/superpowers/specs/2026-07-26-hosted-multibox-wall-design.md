# Hosted MultiBox wall — design

**Date:** 2026-07-26
**Status:** approved, not implemented

## Problem

The hosted client at `w1.rs2b2t.com/rs2b0t` is single-instance by construction —
`tools/pack-rs2b0t.sh` says so in its header comment. A hosted user running four
accounts opens four tabs. Chrome clamps `setTimeout` to 1/sec in hidden tabs
(then 1/min after ~5 min), and the game loop is `setTimeout`-driven
(`GameShell.run()` → `await sleep(ms)` → `src/util/JsUtil.ts:1`), so three of
those four tabs are permanently starved.

The MultiBox wall already solves this shape — `RenderGate` decouples draw from
logic, and `tools/multibox-test.ts` asserts background slots draw ≤15 fps while
both logic loops hold ≥25 fps — but it only ships to local engines
(`deploy-local.sh`) or runs via `bun run b0t` (live-proxy + Electron).

## Decision

Serve the wall **same-origin from the engine image**, at `/rs2b0t/wall`.
`/rs2b0t` keeps serving the single client unchanged.

No new server, no proxy, no CORS: `/crc`, the cache WebSocket, and the game
WebSocket stay same-origin exactly as they are for the single client today. The
wall rides the existing `make build → push → deploy` pipeline and rolls back with
`make deploy TAG=<prev>`.

### Rejected alternatives

- **Separate rs2b0t origin (2004bot.com).** Decouples wall releases from engine
  releases, but goes cross-origin to `w1.rs2b2t.com`, which means
  productionizing `tools/live-proxy.ts` as an always-on hosted service. New
  infrastructure and bandwidth for no user-visible gain.
- **Electron distributable only.** `desktop/package.json` already has
  `electron-builder`, and it is the only thing that truly fixes throttling. But
  it does not serve the user who wants to click a link, and it adds release
  signing and update ownership. It remains the recommendation for unattended
  running.
- **Wall replaces the single client at `/rs2b0t`.** One canonical entry point,
  but every existing user would hit `VaultPrompt.ensureUnlocked()` — a passphrase
  gate on the encrypted `ProfileVault` — before they could add a bot. That is
  friction a one-account user does not have today.

## Changes — rs2b0t repo

### 1. `tools/pack-rs2b0t.sh` — stage the wall

Drop the `NOT the multibox wall — single instance only` comment, then:

- copy `out/multibox.js{,.map}` into `$DEST/bot/`
- copy `public-bot/multibox.html` → `$DEST/multibox.html`
- **also** copy `public-bot/bot.html` → `$DEST/bot.html`, in addition to the
  existing `$DEST/index.html`

The third item is load-bearing and easy to miss. `DomSlotOps.ts:102` resolves
every slot to `new URL('bot.html' + qs, document.baseURI).href`; under
`/rs2b0t/multibox.html` that is `/rs2b0t/bot.html`. Without the file, every slot
404s while the single client still looks healthy.

`bot.bundle.ts` already emits `out/multibox.js` (it is entrypoint 2), and
`pack-rs2b0t.sh` already runs `bun run build:bot`, so no build change is needed —
only the copy.

Extend the cache-bust `sed` to all three pages: `./bot/botclient.js` in
`index.html` **and** `bot.html`, `./bot/multibox.js` in `multibox.html`.
`botclient.js` and `multibox.js` are static assets Cloudflare caches for hours;
an unstamped page serves a stale wall after deploy.

### 2. `src/config/loginKey.ts` — same-origin fallback

`refreshLoginKey()` currently fetches `/loginkey`, which only
`tools/live-proxy.ts` serves. Prod has no proxy. Add a fallback: try
`/loginkey`, then fetch same-origin `/client/client.js` and extract the
≥250-digit run — the same technique `tools/b0t.sh:31` uses.

`parseLoginModulus` is anchored `/^\d{250,}$/` against the whole trimmed body.
That is correct for the proxy's plain-text reply and will never match inside a
JS bundle, so the fallback needs a separate unanchored extractor rather than
reusing it.

This fallback is best-effort, not a guarantee — see Risks.

### 3. `ResourcePanel` — hide unmeasurable rows on prod

The wall's resource card draws from two sources:

- **bot count and traffic** — in-page. `TrafficCollector`
  (`src/bot/adapter/TrafficAdapter.ts`) aggregates postMessage deltas published
  by each bot frame. Works hosted, unchanged.
- **CPU and memory** — polled from `/__rs2b0t/resources`, served **only** by
  `tools/live-proxy.ts:120`. Prod has no proxy; the engine 404s it.

The damage is worse than two dead rows. `refresh()` fetches the endpoint
**first**, and any failure short-circuits to `renderAll(...)`, which writes the
same text to `cpu`, `memory` **and** `traffic` (`ResourcePanel.ts:335`). The
in-page collector is only consulted further down, inside `readTraffic()`, which
that early return never reaches. So on a hosted wall the traffic row goes
`offline` too — even though it is fully measurable in the browser.

Fix it by making an **absent** monitor different from a **broken** one:

- On HTTP **404**, latch host telemetry off for the session: hide the CPU and RAM
  rows outright and keep rendering traffic from `getTrafficSnapshot()`.
- Every other failure (5xx, network error, malformed body) keeps today's loud
  behaviour untouched. A monitor that exists and is misbehaving must still say so.

Gate this on the probe, not on the build target. `deploy-local.sh` also serves the
wall straight from the engine with no proxy, so a local wall has exactly the same
absent endpoint — one rule fixes both, and no build flag has to be kept in sync
with which deployments happen to run a proxy.

Traffic rate needs a sample timestamp, which normally comes from the envelope's
`sampledAt`. With no envelope, `rateForTraffic` needs a local clock, so
`ResourcePanelOptions` gains `now?: () => number` (default `() => Date.now()`) to
keep the rate maths testable.

Row hiding needs the row elements, not just the value spans the panel holds
today: give the two `.mbx-resource-row` divs ids in `multibox.html` and add them
to `ResourcePanelNodes` as optional members.

Nothing guessed, nothing zero-substituted, no dead rows.

Do **not** answer `/__rs2b0t/resources` from the engine. The card measures *the
user's browser*; a server-side sample would be confidently wrong rather than
honestly absent, which is exactly what the existing contract sets out to avoid.

`public-bot/multibox.html` on main already carries the card markup
(`#mbx-resource-bots`, `-cpu`, `-memory`, `-traffic`) and still loads exactly one
script, `./bot/multibox.js`, so the packaging change in step 1 needs no extra
asset.

### 4. Discoverability

Add a `MultiBox` link to the single client's panel, gated on `boxId() === ''`
(`src/bot/runtime/box.ts`). The wall spawns its iframes with `?box=<account>`, so
the link renders on standalone `/rs2b0t` and not inside the wall's own slots.

The href is `./multibox.html`, **not** `./wall`. Relative resolution has to work
from both deployments off one build: from `/rs2b0t/index.html` it gives
`/rs2b0t/multibox.html`, and from local dev's `/bot.html` it gives
`/multibox.html` — both real files the engine serves by exact path. `./wall`
would resolve to `/wall` locally, which does not exist. The pretty
`/rs2b0t/wall` URL is for humans and the README; the in-client link takes the
path that needs no per-target branching.

Keeping the single client as the default costs discoverability; this is the
repayment.

### 5. `tools/hosted-wall-test.ts` — the pre-prod gate

Mirrors the recipe already in `docs/DEV.md` for proving the `prod` target
without touching prod: run `pack-rs2b0t.sh` with the **local** modulus against
the local engine, then

- load `/rs2b0t/wall`
- add two accounts, assert both reach ingame
- assert slot iframe URLs resolved under `/rs2b0t/`
- assert the resource card shows live bot count and traffic, and renders no
  `offline` CPU/RAM rows

The iframe-URL assertion is what catches the missing-`bot.html` class of bug
before it is live.

### 6. Docs

- `docs/DEV.md` — the run-modes table's hosted row becomes single **+** wall;
  write the background-throttling limit down plainly and name `bun run b0t` as
  the answer for unattended running. Extend the resource-telemetry section: a
  hosted wall measures traffic in-browser but has no host CPU/RAM source, so
  those rows are absent rather than `offline`.
- `README.md` — add the wall URL next to the existing hosted single-instance
  line.

## Changes — rs2b2t repo

### 7. `ops/Caddyfile.game`

Add, alongside the existing `/rs2b0t` and `/rs2b0t/` handles:

```
handle /rs2b0t/wall {
    rewrite * /rs2b0t/multibox.html
    reverse_proxy world1:8888
}
```

The existing matchers are exact-path, so there is no conflict, and
`/rs2b0t/bot/*` assets still fall through to the reverse proxy. The rewrite is
needed because the engine serves nested public files by exact path but does not
directory-index.

**The path must be `/rs2b0t/wall`, never `/rs2b0t/wall/`.** Both the wall's own
`./bot/multibox.js` and `DomSlotOps`' `new URL('bot.html', document.baseURI)`
are resolved relative to the browser-visible URL, not the rewritten target. From
`/rs2b0t/wall` they resolve to `/rs2b0t/bot/multibox.js` and `/rs2b0t/bot.html`,
which is correct. A trailing slash would push both a directory deeper and 404
everything. Do not add a `redir` to a trailing-slash form.

### 8. `ops/scripts/build.sh`

Extend the staging guard at line 54 to also require
`public/rs2b0t/multibox.html`, `public/rs2b0t/bot.html`, and
`public/rs2b0t/bot/multibox.js`. The existing modulus grep on `botclient.js` is
unaffected — login happens inside the slot iframe, which is `botclient.js`.

## Verification and rollout

1. Local proof: `PROD_RSAN=<local modulus> ENGINE=~/code/rs2b2t-engine sh tools/pack-rs2b0t.sh`
2. `bun tools/hosted-wall-test.ts` (new) and `bun tools/hosted-proof-test.ts`
   (existing, must still pass — the single client is unchanged)
3. `make build → push → deploy` in `~/code/rs2b2t`
4. Post-deploy by hand: `/rs2b0t/wall` with two registered accounts both ingame;
   `/rs2b0t` still serves the single client unchanged
5. Rollback: `make deploy TAG=<prev>`

Prod registration is on — no auto-create — so the post-deploy check needs real
registered accounts, as `tools/b0t.sh` notes for the Electron wall.

## Risks accepted

- **A backgrounded tab starves every box, not just the background ones.** The
  tick is `setTimeout`; `RenderGate` gates drawing only. This is still a strict
  improvement over today, where N−1 of N tabs are *permanently* starved, but it
  is not unattended-capable. Documented, not fixed. A Web Worker message clock
  would fix it (workers are exempt from background throttling, and the repo
  already ships two) — deliberately deferred.
- **Slot ceiling is unmeasured.** `multibox-test.ts` proves 2 slots; the 9-bot
  soak (`naturecrafter-soak-test.ts:113`) uses 9 separate browser contexts, i.e.
  separate renderer processes. Same-origin iframes share one main thread.
  Shipping uncapped and measuring from real use.
- **The `/client/client.js` fallback is only as fresh as the stock client.**
  `ops/scripts/build.sh:51` already warns when the stock client's modulus drifts
  from the authoritative SSM key; while that warning is live the fallback would
  read a stale value. A deliberate `rotate-login-key` should still trigger an
  rs2b0t rebuild. The fallback is a safety net, not a substitute.
- **`ProfileVault` keeps passphrase-encrypted credentials in `localStorage` on
  `w1.rs2b2t.com`** — the same origin as the stock game client. Noted; no change
  proposed.

## Out of scope

Worker-driven clock, slot caps, any change to the single client's behaviour, and
anything in the desktop Electron shell.
