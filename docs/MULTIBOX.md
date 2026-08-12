[Manual](README.md) › MultiBox

# MultiBox

The wall runs several accounts in one browser tab. One tab per account throttles every
tab but the front one to about 1 fps and starves its bot; in a single tab they all hold
full speed while that tab is visible.

`multibox.html` locally, or `/rs2b0t/wall` on the hosted build.

## Pages

| Page | Covers |
|---|---|
| [MultiBox reference](reference/multibox.md) | slots, tabs, the vault, login coordination, telemetry sources |
| [Telemetry never guesses](decisions/multibox-telemetry-honesty.md) | the honesty rules, and why measurement is synchronous |
| [Diagnose a slow wall](how-to/diagnose-multibox.md) | reading the retained series, naming the function |

## See also

- [Dev and deploy](DEV.md) — run modes, viewers, and the hosting pipeline
- [Running locally](how-to/run-locally.md#run-a-bot) — opening a wall
- [`desktop/README.md`](../desktop/README.md) — the unthrottled shell
