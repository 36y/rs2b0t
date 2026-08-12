[Manual](../README.md) › [Testing](../TESTING.md) › Suites

# Test suites

```sh
bun test                 # everything — 1303 tests across 139 files
bun test test/nav        # one directory
bun test test/docs       # the manual's own integrity
```

| Directory | Files | Covers |
|---|---|---|
| [`test/scripts/`](../../test/scripts/) | 26 | per-bot decision logic |
| [`test/quests/`](../../test/quests/) | 26 | quest `decide()` branches, engine, primitives |
| [`test/api/`](../../test/api/) | 16 | the scripting surface |
| [`test/bot/`](../../test/bot/) | 13 | base classes, paint, combat, nav |
| [`test/clues/`](../../test/clues/) | 10 | clue db, executor, solvers |
| [`test/multibox/`](../../test/multibox/) | 9 | slots, vault, login coordination |
| [`test/runtime/`](../../test/runtime/) | 8 | scheduler, registry, settings |
| [`test/tools/`](../../test/tools/) | 8 | tooling libraries, including doc links |
| [`test/ui/`](../../test/ui/) | 6 | panel and overlay |
| [`test/nav/`](../../test/nav/) | 4 | path math, reach, walk ladder |
| [`test/shops/`](../../test/shops/) | 4 | stock model, ring logic |
| [`test/config/`](../../test/config/) · [`test/events/`](../../test/events/) · [`test/input/`](../../test/input/) · [`test/io/`](../../test/io/) · [`test/client/`](../../test/client/) · [`test/util/`](../../test/util/) · [`test/docs/`](../../test/docs/) | 1–2 each | targeted |

### Collision pack (nav)

`out/collision.lcnav.gz` is gitignored. Pack-backed nav tests use
`test.skipIf(!HAS_COLLISION_PACK)` so a fresh checkout reports **skipped** coverage,
not silent green passes (#341). Build the pack via
[`tools/nav/build-collision.ts`](../../tools/nav/build-collision.ts) or
[`tools/deploy-local.sh`](../../tools/deploy-local.sh), then re-run `bun test test/nav`.

## See also

- [Why this is testable](../decisions/testability.md)
- [Write a harness](../how-to/write-a-harness.md)
