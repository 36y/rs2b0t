[Manual](../README.md) › [MultiBox](../MULTIBOX.md) › Diagnose a slow wall

# Diagnose a slow wall

Resource telemetry answers how loaded the wall is right now. Diagnostics answers "this
was fine an hour ago and a right-click now takes two seconds — what changed?", which
needs retained history.

## Read the retained series

Run these calls from the wall console:

| Call | Answers |
|---|---|
| `multibox.diagnostics()` | everything, JSON-safe, in one call |
| `multibox.diagCompare(3600_000)` | the same fields now vs an hour ago, ranked by what grew most |
| `multibox.diagDownload()` | the dump as a file |

Every bot times its own main-thread cost bucketed by phase, so the breakdown names which
bot to look at. Aggregate loop counts only tell you the wall is busy.

## Attribute a cost to a function

The retained series stops at the bot. To go further:

1. Open devtools on the wall.
2. Wrap the suspect function and accumulate `performance.now()` deltas.
3. Compare per-callee totals.

Two fixes came out of that:

- `RandomEventGuardian` cost 1.5ms/frame — its tick guard was stamped only after a
  successful detect, so in the steady state it never armed and a full scene scan ran
  every frame.
- Two `Miner` predicates cost ~3.5ms per evaluation, 93% of all condition time. The cost
  was the shared `reader.locs()` snapshot sweep, not either script.

Measure the synchronous span. An `async` wrapper bills a bot for time it spent yielded.

## See also

- [Telemetry never guesses](../decisions/multibox-telemetry-honesty.md)
- [MultiBox reference](../reference/multibox.md)
