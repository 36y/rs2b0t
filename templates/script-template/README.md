[Manual](../../docs/README.md) › Script template

# rs2b0t script template

Starting point for a bot in its own repository, compiled against
[`@rs2b0t/api`](../../packages/rs2b0t-api/) and loaded into the client by URL. No fork
of rs2b0t is needed.

## Build

1. Copy this directory somewhere and rename it.
2. Edit `src/ExampleBot.ts`.
3. `bun install`
4. `bun run build` → `dist/bot.js`. `bun run watch` rebuilds on change.

## Load it

1. Serve `dist/bot.js` over HTTP.
2. Use **Load URL** in the client's script panel.

The bundle's default export must be a `defineBot({...})` call — that is what the
registry looks for.

## Facts

| | |
|---|---|
| `@rs2b0t/api` dependency | `file:` link to `packages/rs2b0t-api/`; repoint it if you copy the template outside this repo |
| What the shim wraps | the ABI the client installs at `globalThis.__rs2b0t` |
| When it throws | loaded outside the bot client, or the client's ABI version does not match the shim's |
| Example bot | `BoneBurier` — picks up bones near its start tile and buries them |

The example demonstrates extending `LoopingBot`, waiting for the world with
`Execution.delayUntil(() => Game.ingame(), 0)`, querying with
`GroundItems.query().name('Bones').within(10).nearest()`, verifying an action landed by
watching game state rather than assuming a click worked, and subscribing to `skill.xp`
and `inventory.changed` in `onStart`.

## See also

- [Scripting API](../../docs/API.md) — the complete surface
- [Running locally](../../docs/RUNNING.md) — getting a client up to load this into
- [Manual index](../../docs/README.md)
