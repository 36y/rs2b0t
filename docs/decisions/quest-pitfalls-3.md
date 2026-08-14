[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: later quests

Pirate's Treasure added five, and the first three are not quest facts:

- **An NPC that blocks an action cannot always be waited out — check the arithmetic
  before writing a wait.** `dig.rs2` abandons the dig whenever
  `npc_find(coord, falador_gardener, 10, 0)` hits. The gardener spawns three tiles from
  the dig site with `wanderrange=5` and `maxrange=7`, so his distance from it never
  exceeds ten and there is no moment to wait for. Killing him is the only route, and
  the dig has to land inside his fifty-tick respawn. Read the spawn offset against
  `maxrange` before assuming patience is a strategy.
- **Clearing a blocker moves you off the tile the action needs.** The attack that
  removes the gardener walks the character to him, and `spade.rs2` fires only within
  one tile of the X, so the dig that follows answers "Nothing interesting happens." —
  and the retry kills the respawn and walks away again, a loop that never converges.
  It only looked fine on the first run because the gardener happened to be out of
  range. Anything that fights before acting has to walk back before it acts.
- **Same-named locs are the rule, and `nearest()` picks the wrong one.** Four ordinary
  crates answer `Search` within six tiles of Wydin's grocery crate, and three more
  stand beside the Blue Moon chest, so `Locs.query().name('Crate')` searches an empty
  one forever. `Reach.locOp` and `useOnLoc` take an optional exact `id`; anything whose
  display name is shared inside its own search radius has to pass it.
- **A loc that changes stage keeps its name and its op.** A banana tree renders "Banana
  Tree" with `op1=Search` from full down to `bananatreeempty`, so a name-matched pick
  re-clicks the tree it has already stripped. The five bearing ids are the filter; walking
  away to re-roll which one is nearest is not.
- **One journal page can describe two states when the varp behind it is a bitfield.**
  `%hunt_store_employed` is two bits, and `hunt_journal.rs2` prints "I have taken a job
  at Wydin's store" both when the rum is waiting in the back room and when it is still
  in the plantation crate mid-re-smuggle. Nothing in the text separates them. The module
  searches the back room and treats the rum arriving as the proof, falling through to
  the island when it does not — and each side's leg ends by crossing back, so the next
  `decide()` is never stranded on the wrong side of the water.
- **The same ambiguity turns up twice, and the same oracle settles it.** With the store
  job held, `hunt_journal.rs2` prints "I have the Karamja Rum. I should take it to
  Redbeard Frank." for *any* bottle in the pack — including one bought minutes earlier on Karamja
  that has never been smuggled. Following it walks the rum onto the boat, where the
  customs officer confiscates it, and the journal then reads lost-rum and buys another
  forever. Standing on the island is what separates the two, the same way it does for
  `store-job`. A journal line describes the varps, not the history that produced them.
- **A permission the quest granted can be revoked by the quest's own progress.** Luthas
  clears the plantation bit every time he ships a crate, so a second smuggle finds the
  crate answering "Why would I want to do that?" to a rum it accepted an hour earlier.
  The refusal is the only signal, so the leg re-hires and retries rather than reading a
  bit it cannot see.
- **A loc's own message can carry the varps the client cannot see.** Searching the
  plantation crate prints both the rum and the banana count, which is what lets the
  smuggle resume from any interruption without the module keeping a tally.

## See also

- [Per-quest](quest-pitfalls-2.md)
- [Engine behaviour](quest-pitfalls-engine.md)
- [Add a quest](../how-to/add-a-quest.md)
