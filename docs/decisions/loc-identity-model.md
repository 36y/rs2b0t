[Manual](../README.md) › Loc identity

# Loc identity is a placement, not an ID

Adapted from an [external note](https://gist.github.com/lulwut/5636d6a3010af2646d341efa9b605599).

Do not treat an object ID as the identity of a permanent object. Four concepts stay
separate:

| Concept | Is |
|---|---|
| Placement identity | scene generation, plane, world tile, shape/type |
| Raw ID | the loc ID placed in the map, or supplied by a live update |
| Effective ID | the currently visible definition after any transform |
| Version | a monotonically changing placement/state revision |

A tree becoming a stump can mean either that the placement now contains a different raw
ID, or that the same raw placement now resolves to a different effective ID. Both look
identical to a script; the engine reaches them differently.

Why it matters here: rs2b0t wraps a real era client, so it reads that client's live
scene rather than reproducing a headless state pipeline. Whatever the engine did to
produce the change, the adapter sees the result.

This client's `LocType` format has no varp/varbit transform table, so multi-state locs
in this revision are explicit scene replacements, not the multiloc mechanism. If a later
cache revision adds transforms, resolve them in the client/config layer and export the
result — scripts must not decode cache transforms themselves, and `rawId` and
`effectiveId` would then be separate fields rather than a changed meaning for `id`.

## See also

- [Loc state in the client](../reference/loc-identity.md)
