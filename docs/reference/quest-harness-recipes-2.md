[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (F)

## Family Crest — stage-scoped harness

Family Crest is eleven server stages across four kingdoms, so it has its own
harness rather than a `e2e/aio-quest-test.ts` invocation:
[`e2e/family-crest-210-live.ts`](../../e2e/family-crest-210-live.ts). It seeds a
fixed bank, jumps `%crestquest`, and passes when the journal reaches `--until`.

```sh
HEADED=1 bun e2e/family-crest-210-live.ts --stage 7 --until 8 --minutes 28   # the gold mine
HEADED=1 bun e2e/family-crest-210-live.ts --stage 0 --minutes 120            # end to end
```

Two things that harness has to do and a plain `setvar` does not:

- **Relog after the stage jump.** `update_questlist` recolours the journal entry
  at login only, and every module reads the tab rather than the varp — so a
  `setvar crestquest 7` without a relog leaves the quest reading *not started*.
- **Clear `crest_spells_levers_gauntlets` too.** The lever bits and the
  four-blasts-cast bits share that varp, so a stage jump that leaves it set
  starts Chronozon already weakened and the fight proves nothing.

It is **members-only** (`map_members`), so it needs the :8890 world, not :8888.

Caleb's five cooked fish and the two rubies are bank seeds by design — no shop
in the game stocks cooked bass or shrimp, and the Ardougne gem merchant restocks
a single ruby every 60k ticks. Everything else (moulds, antipoison, blast runes,
a pickaxe) is bought live.

## Fight Arena — stage-scoped harness

[`e2e/fight-arena-233-live.ts`](../../e2e/fight-arena-233-live.ts). Members content, so
`:8890` only.

| Flag | Default | Purpose |
|---|---|---|
| `--stage N` | 0 | `setvar arenaquest N`, then relog so the quest list recolours |
| `--until N` | 14 | stop at this stage; 14 waits for the journal to go green |
| `--tick N` | 150 | server tick in ms; 150 is double speed |
| `--minutes N` | 120 | wall-clock budget |
| `--food NAME` | Lobster | the AIO Quester's food setting |
| `--no-deploy` | off | skip the build and copy |

It deploys **its own copy of the client** through `deployIsolatedClient`: everything in
`out/` lands in `public/bot/<user>/`, and a generated `bot-<user>.html` points at it. Two
runs on one engine no longer overwrite each other, and the copy is swept on exit. That
also carries `navworker.js` and `collision.lcnav.gz`, both of which this quest needs —
refusing the arena's doors changed the transport graph, and a client-only deploy leaves
the navigator on the old edges.

The bank seed is coins, food and a rune melee kit — `rune_chainbody` rather than
`rune_platebody`, which wants Dragon Slayer. Nothing the quest can find in the world is
seeded: the Khazard disguise comes from the chest, the keys from the drunk guard and the
brew from the barman.

Stage starts: 1 and 2 at the chest, 3 and 5 outside the guard door, 6 and 8 on the arena
floor, 9 in the prison cell, 10 to 12 on the arena floor.

What the legs proved, at `--tick 150` on `:8890`:

| Leg | Result | What it covered |
|---|---|---|
| 0 → 2 | PASS, 1 min | Lady Servil, the journal parse, the chest's north-only stand, the disguise, the guard door |
| 2 → 5 | PASS, 3 min | the drunk guard, the walk out for a brew (`coins 1000→995`), the keys (`khali brew 1→0, cell keys 0→1`) |
| 5 → 9 | PASS, 3 min | the keys reclaimed after a death, the cell-gate cutscene, the ogre — 10 attacks, no damage taken under Protect from Melee |
| 9 → 12 | PASS, 5 min | Hengrad's cutscene out of the cell, the scorpion, Bouncer, the agreement — hitpoints never left 99, prayer 99 → 53 |
| 12 → 14 | PASS, 2 min | both scripted doors outward, the walk to Lady Servil, `QUEST COMPLETE`, 2 quest points |
| 0 → 14 | PASS, 7 min | the uncheated run: 26 steps, no parks, nothing seeded but coins, food and a banked rune kit |

The 5 → 9 leg overshoots its `--until 8` on purpose, and a leg that starts inside a pocket
spends its first three minutes watching the engine fail to reach a bank. Both are
explained in [Fight Arena's pitfalls](../decisions/quest-pitfalls-4.md).

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (H)](quest-harness-recipes-8.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S–Z)](quest-harness-recipes-7.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
