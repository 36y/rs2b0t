[Manual](README.md) › MultiBox

# MultiBox

The wall runs several accounts in **one browser tab**. That is the whole point: one
tab per account means every tab but the front one is throttled to about 1 fps and its
bot starves. In a single tab they all hold full speed while that tab is visible.

`multibox.html` locally, or `/rs2b0t/wall` on the hosted build.

## Contents

- [Slots and iframes](#slots-and-iframes)
- [Tabs](#tabs)
- [Profiles and the vault](#profiles-and-the-vault)
- [Login coordination](#login-coordination)
- [Resource telemetry](#resource-telemetry)
- [Diagnostics](#diagnostics)
- [Viewers and the launcher](#viewers-and-the-launcher)

## Slots and iframes

Each slot is an **iframe running the ordinary single-instance client** — the same
`bot.html`, unmodified. The wall is a manager around them, not a different client.
[`MultiBoxController`](../src/bot/multibox/MultiBoxController.ts) owns the model;
[`DomSlotOps`](../src/bot/multibox/DomSlotOps.ts) owns the DOM.

A slot exposes a narrow handle rather than its internals:

```ts
export interface SlotHandle {
    setRenderMode(mode: RenderMode): void;
    setCredentials(username: string, password: string): void;
    setAutoLogin(on: boolean): void;
    setLoginCoordination(coordination: LoginCoordination | null): void;
    status(): SlotStatus;
}
```

Five details that are not guessable from the outside:

- **Rail slots paint at ~1 fps; the focused slot draws every frame.** That is what
  keeps a wall affordable while preserving the original focused-client behavior.
  The rate is set inside each iframe; the logical game loop remains at full speed.
- **Rendering can be disabled per bot without changing client state.** The draw gate
  skips game and overlay paints, but keeps the iframe, canvas, complete scene, game
  loop, script, and WebSocket alive. Re-enabling therefore draws the already-current
  scene on the next frame instead of reconstructing it.
- **Tiles carry a click-catching overlay** (`.mbx-hit`) above the iframe, because a
  click that lands *in* the iframe goes to the game. The overlay is what lets clicking
  a tile switch which bot is focused.
- **Storage is boxed per account.** Same-origin iframes share one `sessionStorage`, so
  every slot would otherwise overwrite the others' credentials — see
  [per-instance storage](ARCHITECTURE.md#per-instance-storage). The wall passes
  `?box=<account>`.
- `SlotStatus.player` is the logged-in character *once known*: a bot is added empty
  and has its account typed into its own panel, so the rail tile cannot show a name
  before that.
- **The rail is keyboard navigable.** Click a bot tile, then use Up/Down to select
  its neighbour or Shift+Up/Down to move the selected bot one position. A green dot
  means the account is logged in and its script is running; every other state is gray.

Reordering slots preserves the client in each one. Rebuilding the iframe would drop
the bot's session and force a re-login.

## Tabs

The strip above the tiles ([`TabBar`](../src/bot/multibox/TabBar.ts)) groups bots
into tabs. `Main` always exists and cannot be renamed, deleted, or moved. `+` adds
a tab; the gear on the active custom tab renames or deletes it, and deleting folds
its bots into the tab to its left. Chips drag left/right to reorder. New bots join
the active tab, and dropping a bot tile on a chip files that bot there — the way
to organize bots that are already logged in.

Tabs are a visibility filter over the one rail: a hidden tile keeps its iframe,
session, and slot position, because reparenting an iframe reloads its client.
Focus and Up/Down keyboard navigation stay within the active tab; an empty active
tab leaves the main pane blank. Each tab reopens on the bot you were last looking
at there (its first bot until you pick one) — that memory is per session, not
vaulted.

A background tab's bots stop painting altogether — they run at render mode
`hidden`, which gates the same draw call the renderer switch does. That switch is
the user's and is never touched, so a bot whose renderer was already off stays
off, and returning to the tab resumes exactly what was drawing before.

The tab list, per-account membership, and the active tab persist in the encrypted
vault payload alongside the profiles — account and tab names never hit disk in
plaintext — so a reload plus "load all profiles" restores the whole wall. Deleting
a tab also clears it from saved profiles that are not currently loaded; those land
in Main.

The renderer switch intentionally retains that iframe's scene and assets. It is a
CPU optimization, not a headless-memory mode: correctness and instant restoration
take priority over reclaiming renderer memory.

## Profiles and the vault

Saved accounts live in [`ProfileVault`](../src/bot/multibox/ProfileVault.ts),
encrypted at rest in `localStorage` with **AES-GCM under a PBKDF2-derived key**
(SHA-256, 310 000 iterations, per-vault salt and IV). It uses WebCrypto, which is
native to both Bun and Chromium — no dependency.

```ts
export type VaultStatus = 'empty' | 'locked' | 'plaintext-legacy' | 'unlocked';
```

`plaintext-legacy` is the migration state: an older build stored profiles unencrypted
under a different key, and that is detected rather than silently discarded.

[`ProfileChooser`](../src/bot/multibox/ProfileChooser.ts) is the load-or-create screen
and [`VaultPrompt`](../src/bot/multibox/VaultPrompt.ts) the unlock prompt. Both are
DOM view modules, and are named explicitly in the
[DOM fence](ARCHITECTURE.md#the-fences) alongside `src/bot/ui/`.

## Login coordination

Logging a wall in is not "log everyone in at once". The production server permits
**four attempts for one client UID, then rejects the fifth** until that UID has been
idle for 15 seconds — and every attempt refreshes that server-side TTL, so the
cooldown is measured from the *latest* permit, not the first.

[`LoginCoordinator`](../src/bot/multibox/LoginCoordinator.ts) hands out permits across
every iframe in the wall to stay inside that budget:

```ts
export const LOGIN_BATCH_SIZE = 4;
export const LOGIN_ATTEMPT_SPACING_MS = 1000;
export const LOGIN_BATCH_COOLDOWN_MS = 16000;
```

Slots request a permit through the [`LoginCoordination`](../src/bot/runtime/LoginCoordination.ts)
interface, which the single-instance client also implements as a no-op — so the same
client code runs both standalone and in a wall.

## Resource telemetry

The rail shows bot count, CPU, RAM, and bot traffic
([`ResourcePanel`](../src/bot/multibox/ResourcePanel.ts)).

On Linux, every managed viewer is launched in its own transient systemd cgroup-v2
scope: CPU is the delta of cumulative `cpu.stat usage_usec`, and RAM is
`memory.current`. Those counters cover every browser thread and process, and remain
valid when Firefox or Chrome creates or exits content processes. On macOS the monitor
uses the dedicated viewer's process tree instead. Each bot client and cache worker
counts its actual WebSocket application payload in both directions and publishes
deltas to the wall, so direct production sockets are included even when they bypass
the local proxy. HTTP assets, headers, and transport overhead are not counted. The
card updates once per second by changing its own text only — it never reloads or
reparents a bot iframe.

Bot count and traffic are measured inside the browser, so they work on any wall. CPU
and RAM come from the local proxy's `/__rs2b0t/resources`; a wall served straight from
an engine (hosted, or `deploy-local.sh`) has no such endpoint, and those two rows are
hidden rather than shown as permanently `offline`. A monitor that answers but
misbehaves is a different case and still reports loudly on every row.

### Honesty rules

The card **never substitutes guessed or zero values for missing telemetry.**

| Reading | Means |
|---|---|
| `measuring…` | a real second sample is still pending |
| `unavailable` | this metric's source cannot currently be measured |
| `offline` | the resource endpoint cannot be reached |
| `monitor error` | the endpoint answered, but its response was invalid |

Traffic shows a numeric `0 B/s` only after two unchanged browser-counter samples while
at least one bot publisher is present. An empty wall reports that no publisher
appeared. There are no last-known values, no host or headroom estimates, and no
zero-value substitutes for missing data.

## Diagnostics

Resource telemetry answers "how loaded is the wall right now". Diagnostics answers the
different question that actually gets reported: **"this was fine an hour ago and now a
right-click takes two seconds — what changed?"** That is only answerable against
retained history, so diagnostics keeps its own.

Every bot times its own main-thread cost, bucketed by phase
([`PhaseTimer`](../src/bot/diag/PhaseTimer.ts)). Aggregate loop counts tell you the wall
is busy; only a per-bot breakdown tells you *which* bot to look at. All 27 iframes share
one main thread, so without attribution a stall is just "the wall is slow".

Measurement is **synchronous on purpose**. Timing an `async` body records the span's wall
time, which includes every yield to the other 26 bots — that read 4-13x high and made a
healthy wall look 130% oversubscribed. Only an uninterrupted synchronous run is
main-thread occupancy, so the timed hooks are `BotHost.onFrame()` and `onDraw()`: they are
synchronous, and they are where the cost lives (script and producer work dwarfs the
client's own loop, measured ~60x).

Samples land in fixed-capacity columnar rings
([`DiagRing`](../src/bot/diag/DiagRing.ts)) on two tiers — 1s for the last 10 minutes,
30s for the last 24 hours ([`DiagSampler`](../src/bot/multibox/DiagSampler.ts)). The
coarse tier **aggregates rather than decimates**: keeping 1 sample in 30 would discard
exactly the spikes worth having. A 27-bot wall costs about 6 MB for the full 24 hours.

Stalls are measured from *outside* the main thread. A main-thread heartbeat cannot time
the freeze it is stuck inside, so [`FreezeWatch`](../src/bot/diag/FreezeWatch.ts) reuses
the wall's worker-backed clock: the worker's timer fires on schedule and the resolve
waits for the main thread, so the overshoot past the requested delay *is* the
starvation. Each recorded stall names whichever bot and phase was executing.

Input lag is measured directly rather than inferred from CPU
([`InputLatency`](../src/bot/diag/InputLatency.ts)). Firefox has no Long Tasks API but
does implement Event Timing, which reports the number a user actually perceives as lag.

From the wall console:

| Call | Answers |
|---|---|
| `multibox.diagnostics()` | everything, JSON-safe, one call |
| `multibox.diagCompare(3600_000)` | same fields now vs an hour ago, ranked by what grew most |
| `multibox.diagDownload()` | the dump as a file |

Diagnostics follows the same honesty rules as the resource card. Unwritten ring slots
read as `NaN`, never as a real `0`. A wrong-width sample, an unknown field, a nested
phase, or a browser without Event Timing all throw — a blind sampler silently reporting
zero lag is worse than no sampler at all.

### Going deeper than the shipped metrics

The retained series names the *bot*; naming the *function* has so far needed a temporary
probe from the devtools console, wrapping a suspect and accumulating `performance.now()`
deltas. Two fixes came out of exactly that:

- **`RandomEventGuardian`** — timing the seven frame listeners individually showed one
  costing 1.5ms/frame. Its tick guard was stamped only after a successful detect, so in
  the steady state it never armed and a full scene scan ran every frame.
- **`reader.locs()`** — timing each waiter's `cond` closure showed two `Miner` predicates
  at ~3.5ms per evaluation, 93% of all condition time. The cost was the shared snapshot
  sweep, not either script.

Two lessons worth keeping. Measure the *synchronous* span: an `async` wrapper bills a bot
for time it spent yielded. And do not trust `setTimeout(0)` drift as a starvation signal —
an unfocused window clamps timers to 1/sec, which looks identical to a wedged main thread.
The worker-backed stall figure above is immune to that clamp, which is why it is the one
to read.

## Viewers and the launcher

`bun run b0t` runs the wall against live through a local proxy, in a dedicated
browser. A dedicated profile is not incidental — a shared browser includes unrelated
tabs and cannot give honest bot-only CPU/RAM attribution.

The viewer choices, the DevTools MCP wiring, the viewer/proxy lifecycle rules, and the
checkout-wide launcher lock are documented in [Dev and deploy](DEV.md#live-wall-viewers-and-the-launcher).

The wall does **not** survive being backgrounded: the game loop is `setTimeout`-driven
and Chrome clamps hidden tabs to 1/sec, so minimising it starves every bot at once.
For unattended running use the [Electron shell](../desktop/README.md), which disables
background throttling.

## See also

- [Manual index](README.md)
- [Architecture](ARCHITECTURE.md#per-instance-storage) — why storage is boxed per account
- [Dev and deploy](DEV.md) — run modes, viewers, and the hosting pipeline
- [Running locally](RUNNING.md#the-multibox-wall) — opening a wall
- [`desktop/README.md`](../desktop/README.md) — the unthrottled shell
