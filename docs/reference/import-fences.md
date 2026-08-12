[Manual](../README.md) › [Architecture](../ARCHITECTURE.md) › Import fences

# Import fences

Two `no-restricted-imports` groups in [`eslint.config.ts`](../../eslint.config.ts)
declare the layering.

| Fence | Applies to | Message |
|---|---|---|
| Client internals | `src/bot/**`, except `src/bot/adapter/**` and `src/bot/BotClient.ts` | `Only src/bot/adapter/ may touch client internals.` |
| DOM | `src/bot/**`, except `src/bot/ui/`, `src/bot/main.ts`, and `src/bot/multibox/{DomSlotOps,ProfileChooser,VaultPrompt,main}.ts` | `DOM only in src/bot/ui/, main.ts, and src/bot/multibox/…` |

Exempt from the client fence: the protocol const-enums `ServerProt`, `ClientProt` and
`CollisionFlag`. They are inlined at build time and carry no runtime coupling.

## The client fence does not currently fire

The declared patterns all begin with `#` (`#/client/*`, `#3rdparty/*`, …). ESLint
compiles `no-restricted-imports` group patterns with gitignore semantics, where a
leading `#` marks a **comment line**, so every pattern is discarded at config load and
the group matches nothing.

Verified 2026-08-11: a throwaway file under `src/bot/` importing `#/client/Client.js`
reports `quotes` and `no-unused-vars` errors but no restricted-import error.

Escaping the character (`'\\#/client/*'`) makes it fire. Doing so surfaces the
violations that accumulated while it was inert, so it is a code change, not a doc fix.

TODO: escape the patterns and fix the fallout. Tracked in the 2026-08-08 audit.

Two further bypasses survive even after escaping:

- `patterns` does not cover dynamic `import()`.
- The DOM fence's `no-restricted-globals` is laundered by
  `(globalThis as {document?: Document}).document`.

## See also

- [Architecture](../decisions/architecture.md)
