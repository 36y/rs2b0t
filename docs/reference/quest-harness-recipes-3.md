[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (N–Z)

## Pirate's Treasure — stage-scoped harness

[`e2e/piratestreasure-231-live.ts`](../../e2e/piratestreasure-231-live.ts) drives the
quest from a clean account or from any point inside it.

```sh
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 0 --until 4 --tick 300 --minutes 120   # end to end
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 0 --crate-rum 0 --until 2 # the smuggle
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 2 --crate-rum 2 --until 2 # the back room
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 2 --until 4                            # chest, note, dig
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 3 --until 4                            # the dig alone
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 2 --crate-rum 0 --until 2 # lost rum
HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 3 --crate-rum 1 --until 2 # re-smuggle
```

Measured at `--tick 300`, no parks: **8 minutes** from a clean account to quest
complete. Per leg — stage 0 to the start 1 min, the smuggle 5 min, chest to dig 4 min,
the dig alone 2 min, and each recovery path — `--employed 3 --crate-rum 1` and
`--employed 2 --crate-rum 0` — 6 min.

Three details govern this harness:

- **`--stage` alone reaches a third of the quest.** The smuggle lives in
  `%hunt_store_employed`, `%crate_rum` and `%crate_bananas` as well as `%hunt`, and a
  bare `setvar hunt 1` describes only the state before the rum is bought. Each flag is
  set and read back, because a `setvar` against a name the engine does not know is
  dropped silently.
- **Every seed relogs.** `update_questlist` recolours the journal at login only, and the
  module reads the tab rather than the varp.
- **The bank holds coins and food and nothing else.** The rum, the white apron and the
  spade all have sources in the world; seeding one hides whether the bot can find it.

It runs on `:8890` even though the quest is free-to-play: bank seeding needs `givebank`
or `~bankitem`, and the `:8888` sim answers neither.

**`--no-deploy` is only safe when nothing else is deploying.** The engine serves one
`public/bot/` bundle to every client, so a run that skips its own deploy loads whatever
the last writer left there. A parallel run here came up executing Rune Mysteries with
Plague City in its queue and no Pirate's Treasure at all — another branch's bundle,
landed between the deploy and the page load. The queue line names the build, so read it
before trusting a `--no-deploy` result.

`--employed 3 --crate-rum 1` is the one state a fresh account cannot reach on its own.
It is the re-smuggle, and the only run that exercises the `store-job` disambiguation —
see [Quest pitfalls](../decisions/quest-pitfalls-3.md).

## See also

- [Quest harness recipes (A–F)](quest-harness-recipes.md)
- [Quest harness recipes (G–M)](quest-harness-recipes-2.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
