# Nav (world walker)

There is **one** world walker. Historical dual-run “classic / v2” is gone.
Travel catalog and skill/quest gates are always on the stack.

**Nav teleports** (spell/jewellery inject into A*) are **opt-in**:

- Global setting **Nav teleports** (`navTeleports`) — **default off**
- URL: `?Global.navTeleports=true`
- Per-walk force on: `useTeleportCatalog: true` or `NAV_WITH_TELES`
- Per-walk force off: `useTeleportCatalog: false` or `NAV_PURE_WALK`
- When on, min route span before a tele edge is **40** Chebyshev by default

Full write-up: [docs/NAV.md § Nav teleports](../NAV.md#nav-teleports).

| | |
|---|---|
| Product manual | [docs/NAV.md](../NAV.md) |
| Nav teleports | [NAV.md § Nav teleports](../NAV.md#nav-teleports) |
| **2004 transport coverage** | [TRANSPORTS-2004.md](./TRANSPORTS-2004.md) |
| Client path vs pack paint | [CLIENT-PATH-ALIGN.md](./CLIENT-PATH-ALIGN.md) |
| Code | `src/bot/nav/` (`PathFinder`, `WalkExecutor`, `teleportCatalog`, WorldState) |
| Unit | `bun test test/nav/` |
| Pack corpus | `bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts` |

### Live operator tools (not CI)

- `tools/nav-script-routes-live.ts` — multi-OD script routes (set `LIMIT=10+`);
  HARD list from **ranked** corpus (`script-route-corpus.ts` — different tool)
- `tools/nav-script-travel-live.ts` — **scrape** every clue / gathering / quest travel OD
  (SEGMENT=`clues`|`quests`|`gathering-all`|`fishing`|`mining`|`woodcutting`|`firemaking`|`cooking`|`all`)
- `tools/nav-stress-live.ts` — teles, jewellery, paint cases
- `tools/nav-tele-smoke.ts` — Lumbridge → Varrock spell tele
- `tools/nav-path-paint-live.ts` — pack vs client segment paint

**How travel paths are chosen (per SEGMENT) + regenerate commands:**  
[docs/NAV.md § Script travel OD](../NAV.md#script-travel-od-clues--gathering--quests)

```bash
# Inspect / regenerate travel legs (optional JSON; live builds in-process)
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --stats
bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --write

# Ranked HARD routes (separate corpus)
bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --write --hardest=25

# Wipe local engine harness .sav clutter (dry-run first)
bash tools/cleanup-test-accounts.sh
```

Travel live pacing, stuck-abort, HP/energy sustain, and env flags:
[docs/NAV.md § Script travel OD](../NAV.md#script-travel-od-clues--gathering--quests).

Harnesses that exercise teles pass `useTeleportCatalog: true` on the walk (overrides
Global). `USE_TELEPORTS=0` forces pure-walk (no jewellery kit on travel-live).
