[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (I–O)

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

## Nature Spirit — stage-scoped harness

[`e2e/naturespirit-239-live.ts`](../../e2e/naturespirit-239-live.ts), members-only,
so `:8890`:

```sh
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 0 --until 110 --minutes 120 --tick 200  # end to end
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 0 --until 40 --minutes 45 --tick 200    # camp chain
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 40 --until 75 --minutes 30 --tick 200   # ritual and grotto
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 70 --until 85 --minutes 20 --stocked    # the sickle
HEADED=1 bun e2e/naturespirit-239-live.ts --stage 85 --until 110 --minutes 30 --tick 200  # the ghasts
```

Three things it does beyond the Horror shape:

- **Sets both prerequisites.** Eligibility reads the quest-list colour, so
  `prieststart` and `priestperil` are set and the run relogs — `update_questlist`
  only recolours at login. `priestperil` goes to 61, not 60: the Salve barrier the
  route depends on is `^priestperil_access_holy_barrier`.
- **Gives the pack what the stage implies.** A mid-quest start hands over the
  ghostspeak amulet, and from stage 75 the blessed sickle and a druid pouch — both
  come from Filliman, so a run seeded past him otherwise describes an unreachable
  state. Stage 0 gets none of it, which is what makes the end-to-end run the proof.
- **`--stocked` banks a mould and a silver bar** — ordinary clutter on an
  established account, and the only way to reach the cast without the Al Kharid
  round trip. Leave it off for anything claiming the quest works.

The bank holds coins and food alone by default. Nothing seeds a pickaxe: mining
without one raises no refusal at all, so a seeded run would pass while the quest
could not mine.

Measured end to end at `--tick 200`: **19 minutes, 37 steps, no parks** — walking,
with no teleports. Roughly half of that is the Mort Myre ↔ Al Kharid round trip the
silver sickle costs.

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

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F–H)](quest-harness-recipes-2.md)
- [Quest harness recipes (P–Z)](quest-harness-recipes-5.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
