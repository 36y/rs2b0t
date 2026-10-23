# Reload InTree scripts without restarting the game

The bot client and InTree registration entrypoint are built together with Bun's
ES module splitting. This ensures both use the same runtime modules and
singletons. External scripts continue using the existing library loader.

## Workflow

1. Build and launch the updated client once: `bun run build:bot:dev`.
2. Edit an InTree script under `src/bot/scripts/`.
3. Rebuild using `bun run build:bot:dev` while the client remains open.
4. Stop the active script. Wait until it is fully stopped.
5. Open **Browse → Reload InTree scripts**, select a script and press **Start**.

The reload uses a cache-busted ES module import. A failed import leaves the
previously registered scripts intact. The reload is disabled for running,
paused and stopping scripts.

**Important:** The shared host chunks must not change. If they do, the loader
will refuse to reload and request a one-time page refresh. Changes to core
client/runtime modules require a page refresh. Keep the web server serving
the generated `out/` files (including `chunks/` and
`intree-scripts.json`).

The initial client load also loads the InTree scripts asynchronously.
