[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (G)

Per-quest seed and stage commands, with what each recipe has proven.

## Gertrude's Cat — stage-scoped harness

[`e2e/gertrudes-cat-245-live.ts`](../../e2e/gertrudes-cat-245-live.ts). Members
content, so `:8890` only — the broken fence refuses from the south on a free
world.

| Flag | Default | Purpose |
|---|---|---|
| `--stage N` | 0 | `setvar fluffs N`, then relog so the quest list recolours |
| `--until N` | 6 | stop at this stage; 6 waits for the journal to go green |
| `--tick N` | 300 | server tick in ms; 200 is the measured baseline |
| `--minutes N` | 60 | wall-clock budget |
| `--stats N` | 99 | every skill, set before the bank seed |
| `--food NAME` | Lobster | the AIO Quester's food setting |
| `--no-deploy` | off | skip the build and copy |

It deploys **its own copy of the client** through `deployIsolatedClient`:
everything in `out/` lands in `public/bot/<user>/`, and a generated
`bot-<user>.html` points at it, so a concurrent session's deploy cannot decide
what this run executes. The copy is swept on exit. `out/collision.lcnav.gz` is
baked first when it is missing, since `build:bot` does not produce it and a
client without it walks on the 52-tile scene stepper.

`--stage 4` and `--stage 5` also write `%fluffs_crate`, the packed coord that
says which crate holds the kitten. The server picks it when Fluffs eats the
sardine, so a bare `setvar fluffs 4` describes a state the quest cannot reach
and every crate reads empty. The harness seeds the **last** crate the module
searches, so a jumped stage still proves all six.

The bank seed is 2M coins and 40 lobsters. The bucket, the cow, the doogle
leaves and Gerrant's sardine all have a source in the world, and seeding one
hides whether the bot can find it.

What the legs proved, at `--tick 200` on `:8890`:

| Leg | Result | What it covered |
|---|---|---|
| 1 → 2 | PASS, 1 min | the market, the wait for the brothers to pair up, `coins 1000→900` |
| 2 → 3 | PASS, 5 min | the doogle spawns, Gerrant's sardine, the Lumbridge bucket and cow, the fence, the ladder, the milk |
| 3 → 4 | PASS, 4 min | the sardine chain on its own, and the doogle sardine |
| 4 → 5 | PASS, 2 min | the corner crate, the kitten, the hand-over |
| 4 → 6 | PASS, 4 min | the same, plus the walk out of the yard and a Maze random event on the way |
| 5 → 6 | PASS, 1 min | the reward talk, the pet kitten, the chocolate cake and stew, 1 quest point |
| 0 → 6 | PASS, 7 min | the uncheated run: 16 steps, no parks, nothing seeded but coins and food |

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S)](quest-harness-recipes-7.md)
- [Quest harness recipes (T)](quest-harness-recipes-9.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
- [Gertrude's Cat pitfalls](../decisions/quest-pitfalls-19.md)
