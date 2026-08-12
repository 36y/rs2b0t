[Manual](README.md) › World-walking

# World-walking

A\* over a baked collision pack plus a door and transport graph, executed against the
real client's own movement, with stuck recovery.

## Pages

| Page | Covers |
|---|---|
| [Collision pack](reference/nav-pack.md) | the baked pack, how it is built |
| [Pathfinding](reference/nav-pathfinding.md) | A\*, danger zones, following a path |
| [Doors and crossings](reference/nav-doors.md) | doors, special crossings, exact transport loc metadata |
| [Nav teleports](reference/nav-teleports.md) | the opt-in tele layer, costs, gates, paint |
| [The world walker](reference/nav-walker.md) | arrival, Reach, stuck recovery, tuning constants, path camera |
| [Corridor snap](decisions/corridor-snap.md) | why the snap exists and the starvation case |
| [Level-change loc lag](decisions/level-change-lag.md) | why a blank scene read is not absence |
| [Route corpus](how-to/run-route-corpus.md) | the ranked corpus and HARD stress runs |
| [Script travel OD](how-to/script-travel-od.md) | clue, gathering and quest travel legs |
| [Nav operator tools](nav/README.md) | live harnesses, transport coverage |
