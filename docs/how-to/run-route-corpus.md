[Manual](../README.md) › [World-walking](../NAV.md) › Route corpus

# Route corpus and HARD stress

The script-route corpus ranks hard OD pairs for live regression walks. Artifacts
are **generated and gitignored** — regenerate before `HARD=1` live runs.

| Artifact | Role |
|---|---|
| `tools/nav/script-routes.generated.json` | Full successful probe set after endpoint + corridor dedupe (gitignored) |
| `tools/nav/script-routes.hardest.json` | Top-N by difficulty for live HARD walks (gitignored) |

**Generate (requires collision pack):**

```bash
bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --write --hardest=25
# optional: --no-tele for pure-walk ranking; tele ranking is default (full runes)
```

Probe WorldState is a **maxed members account** (skills 99 for guild doors, transport
quests complete, runes + charged jewellery). Magic-only was insufficient: Fishing
Guild doors need fishing 68, so BANK_* → Fishing Guild exhausted the expansion
budget instead of opening the guild doors.

**Dedupe stages** (see `tools/nav/script-route-corpus.ts`):

1. **Endpoint near-dedupe** (`dedupePaths`) — drop generator twins with nearly the same directed from→to.
2. **Journey fingerprint** (`pathCorridorSignature` + `dedupeByCorridor`) —
   fingerprint is **end map-square + hop sequence** only (not start). Pure-walks
   into the same region collapse (one *→Rellekka walk); tele vs walk stay
   separate. Keep the highest-difficulty row per signature.
3. **HARD top-N** (`rankHardest`) — score cost / expansions / hop count for the live sample list.

## See also

- [Script travel OD](script-travel-od.md)
- [World-walking](../NAV.md)
