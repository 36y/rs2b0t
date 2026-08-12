[Manual](../README.md) › [Testing](../TESTING.md) › End-to-end suite

# Run the end-to-end suite

`bun run e2e` runs the offline gates, deploys once, then runs the harnesses sequentially
and writes a report that diffs against the previous run.

## Run it

```sh
bun run e2e                     # quick
bun run e2e -- --level smart    # only what the working diff can affect
bun run e2e -- --level full     # every harness, quests included
bun run e2e -- --gates-only     # offline gates, no engine needed
bun run e2e -- --only troll,horror
bun run e2e -- --verbose        # stream every child line
```

Exit code is 1 when anything is failing, so it drives a cron or a CI job directly.

## Levels

| Level | Contains | Rough cost |
|---|---|---|
| `quick` | offline gates plus the 33 non-quest `-test.ts` harnesses | ~20 min |
| `smart` | offline gates plus whatever the working diff can affect | varies |
| `full` | all 77 harnesses, including the 10 stage-driven quest runs | overnight |

`smart` selects a harness when one of its filename tokens appears in a changed path, and
adds the nav harnesses when anything under `src/bot/nav/` changed. A change to shared
code — `adapter/`, `runtime/`, `api/` or `package.json` — can reach anything, so it
selects everything rather than pretending to be clever. The report states which rule
fired.

Quest harnesses are identified by taking `--stage`, so a new one lands in the right level
without editing a list.

## Watching it run

| Mode | Shows |
|---|---|
| Terminal (TTY) | one status line per item, rewritten in place with elapsed seconds and the child's most recent output line |
| Piped or cron | the same line, printed every 30 seconds, so a log records progress without carriage returns |
| `--verbose` / `-v` | every line the child emits, prefixed |

Full child output always reaches `out/e2e/logs/<harness>.log` regardless of mode.

## The report

`out/e2e/report.md`, with per-harness logs in `out/e2e/logs/`.

It leads with **newly broken since the baseline**, then newly fixed, then still broken.
A suite where twelve things always fail tells you nothing; the diff against
`out/e2e/latest.json` is what identifies a regression.

The first run has no baseline, so everything failing appears under "failing, no baseline
entry".

## Prerequisites

| | |
|---|---|
| Engine | running, and matching what the harnesses expect — most default to `:8890` |
| `ENGINE_DIR` | where deploy copies to; defaults to `~/code/rs2b2t-engine` |

The deploy step rebuilds `out/botclient.js` with `TARGET=local`. A live wall serving that
same file will reject new logins until it is rebuilt with `TARGET=live`.

## Gates judged on output, not exit code

The generator drift checks print `STALE` and some then exit non-zero on an unrelated
teardown crash in the vendored audio shim. Their verdict reads the output, so a clean
generator is not reported as a regression.

## Excluded

`hosted-proof-test.ts`, `hosted-wall-test.ts` and `external-script-test.ts` need a
registered account or a second origin, so no runner can provide their environment.

## See also

- [The live-harness ABI](write-a-harness.md)
- [Test suites](../reference/test-suites.md)
