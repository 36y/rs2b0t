# rs2b0t — Dev & Deploy

The rs2b0t bot client has **three canonical run modes**, one command each.

| Mode | Command | Client | Serving / origin |
|---|---|---|---|
| **Local dev** | `sh tools/deploy-local.sh` | single (`/bot.html`) or wall (`/multibox.html`) | local engine at `localhost:8890` |
| **Wall vs live** | `bun run b0t` | multibox wall | local client + reverse proxy → `w1.rs2b2t.com` |
| **Hosted (prod)** | `make deploy` *(in `~/code/rs2b2t`)* | single instance (`/rs2b0t`) | **same-origin** at `w1.rs2b2t.com/rs2b0t` |

## Live wall viewers and resource telemetry

The multibox rail shows current bot count, CPU, RAM, and bot traffic. On Linux, every
managed viewer is launched in its own transient systemd cgroup-v2 scope: CPU is the
delta of cumulative `cpu.stat usage_usec`, and RAM is `memory.current`. Those counters cover every browser
thread/process and remain valid when Firefox/Chrome creates or exits content processes.
On macOS, the monitor uses the dedicated viewer's process tree instead. Each bot client
and cache worker counts its actual WebSocket application payload in both directions and
publishes deltas to the wall, which means direct production sockets are included even
when they bypass the local proxy. HTTP assets, headers, and transport overhead are not
counted. The card updates once per second by changing its own text only — it never reloads
or reparents a bot iframe.

The card never substitutes guessed or zero values for missing telemetry. `measuring…`
means a real second sample is still pending; `unavailable` identifies
a metric whose source cannot currently be measured; `offline` means the resource
endpoint cannot be reached; and `monitor error` means its response was invalid. Traffic
shows numeric `0 B/s` after two unchanged browser-counter samples while at least one bot
publisher is present. An empty wall reports that no publisher appeared. There are no
last-known values, host/headroom estimates, or zero-value substitutes for missing data.

```bash
bun run b0t                         # dedicated Electron viewer (default)
B0T_VIEWER=chrome bun run b0t       # dedicated Chrome; CDP listens on :9223
B0T_VIEWER=firefox bun run b0t      # dedicated Firefox profile
B0T_VIEWER=none bun run b0t         # proxy only; CPU/RAM unavailable
```

For Chrome DevTools MCP, launch the managed Chrome viewer and configure MCP with
`--browser-url=http://127.0.0.1:9223`. Set `B0T_CDP_PORT` to choose another loopback
port. A dedicated profile is intentional: an ordinary shared browser process includes
unrelated tabs and cannot provide honest bot-only CPU/RAM attribution.

Firefox DevTools MCP must likewise use a dedicated profile. Point its `--firefox-path`
at `tools/firefox-cgroup-wrapper.sh`; the wrapper puts Firefox alone in an
`rs2b0t-viewer-*` cgroup while leaving geckodriver/MCP outside the measurement. Do not
attach an automation agent to an everyday Firefox profile: it exposes that profile's
cookies and sessions, and its other tabs/extensions would contaminate capacity numbers.

For an externally managed *dedicated* browser, use
`B0T_RESOURCE_PID=<browser-root-pid> B0T_VIEWER=none bun run b0t`. On Linux that browser
must already be in an `rs2b0t-viewer-*` cgroup (the Firefox MCP wrapper does this);
otherwise CPU/RAM are explicitly unavailable instead of silently including the terminal
or unrelated tabs.

The managed viewer and local proxy have separate lifecycle states:

- While the Electron/Chrome/Firefox viewer is running, its PID is registered and the
  CPU/RAM rows become live after the first sampling interval.
- If that viewer closes or crashes, the launcher immediately unregisters its PID and
  reports CPU/RAM as unavailable. The proxy deliberately remains available on `PORT`, so
  another already-loaded wall is not cut off merely because the managed window exited.
  The launcher continues supervising the proxy until the proxy exits or you explicitly
  stop it with Ctrl-C/TERM.
- If the proxy exits while a managed viewer is still open, the launcher reports the
  failure, closes and reaps only that owned viewer, and exits nonzero.
- `B0T_VIEWER=none` remains proxy-only. With `B0T_RESOURCE_PID`, it observes that
  externally managed dedicated browser; without one, CPU/RAM stay unavailable. The
  launcher never owns or kills an external PID.

