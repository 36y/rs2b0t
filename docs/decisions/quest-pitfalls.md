[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: the map

Lessons each quest paid for in live runs. Stated once so the next module does not
re-pay them.

## Sealed pockets and the baked graph

areas — Grew's island, Toban's camp, the lower city, the city-guard pocket, each skavid
cave, the shaman enclave, the wizard's floor — are reachable only through a scripted
crossing that teleports the player, so nothing routes into them by walking. Two rules
fall out of that, and both were found the hard way:

- **Every branch escapes the current pocket before it acts.** A step that assumes it is
  standing on the mainland will send the walker at a tile on the wrong side of a one-way
  cave, and it will spend three passes proving it unreachable.
- **A stand tile next to an unwalkable loc is not automatically reachable.**
  [`tools/nav/probe-tile.ts`](../../tools/nav/probe-tile.ts) pathfinds to every tile a quest
  module names, from each of its regions, and is worth running before any live attempt.
  `findPath` snapping to within five tiles is a weaker claim than
  `walkResilient(radius: 2)` arriving — a wide blocker whose only open side faces
  away satisfies the first and never the second.
- **A flood over the baked graph merges components the player cannot connect.**
  Any door edge the walker can click but not *pay* — a guarded gate, a toll — makes two
  regions look like one. Watch Tower's design concluded a gold bar was unnecessary for
  this reason, and the opposite was true.

## See also

- [Engine behaviour](quest-pitfalls-engine.md)
- [More pitfalls](quest-pitfalls-2.md)
