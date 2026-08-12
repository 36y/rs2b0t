[Manual](../README.md) › Loc state in the client

# Loc state in the client

What the client and adapter do today with locs that change state.

| Behaviour | Where |
|---|---|
| Timed loc changes are received and applied | `Client.locChangeCreate`, `locChangeDoQueue`, `locChangeUnchecked` |
| Applying a change removes the old loc, updates collision, installs the replacement | `Client.locChangeUnchecked` |
| `ClientAdapter.locs()` reads the resulting `World`, so a fresh query sees a tree become a stump | `ClientAdapter` |
| A stale typecode does not produce a packet — `interactWithLoc` asks `World.typeCode2` whether that exact typecode still occupies the tile | `Client.interactWithLoc`, `World.typeCode2` |

## Known gaps

- **`actions.menuAction()` returns `true` unconditionally** once in game, after calling
  the client's `doAction()` — including when the client rejected the stale loc
  internally. A `true` result means "accepted for dispatch", never "the action
  succeeded".
- **`Loc` has no `valid()`, state revision, or changed/gone distinction.**
- **The adapter represents both "scene not ready" and "no locs found" as `[]`.** The
  one-tick gap after a level change is therefore indistinguishable from a target being
  gone. Never let a blank read drive an absence decision.

## See also

- [Loc identity is a placement, not an ID](../decisions/loc-identity-model.md)
