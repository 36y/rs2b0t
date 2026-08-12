[Manual](../README.md) › [Nav](../nav/README.md) › Client vs pack path

# Why the painted route diverges from the walk

The painted webwalker route and the tiles the client actually walks after a click come
from two different pathfinders over two different collision sources.

| Layer | Where | Algorithm | Collision source |
|---|---|---|---|
| Pack A\* | `PathFinder` / `NavWorker` | A\* over the world collision pack plus the door/transport graph | `out/collision.lcnav.gz`, baked at deploy |
| Client walk | `Client.tryMove` | BFS on the scene `CollisionMap` (104×104), cardinal and diagonal with wall flags | live scene flags from map build and locs |

Walk clicks go through `ActionRouter.driver.walk` → `actions.walkTo` →
`raw.tryMove(..., tryNearest=true, type=0)`. That is the only path the server accepts
for gameclick movement.

## Four causes of divergence

1. **Different maps.** The pack is a full-world snapshot; the client only knows the
   loaded scene.
2. **Chebyshev expand overshoots.** `expandChebyshevSegment` uses `sign(dx)*step` for
   `max(|dx|,|dz|)` steps, so uneven diagonals overshoot the waypoint. Pinned in
   `pathExpand.test.ts`.
3. **Click horizon.** The walker clicks ~20 path steps ahead; the client may route only
   partway.
4. **Projection is not the bug.** `pathScenePaint` is camera-aligned. The divergence is
   in the tile sequence.

## Limits of the dual paint

1. The client trail is the current walk-click only, not the whole remaining pack path.
2. Scene expand also feeds corridor snap, not paint alone — keep it off unless debugging.
3. Off-scene, multi-level and transport pack segments still use Chebyshev.
4. `tryMove` records at most the scene-local path (104×104).

## Status

Both toggles are experimental and ship off by default. They exist as debug aids, and
neither is intended to become default behaviour.

## See also

- [Compare pack and client paint](../how-to/compare-path-paint.md)
