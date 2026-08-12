[Manual](../README.md) › [Running locally](../RUNNING.md) › Ports

# Engine ports and configuration

## Defaults

| Service | Default | Serves |
|---|---|---|
| Web | 80 on macOS and Windows, 8888 on Linux | `rs2.cgi`, and `bot.html` once deployed |
| Management (`/setup`) | 8898 | reads and writes `data/config/world.json` |
| Game (node) | 43594 | the client's WebSocket target |

## Changing them

Configuration comes from a `.env` file resolved against the engine's working directory,
**not** shell environment variables — `WEB_PORT=… npx tsx src/app.ts` is silently
ignored.

```sh
cat > .env <<'ENVEOF'
WEB_PORT=8899
WEB_MANAGEMENT_PORT=8896
NODE_PORT=43596
ENVEOF
```

Precedence is `data/config/world.json` → `.env` → built-in defaults. The `.env` is
migrated into `world.json` on the next boot and **`world.json` wins from then on**, so
later `.env` edits do nothing. Edit `world.json` directly, or use the management
server's `/setup` page.

## World ready does not mean listening

The engine logs `World ready` **before** it binds the game port, so a successful-looking
log line does not mean it is up. Check for `EADDRINUSE` after it:

```
INFO  World ready: Visit http://localhost/rs2.cgi
Error: listen EADDRINUSE: address already in use 0.0.0.0:43594
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Login response code 6 | the baked modulus does not match the engine's key |
| `EADDRINUSE 0.0.0.0:43594` after `World ready` | another engine holds the game port; change ports via `.env` before first boot |
| Port changes ignored | shell environment variables were used, or `world.json` already exists and wins |
| `bot.html` returns 404 | the client has not been deployed into that engine yet |
| A second `bun run b0t` refuses to start | an atomic checkout-wide lock is held from before the build through shutdown, so a second launcher cannot rebuild the shared `out/` |
| Bots stall when the window is hidden | browser background throttling; use the [desktop shell](../../desktop/README.md) |

Source edits are not hot-loaded into an open wall. Activate them at the next planned
launch rather than refreshing active bots.

## See also

- [Run rs2b0t locally](../how-to/run-locally.md)
