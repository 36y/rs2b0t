[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (I–Z)

## Imp Catcher — stage-scoped harness

[`e2e/imp-catcher-230-live.ts`](../../e2e/imp-catcher-230-live.ts) drives the
quest from a clean account, or one leg of it. `--stage N` sets `%imp` and relogs;
`--beads N` seeds the first N of black, red, white, yellow into the bank so the
withdraw and hand-in legs are reachable without the farm; `--start ardougne`
drops the bot at the bank beside the imps instead of walking the 512 from
Draynor.

```sh
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 1 --beads 4 --minutes 15                  # hand-in only
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 1 --beads 3 --start ardougne --minutes 30 # one bead, farmed
HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 0 --beads 0 --minutes 90                  # end to end
```

The bank holds coins, food and the seeded beads. Every unseeded bead has an imp
to be killed for it, and seeding one hides whether the farm works. The harness
also gives and equips a Rune scimitar and an Amulet of glory; both are kill
speed, since an imp is level 2 with 8 hitpoints and a -42 attack bonus.

Measured at the default `--tick 300`:

| Recipe | Wall clock | Kills | Kills/min |
|---|---|---|---|
| `--stage 1 --beads 3 --start ardougne` | 14 min | 65 | 6.4 |
| `--stage 0 --beads 0` | 15 min | 70 | 6.2 |

Both runs took no parks, and both drew a long tail on the 5/128 roll — 65 kills
against a mean of 26 for one bead, 70 against 53 for four. The end-to-end run
made one `withdraw Coins×200`, killed imps from all nine spawns, and visited the
Wizards' Tower once.

Six facts govern this harness:

- **Each bead is 5/128 per imp kill.** All four is a coupon-collector draw over
  four independent 5/128 rolls, so the expectation is ~53 kills with a long tail.
  Read a slow run as variance until the kill counter stops moving.
- **The farm is the scrub south of Ardougne, and its nine spawns fit a 14x41
  strip.** They sit at (2632,3202), (2625,3203), (2639,3206), (2630,3210),
  (2625,3217), (2633,3222), (2639,3230), (2629,3233) and (2633,3243). One stand
  at (2632,3222) is within 21 tiles of every one of them, inside the 50-tile
  search, so the bot camps respawns rather than walking a circuit. The two
  clusters tried before it were worse for shape rather than for count: three
  Falador spawns managed ~3 kills a minute and eight Karamja spawns ringing a
  volcano managed 2.65, because the crater in the middle meant no tile saw more
  than an arc of them and only two of the eight were ever in range.
- **The floor at z 3180 keeps the next cluster out.** Nine more imps sit south
  at z 3116–3134, close enough to pull the bot 70 tiles off this strip.
- **The hand-in is 625 of walking away, across two ship fares.** The bot farms
  before it ever speaks to Mizgog — the imp drop table is unconditional — so the
  tower is one trip rather than one out and one back.
- **The engine restores its coin float on every provisioning tick.** Paying a
  30-coin fare made it walk the bot back for the 30 coins it had spent, and
  repeat, killing nothing. The module sets `ownsInventory` and fetches a
  200-coin reserve itself, never while standing on the Karamja leg of the
  crossing, which has no bank.
- **Mizgog's third quest-start option ends with his first option verbatim.** The
  sarcastic line ends with the string "Give me a quest!" and `pickPreferred`
  matches by substring, so the polite line has to come first in the `prefer` list
  or the bot takes the branch that never sets `%imp`.

South Ardougne is members ground, which costs nothing here: the world runs
`members: true` with `autoSubscribeMembers`, and the quest itself is
free-to-play wherever it is farmed.

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

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F–H)](quest-harness-recipes-2.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
