[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (A–E)

Per-quest seed and stage commands, with what each recipe has proven.

## Dwarf Cannon — stage-scoped harness

Dwarf Cannon needs no items and no prerequisite quests: the Commander issues the railings
and the tool kit, Nulodion issues the notes and the mould, and every one has a re-issue
branch. The bank seed is coins, food and a melee kit only — seeding anything the quest
hands out would hide a dialogue that never fired.

[`e2e/dwarf-cannon-254-live.ts`](../../e2e/dwarf-cannon-254-live.ts) takes `--stage N`
(`%mcannon`) and `--multi N` (`%mcannonmulti`: bits 5-10 are the six railings, bits 0-3
the four cannon components), then relogs, since `update_questlist` only recolours the
journal at login. Useful `--multi` values are `2016` for all six railings, `15` for all
four components and `2031` for both.

| Recipe | What it proves | Status |
|---|---|---|
| `--stage 1 --multi 0 --until 2` | Six railings, and the Commander accepting them | **PASS** (3min) |
| `--stage 2 --multi 2016 --until 3` | The watchtower climb, the remains, the descent | **PASS** (4min) |
| `--stage 3 --multi 2016 --until 5` | The goblin cave, the crate, the mud-pile exit | **PASS** (3min) |
| `--stage 5 --multi 2016 --until 9` | The tool kit, the shed door, the repair menu | **PASS** (7min) |
| `--stage 9 --multi 2031 --until 11` | Nulodion, and the hand-back | **PASS** (4min) |
| `--stage 4 --multi 2016 --at 2620,9797,0` | Resuming from inside the cave | **PASS** (12min, QP 0→1) |
| `--stage 0` | Start to finish | **PASS** (17min, QP 0→1) |

## Elemental Workshop — harness recipes and combat floor search

Polish goal (all quests with non-required combat): find the **bare minimum**
stats that still clear, record fails, then later branch tactics by power level
([Quests — proven floors](../reference/quest-eligibility.md#bot-proven-floors-polish-goal)).

| Recipe | What it proves | Status |
|---|---|---|
| Inv seed + `statsCsv=max` | Mid-quest loop | **PASS** |
| Bank seed + skills 20 + combat 40/40/25/40 | Low combat | **FAIL** (Water elemental death) |
| Bank seed + skills 20 + combat 50/50/40/50 | Bare-min combat (so far) | **PASS** (~270s, `givebank` seed) |
| Bank seed + combat 45/45/30/45 | Next lower probe | not run yet |
| Official skills only (20/20/20) | Server eligibility | required; combat not gated |

Constants:
[`EW_PROVEN_COMBAT_FLOOR`](../../src/bot/api/ai/quests/defs/elementalworkshop/supplies.ts)
(50/50/40/50), `EW_FAILED_COMBAT` (40/40/25/40), `EW_PROBE_COMBAT` (45/…),
`EW_OFFICIAL_SKILLS`. `warnReadiness` logs if the account is below the proven floor.

The ideal smoke run is this:

```sh
HEADED=1 bun e2e/aio-quest-test.ts http://localhost:8890 ew1 elemental_workshop 15 \
  'knife:1,hammer:1,bronze_pickaxe:1,thread:1,leather:1,needle:1,coal:4,lobster:15,steel_scimitar:1' \
  max Lobster 'speed 300' '2716,3481'
```

Realistic bank-seed at **proven floor** (safe default for writers):

```sh
HEADED=1 bun e2e/aio-quest-test.ts http://localhost:8890 ewreal elemental_workshop 25 \
  'bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:thread:2,bank:leather:1,bank:needle:1,bank:coal:8,bank:lobster:20,bank:steel_scimitar:1,bank:coins:50000' \
  'mining:20,smithing:20,crafting:20,attack:50,strength:50,defence:40,hitpoints:50' \
  Lobster 'speed 300' '2725,3491'
```

## Ernest the Chicken — stage-scoped harness

[`e2e/ernest-chicken-229-live.ts`](../../e2e/ernest-chicken-229-live.ts) drives
the quest from a clean account, or one stage of it. `--stage N` sets
`%haunted` and relogs; the module reads the quest tab, not the varp.

```sh
HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 0 --until 3 --minutes 90   # end to end
HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 2 --until 3 --minutes 60   # the three parts
HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 1 --until 2 --minutes 20   # Oddenstein, on L2
HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 2 --until 3 --poisoned     # Search-first branch
```

The bank is seeded with coins and food and nothing else. The spade, poison, fish
food and closet key all have sources in the world, and seeding one hides whether
the bot can find it.

Measured end to end at the default `--tick 300`: **11 minutes** from a clean
account, no parks.

Three details govern this harness:

- **`--poisoned` sets `haunted_manor_fountain_poisoned`.** The gauge leg Searches
  the fountain first and only fetches poison and fish food if the piranhas bite,
  because the latch is not readable. A fresh account always takes the bitten
  branch, so the other half is only reachable on a resume — or with this flag.

- **Stats are set to 70, not `~maxme`.** A maxed account hides reach and damage
  problems, and nothing in Draynor Manor is aggressive anyway — the only
  guaranteed damage in the quest is the 1 hp piranha bite from searching the
  fountain before it has been poisoned.
- **It runs on :8890 even though Ernest is free-to-play.** The quest needs
  nothing members-only, but *bank seeding* does: the :8888 sim answers neither
  `givebank` nor `~bankitem`, so a run there starts with an empty bank and parks
  on the food float.

Next lower probe (update `EW_PROVEN_COMBAT_FLOOR` only if green):

```sh
HEADED=1 bun e2e/aio-quest-test.ts http://localhost:8890 ewprobe elemental_workshop 25 \
  'bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:thread:2,bank:leather:1,bank:needle:1,bank:coal:8,bank:lobster:25,bank:steel_scimitar:1,bank:coins:50000' \
  'mining:20,smithing:20,crafting:20,attack:45,strength:45,defence:30,hitpoints:45' \
  Lobster 'speed 300' '2725,3491'
```

Expect `check the bank` / `withdraw` after book/key. After journal **ENTERED**,
death recovery re-enters with **Push** (no key) and re-withdraws bank tools.

## See also

- [Quest harness recipes (F–H)](quest-harness-recipes-2.md)
- [Quest harness recipes (I–Z)](quest-harness-recipes-3.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
