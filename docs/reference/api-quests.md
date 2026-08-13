[Manual](../README.md) › [Scripting API](../API.md) › Quests

# Quests

## Quests

```ts
Quests.all(): { name: string; status: QuestStatus }[]
Quests.status(name: string): QuestStatus   // 'notStarted' | 'inProgress' | 'complete' | 'unknown'
Quests.journal(name: string): Promise<string[]>  // opens the quest log modal
Quests.points(): number                    // transmitted varp qp (101)
```

**What these read.** Full rationale: [Quest state](../reference/quest-engine.md#quest-state).

| Call | Source | Cost |
|---|---|---|
| `status` / `all` | Quest-tab **text colour** (`IF_SETCOLOUR`: red / yellow / green) | free — no modal |
| `points` | `reader.varp(101)` (`qp`, `transmit=yes`) | free |
| `journal` | Clicks the quest name, waits for main modal, reads scroll text | **opens the log** |

Mid-quest stage integers and bitfields live in Content as `scope=perm` varps
**without** `transmit=yes` (e.g. `cookquest`, `elemental_workshop_bits`). They
never arrive in `client.var[]`, so `reader.varp` stays `0` and must not be used
as progress. Yellow colour only means “in progress” — it does not encode which
stage. Prefer inventory / game messages / scene oracles; open `journal` only when
stage text is the sole discriminator. A future bit-level API needs Content to
set `transmit=yes` on those varps first — it is not a missing client field.

---

## See also

- [Scripting API index](../API.md)