Shutdown cleanup signals only the exact managed viewer and proxy child PIDs launched by
that invocation; it never searches for or kills a shared Firefox/Chrome process.

An atomic checkout-wide launcher lock is held from before the build through shutdown, so
a second `b0t` cannot rebuild the shared `out/` even on a different port. A healthy HTTP
responder on the requested port also aborts startup regardless of its response status.
Source edits are not hot-loaded into an already-open wall; activate them at the next
planned launch rather than refreshing active bots.

## Build targets (`bot.bundle.ts`, `src/config/target.ts`)

The bundle bakes a server target (`TARGET=…`) that fixes how the client resolves the
game WebSocket host and which RSA login modulus it uses:

- **`local`** (default) — **same-origin**: `wsHost = window.location.host`. Local dev key;
  set the public `LOCAL_RSAE` and `LOCAL_RSAN` values when using a stock engine key.
- **`live`** — hardcodes `w1.rs2b2t.com` + `wss`. Used with the local reverse proxy
  (`tools/live-proxy.ts`) for running a local client against production. Key via
  `LIVE_RSAN`.
- **`prod`** — **same-origin** like `local`, but bakes the **production** modulus via
  `PROD_RSAN`. This is the client hosted *on* the game server (`w1.rs2b2t.com/rs2b0t`);
  because it is served from the game origin, `/crc` + the cache/game WebSockets are all
  same-origin and **no proxy is involved**. The build aborts if `PROD_RSAN` is unset.

## Hosting the single client (prod)

The single-instance client is served same-origin from the engine at
`w1.rs2b2t.com/rs2b0t`. It is baked into the **engine image** at build time (in
`~/code/rs2b2t`), not deployed separately:

1. `tools/pack-rs2b0t.sh` builds `TARGET=prod` and stages a **self-contained** subtree
   into a target engine's `public/rs2b0t/` (`index.html` + `bot/` assets; single instance
   — no multibox). Because `bot.html` loads assets relatively (`./bot/…`), the subtree
   works under `/rs2b0t/` with no path rewrites.
2. `~/code/rs2b2t` `ops/scripts/build.sh` extracts the prod login modulus from the staged
   engine's `public/client/client.js` (the ≥250-digit run), runs `pack-rs2b0t.sh` with it,
   and guards that the client staged + the baked modulus matches the engine's.
3. `ops/Caddyfile.game` rewrites the clean `/rs2b0t` URL to `/rs2b0t/index.html` (the engine
   serves nested public files by exact path but does **not** directory-index).
4. `make build → push → deploy` ships it. Rollback: `make deploy TAG=<prev>`.

Verify locally without touching prod: run `pack-rs2b0t.sh` with the **local** modulus
against the local engine, then `bun tools/hosted-proof-test.ts` — it proves the `prod`
target resolves same-origin and logs in with no proxy.

## Local-engine test tricks

- Engine at `~/code/rs2b2t-engine`: `npm run quickstart` (web `:8890`). Deploy the client
  with `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`.
- The engine uses a **rotated 1024-bit RSA login key** (not the upstream 512-bit default);
  the matching modulus is baked into the `local` target. A stock-key client gets login
  code 6 unless `LOCAL_RSAE` and `LOCAL_RSAN` are supplied to `deploy-local.sh`.
- Cheats/debugprocs (staffModLevel 4 locally): `::tele 0,mx,mz,lx,lz`, `::~maxme`,
  `::~item <objname> <count>`, `::~bankitem`, `::~spawnloc <locname>`. `::~maxme`'s
  level-up dialogs swallow the next typed command — do cheats on the clean post-relogin
  state, or clear dialogs first.
- Headless harness ABI: `globalThis.rs2b0t` (`.client`, `.runner`, `.reader`, `.registry`,
  `.actions`). Boot when `rs2b0t.client.constructor.loopCycle > 10`; login auto-creates a
  local account. See `tools/*-test.ts` for the pattern.
- `bun run smoke` — the full live smoke fleet against the local engine (deploys once,
  then every `tools/*-test.ts` sequentially, hours; per-smoke logs in `out/smoke-logs/`).
  `--list` / `--only <substr>` / `--skip <substr>` subset it; SPECIAL-environment smokes
  (desktop/hosted/multibox/e2e/rendergate + dev harnesses) are excluded automatically.
