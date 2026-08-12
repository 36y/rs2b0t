[Manual](../README.md) › [Nav](../nav/README.md) › Transport scope

# What counts as a transport

Every player-executable travel hop in the content pack is either routable in A\* with
honest `TransportRequires` plus an executor hop, or explicitly out of scope with a
one-line reason.

Source of truth for what exists is the deploy engine content tree (`CONTENT_DIR`), not
a wiki.

## Out of scope

| Item | Why |
|---|---|
| Fairy rings, canoes, carpets, balloons | Not in this content pack |
| Full agility courses | Training loops; only OD shortcuts are transports |
| Random-event teleports | Supervisor's job, not the planner's |
| Decorative broken ladders | No movement destination in content |

## Why disabled rows stay disabled

| Bucket | Stance |
|---|---|
| Multi-choice Climb with no up/down | Use the Climb-up/Climb-down rows instead |
| Non-traversable, no destination | Permanent won't |
| State-deferred (quest/skill) | Activate only via `stateAwareRequires`, with server evidence |
| Multi-dest ladders (Horror, Watchtower maze) | Disabled until a single destination is proven |
| Pack stand gap | Fix the pack or the stand; do not invent tiles |

A wrong destination is worse than a long walk, which is why a multi-destination hub
needs one edge per destination plus a special crossing matched on `toTile` rather than
a single ambiguous edge.

## Design rules

1. Content first — cite the `.rs2` and its constants.
2. Gate at plan time with `TransportRequires` (members, quest, skill, coins).
3. Multi-dest hubs get one edge per destination.
4. Fail closed without WorldState on requires-gated edges.
5. `loadDefaultNavEdges()` keeps NavWorker and the pack tools in sync.

Essence exits are same-origin only. The mine must never become a surface shortcut, and
the return coord is server-side (varp 64 is not on the client wire), so the bot tracks
it in `EssenceSession` set by the entry hop.

## See also

- [Transport reference](../reference/transports-2004.md)
- [Verify transport coverage](../how-to/verify-transports.md)
