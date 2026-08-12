[Manual](README.md) › Architecture

# Architecture

rs2b0t drives a real era client through its own action dispatch, so bot packets are
byte-identical to a human click. `src/bot/adapter/ClientAdapter.ts` is the entire
boundary between bot code and client internals.

## Pages

| Page | Covers |
|---|---|
| [Architecture](decisions/architecture.md) | the layers, interact() to packet, the ABI boundary, per-instance storage, frame-gap insurance |
| [Import fences](reference/import-fences.md) | the two lint fences, their exemptions, and the quarantined violations |
