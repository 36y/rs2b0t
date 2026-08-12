[Manual](README.md) › Dev and deploy

# Dev and deploy

| Mode | Command | Serves | Target | Docs |
|---|---|---|---|---|
| Local engine | `sh tools/deploy-local.sh` | single + wall | same-origin on your engine | [Running locally](how-to/run-locally.md) |
| Live wall | `bun run b0t` | wall through a local proxy | production | [Run the live wall](how-to/run-the-live-wall.md) |
| Hosted (prod) | `make deploy` | single (`/rs2b0t`) + wall (`/rs2b0t/wall`) | same-origin at `w1.rs2b2t.com/rs2b0t` | [Maintainer infrastructure](how-to/maintainer-infra.md) |

## Pages

| Page | Covers |
|---|---|
| [Run the live wall](how-to/run-the-live-wall.md) | viewers, DevTools wiring, the checkout-wide launcher lock |
| [Build targets](reference/build-targets.md) | `local`, `live`, `prod` and how the client resolves its server |
| [Maintainer infrastructure](how-to/maintainer-infra.md) | the maintainer engine, the prod hosting pipeline, identifying the live commit |
| [GatheringBot smoke](how-to/gatheringbot-smoke.md) | running the behaviour smoke |
| [Gathering seed data](reference/gathering-seeds.md) | location seed coords, tick manip |
