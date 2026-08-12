[Manual](../README.md) › [Quests](../QUESTS.md) › Quest state

# Why quest state is not read from varps

`reader.varp(i)` / `Game` var access reflect `client.var[]`, filled only by
`VARP_SMALL` / `VARP_LARGE` / `VARP_SYNC`. Content marks those with
`transmit=yes`. **Typical quest progress varps do not:**

| Example | Content | Transmitted? |
|---|---|---|
| `cookquest`, `zanaris`, `waterfall_quest` | `scope=perm` only | **no** |
| `elemental_workshop_bits` (id 299), watchtower bits | `scope=perm` only | **no** |
| `prince_keystatus` | `scope=perm`, no transmit | **no** (docs: do not branch on it) |
| `qp` | `transmit=yes` | **yes** — total points only |
| Rare UI/progress (e.g. some TBWT / still vars) | `transmit=yes` | **yes** — exceptions, not the rule |

A non-transmitted index reads as **0**, which is indistinguishable from “never
started.” Branching on it is not “cheating the journal” — it is reading silence.
That is why the rule is absolute for normal quest progress: **never treat
`reader.varp` as stage.**

A clean `Quests.bits()`-style API would need **Content** to set `transmit=yes`
on the progress varp(s), then a thin client wrapper. Client-only code cannot
invent server-only state.

## See also

- [Quest engine](../reference/quest-engine.md)
