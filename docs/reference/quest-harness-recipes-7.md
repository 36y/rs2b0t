[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (S–Z)

Per-quest seed and stage commands, with what each recipe has proven.

## Sea Slug — stage-scoped harness

[`e2e/sea-slug-259-live.ts`](../../e2e/sea-slug-259-live.ts) drives the quest from a
clean account or from any point inside it. `--stage N` writes `%seaslugquest`
straight, 0 to 11, then relogs so the quest list recolours.

```sh
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 0 --until 12 --minutes 40 --tick 200  # end to end
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 0 --until 3 --minutes 15 --tick 200   # Caroline, Holgart, the Khazard paste
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 3 --until 6 --minutes 15 --tick 200   # the ladder, the crates, Kent
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 6 --until 8 --minutes 20 --tick 200   # Bailey's torch and the rub
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 8 --until 12 --minutes 20 --tick 200  # the panel, the crane, the reward
```

The bank holds coins and food alone. The swamp paste is bought at the Khazard
counter, and the torch, the damp sticks and the broken glass all have sources on the
platform.

Measured at `--tick 200`, no parks: **5 minutes** from a clean account to quest
complete. Per leg — stages 3 to 6 in 2 minutes, stage 6 to complete in 3.

Four details govern this harness:

- **`--stage` is the raw varp.** Every step of this quest is a `%seaslugquest` write
  and nothing else, so one `setvar` seeds any point in it. The relog is what makes the
  quest list agree with the varp.
- **Stages 7-10 are seeded with an unlit torch.** Bailey replaces a lost torch on
  stages 7-9 and has no line at all on stage 10, so a torchless seed there can neither
  climb the ladder nor ask for a replacement.
- **Stats are 70 rather than maxed.** Nothing on this quest fights — every sea slug
  and fisherman is `vislevel=hide` — and the only damage in it is the 4 for climbing
  the ladder without a lit torch.
- **It fails in the first minute if the loaded bundle has no Sea Slug in its queue.**
  The engine serves one `public/bot`, and a concurrent session that deploys while this
  harness boots hands the run their branch instead.

## Shield of Arrav

Two harnesses, because one account cannot finish the quest.

[`e2e/shield-of-arrav-232-live.ts`](../../e2e/shield-of-arrav-232-live.ts) drives one gang
side. Two varps, seeded one at a time — `~completequests` opens a gang-choice dialog
nothing answers and completes nothing:

```
--gang phoenix|blackarm   which side to run
--phoenix N --blackarm N  seed both varps, then relog
--until N                 target varp value
--want-half               assert a Broken shield lands in the pack instead
```

`--want-half` exists because the half-farming legs move no varp: the chest and the
cupboard hand over an object and nothing else changes. Asserting the varp there passes
before the leg has run.

It must **not** assert `journal === 'complete'` — a lone account can never redeem. At
`--gang blackarm --blackarm 2` it seeds a `phoenixkey2` into the bank and says so: only
Straven issues one, and joining Phoenix makes Katrine refuse you, so that stage is not
self-sufficient by construction.

[`e2e/shield-of-arrav-pair-232-live.ts`](../../e2e/shield-of-arrav-pair-232-live.ts) is the
only run that turns the journal green. One `browser.newContext()` per account, because
settings live in `sessionStorage` keyed `rs2b0t:set:<Script>:<key>` and a shared context
cross-contaminates the two bots. PASS wants all four: `phoenixgang = 10`,
`blackarmgang = 4`, and both journals green.

## Tribal Totem — stage-scoped harness

[`e2e/tribal-totem-262-live.ts`](../../e2e/tribal-totem-262-live.ts) drives the quest from a
clean account, or one leg of it. `--stage N` is `%totemquest` itself and relogs.

```sh
HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 0 --until 5 --minutes 45 --tick 200  # end to end
HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 1 --until 3 --minutes 15 --tick 200  # label, crate, delivery
HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 4 --until 5 --minutes 20 --tick 200  # lock, trap, chest, hand-in
HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 4 --combo --until 5 --minutes 15     # skip the lock
```

Measured at `--tick 200` on 70 stats, no parks:

| Stages | Minutes | Covers |
|---|---|---|
| 1 → 3 | 1 | the address label, the relabel, the R.P.D.T. delivery |
| 4 → 5 | 3 | the KURT lock, the stairs trap, the chest, the ferry home |
| 0 → 5 | 4-5 | a clean account to `QUEST COMPLETE!` |

Four details govern this harness:

- **`--stage` is the varp, and 4 starts inside the mansion.** Nothing walks into Handelmort
  Mansion — its one ground-floor door opens outward only — so a stage-4 seed teleports to
  Cromperty's landing tile at (2638,3321) rather than the bank every earlier stage starts at.
- **The stairs trap bit is never seeded.** `--combo` sets bit 0 of
  `%handelmort_traps_disabled` to skip the four dials, and bit 21 is deliberately left clear:
  a run that climbs without Investigating falls into the Ardougne sewers for a fifth of its
  hitpoints, and that is the thing worth proving.
- **The bank holds coins and lobsters and nothing else.** The address label comes off a crate
  in the R.P.D.T. depot and the ferry fare comes out of the engine's coin float, so seeding
  either would hide whether the bot can find it.
- **The first Talk-to after a long walk can report unreachable.** Kangai Mau stands behind a
  counter and Cromperty wanders his own house; each cost one retry per run and neither cost a
  park. Read the second attempt's timing, not the first's.

It is members-only, so it needs the `:8890` world; the `:8888` sim also answers neither
`givebank` nor `~bankitem`, so a run there starts with an empty bank and parks on the coin
float.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (H)](quest-harness-recipes-8.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
