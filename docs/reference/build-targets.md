[Manual](../README.md) › [Dev and deploy](../DEV.md) › Build targets

# Build targets

The bundle bakes a server target (`TARGET=…`) that fixes how the client resolves the
game WebSocket host and which RSA login modulus it uses:

- **`local`** (default) — **same-origin**: `wsHost = window.location.host`. Local dev key;
  Use `./tools/deploy-local-key.sh <engine>` to derive the RSA values automatically when deploying against a stock engine.
- **`live`** — hardcodes `w1.rs2b2t.com` + `wss`. Used with the local reverse proxy
  (`tools/live-proxy.ts`) for running a local client against production. Key via
  `LIVE_RSAN`.
- **`prod`** — **same-origin** like `local`, but bakes the **production** modulus via
  `PROD_RSAN`. This is the client hosted *on* the game server (`w1.rs2b2t.com/rs2b0t`);
  because it is served from the game origin, `/crc` + the cache/game WebSockets are all
  same-origin and **no proxy is involved**. The build aborts if `PROD_RSAN` is unset.

## See also

- [Run the live wall](../how-to/run-the-live-wall.md)
