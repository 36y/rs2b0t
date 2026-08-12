[Manual](../README.md) › [Architecture](../ARCHITECTURE.md) › Import fences

# Import fences

Two `no-restricted-imports` groups in [`eslint.config.ts`](../../eslint.config.ts)
declare the layering.

| Fence | Applies to | Message |
|---|---|---|
| Client internals | `src/bot/**`, except `src/bot/adapter/**` and `src/bot/runtime/BotClient.ts` | `Only src/bot/adapter/ may touch client internals.` |
| DOM | `src/bot/**`, except `src/bot/ui/`, `src/bot/main.ts`, and `src/bot/multibox/{DomSlotOps,ProfileChooser,VaultPrompt,main}.ts` | `DOM only in src/bot/ui/, main.ts, and src/bot/multibox/…` |

Exempt from the client fence: the protocol const-enums `ServerProt`, `ClientProt`,
`CollisionFlag` and `MiniMenuAction`. They are inlined at build time and carry no runtime
coupling.

Four imports carry a line-scoped `eslint-disable-next-line` with a TODO, in
`nav/pathScenePaint.ts`, `nav/worldStateLive.ts` and `ui/basemapRegen.ts`. They predate
the fence firing and need adapter accessors. The disables are per line rather than per
file, so a new client import in those files still errors.

## The fence was inert until 2026-08-11

Every pattern began with `#` (`#/client/*`, `#3rdparty/*`, …), and ESLint compiles
`no-restricted-imports` group patterns with gitignore semantics, where a leading `#`
marks a comment line. The whole group was discarded at config load, so the fence never
fired once. The patterns are escaped (`'\\#/client/*'`) and it now errors.

Two bypasses survive the escape:

- `patterns` does not cover dynamic `import()`.
- The DOM fence's `no-restricted-globals` is laundered by
  `(globalThis as {document?: Document}).document`.

## See also

- [Architecture](../decisions/architecture.md)
