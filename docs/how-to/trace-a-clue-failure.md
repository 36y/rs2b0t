[Manual](../README.md) › [Clues](../CLUES.md) › Trace a failure

# Trace a clue failure

## Read the dumped trace

`ClueTrace` records every leg of an attempt and dumps it when a trail is abandoned:

```
[rs2b0t] clue solve failed {"clueId":2713,"name":"easy map001","reason":"no Spade held",
  "lines":[{"m":"acquiring a spade — walking to (2574,3331)"},
           {"m":"no spade at (2574,3331) — trying the next spawn"}, …]}
```

The trace persists under `TRACE_STORAGE_KEY`, so it survives the bot that produced it.

## Audit the database

`tools/clues/` holds a static auditor that checks every clue is reachable and
well-formed — coordinates on walkable ground, named objects present, NPCs that exist. A
test gates it, so a content change that orphans a clue fails in CI rather than at the
dig site.

It audits the baked graph, not the server. See
[why the audit cannot catch everything](../decisions/clue-host-yielding.md#why-the-audit-cannot-catch-everything).

## See also

- [Clue reference](../reference/clues-database.md)
