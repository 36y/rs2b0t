[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (G–Z)

## Horror from the Deep — stage-scoped harness

[`tools/horror-deep-216-live.ts`](../../tools/horror-deep-216-live.ts), same shape,
also members-only:

```sh
HEADED=1 bun tools/horror-deep-216-live.ts --stage 0 --until 10 --minutes 210        # end to end
HEADED=1 bun tools/horror-deep-216-live.ts --stage 4 --until 5 --seedkit --minutes 25 # the strange wall
HEADED=1 bun tools/horror-deep-216-live.ts --stage 1 --barcrawl 0 \
  --bits horrorbridgeleft,horrorbridgeright --minutes 120                            # the barcrawl
HEADED=1 bun tools/horror-deep-216-live.ts --stage 0 --until 10 --teleports          # end to end, hops on
```

Four things it does that the Family Crest one does not:

- **Deploys `navworker.js` as well as `botclient.js`.** The transport graph is
  compiled into the nav worker, which is its own entrypoint, so a run that
  deploys only the client walks on the old edges — and the symptom is a flat
  `no path to (…): unreachable` for a route the offline probe likes.
- **Seeds every `deephorror` sub-bit that the stage implies.** The bridge, the
  key and the three lamp repairs are separate bits of one varp, so a bare
  `setvar horrorquest 4` describes a state the quest cannot reach.
- **`--seedkit` hands over the dungeon load** so a run can iterate on the wall or
  the fight without the twenty-minute Varrock round trip. It is a debugging
  shortcut: leave it off for anything that claims the quest works, or the item
  sourcing is never exercised.
- **`--teleports` turns the Global `navTeleports` setting on *and banks law
  runes*.** Both halves are load-bearing. The nav layer only injects a hop the
  live inventory can pay for, and law is the one rune the module will not shop
  for — the Magic Guild and the Mage Arena are the only two shops that stock it
  — so flipping the toggle against a bank without law measures the walking run
  again under a different name.

Measured end to end at `--tick 200`: **68 minutes walking, 45 with `--teleports`**
(16 hops — Camelot ×11, Varrock ×3, Falador, Lumbridge — and no parks).

**Pin `--tick` when you are comparing two runs.** The default is 300ms and the
end-to-end baseline was measured at `--tick 200`; a run at the default is 1.5×
slower per tick, so any wall-clock comparison against it measures the flag. Two
runs at 300ms also wedged on the first step, with Larrissa one tile away
and every `Talk-to` refused in silence — the nav probe rules out geometry (all
the tiles around her are mutually reachable at cost 1) and the engine's own
recovery named a leftover **main** modal, which refuses dialogue exactly like
this. The poll line now prints `MAIN-MODAL=<id>` whenever one is open, so the
next occurrence names the interface instead of having to be inferred.

Two more tools sit alongside it.
[`tools/horror-journal-dump.ts`](../../tools/horror-journal-dump.ts) prints the
quest journal verbatim at each stage — `~quest_journal` word-wraps the page and
re-emits the active colour tags on every line it produces, so needles have to be
written against what the client receives, not against the `.rs2`.
[`tools/nav/horror-probe.ts`](../../tools/nav/horror-probe.ts) checks every tile the
module names against a flood from the mainland, and lists the sealed pockets
deliberately so a map change fails loudly instead of quietly.

Next lower probe (update `EW_PROVEN_COMBAT_FLOOR` only if green):

```sh
HEADED=1 bun tools/aio-quest-test.ts http://localhost:8890 ewprobe elemental_workshop 25 \
  'bank:knife:1,bank:hammer:1,bank:bronze_pickaxe:1,bank:thread:2,bank:leather:1,bank:needle:1,bank:coal:8,bank:lobster:25,bank:steel_scimitar:1,bank:coins:50000' \
  'mining:20,smithing:20,crafting:20,attack:45,strength:45,defence:30,hitpoints:45' \
  Lobster 'speed 300' '2725,3491'
```

Expect `check the bank` / `withdraw` after book/key. After journal **ENTERED**,
death recovery re-enters with **Push** (no key) and re-withdraws bank tools.

**Recipe for future quest harnesses:**

1. Prefer `bank:obj:qty` / `givebank` / `~bankitem` over give→deposit loops for unstackable food.
2. Ideal smoke → realistic bank-seed → **lower non-required stats until red**;
   keep proven floor + failed floor + next probe in the module; `warnReadiness`.
3. Leave the pack empty after bank seed so provisioning runs.
4. Drain dialogs before `~bankitem`; prefer `givebank` mid-setup.
5. Assert journal complete + clean stop.
6. Later: power-level tactics (safespot vs melee) from the same skill snapshot.

- **`::death` is a clean kill** (`~damage_self(999)`): respawn is Lumbridge `(3221,3218)`,
  and `move_priciest_item_on_hero_to_death` keeps *one* of each of the three priciest items
  — so a coin stack comes back as a single coin. Use it to drive death recovery through a death
  rather than seeding a post-death pose.
- **A stage test seeds only what that stage produces, never its tools.** See
  [Quests](../how-to/add-a-quest.md) — every Watch Tower stage-10 test handed the bot
  a pickaxe, so all of them passed while the quest could not mine.
  [`tools/shilo-solo-test.ts`](../../tools/shilo-solo-test.ts) is the current worked
  example: `--stage`/`--bits` jump the quest varps, `--tele` drops the account beside
  the leg under test, and `--speed 300` runs the engine at 2× ticks.
- **Measure throughput per tick, never per hour.** A dev world does not tick at 600ms
  and `--speed` changes it again, so an actions/hour figure read off a sim is fiction.
  [`tools/roguespurse-test.ts`](../../tools/roguespurse-test.ts) reports herbs/**tick**
  from the `host.tickCount` delta, which is comparable to the engine's own limits
  (5 user events per tick) and to a real 600ms world.

## See also

- [Quest harness recipes (A–F)](quest-harness-recipes.md)
- [Seeding test accounts](seeding-test-accounts.md)
