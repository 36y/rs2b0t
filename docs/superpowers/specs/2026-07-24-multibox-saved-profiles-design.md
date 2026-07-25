# MultiBox Saved Profiles + Rail Drawer

2026-07-24. Approved design.

## Problem

PR #30 deleted `AccountRoster`, the wall's only cross-restart account store. Slots
now spawn with ephemeral box ids (`bot1`, `bot2`… by add order), so the existing
per-box persistence (script settings, per-bot Global overrides, last-selected
script — all localStorage under `rs2b0t:<box>:…`) no longer follows a bot across
sessions, and credentials (sessionStorage-only) never survived a restart at all.

## Requirements (user-confirmed)

- "+ add bot" prompts: load a saved profile, or create new (credentials entered
  only when creating).
- A profile's bot restores its per-script config + per-bot Global config and its
  last-selected script every time it loads.
- Resume depth: **login + arm** — auto-login with saved creds, last script
  pre-selected with saved config; the user presses Start. No auto-start.
- Wall starts **empty** every launch; profiles load only via "+ add bot".
- A drawer toggle shows/hides the right rail (bot previews).

## Design

Profiles are a thin wall-side store that rides the existing per-box persistence.
`DomSlotOps` already spawns iframes with `?box=<username>`; a stable username is
all the config machinery needs. No bot-runtime storage changes.

### 1. ProfileStore (`src/bot/multibox/ProfileStore.ts`)

- localStorage key `rs2b0t:multibox:profiles`, value `[{username, password}]`.
- Ops: `list()`, `upsert(profile)`, `remove(username)`.
- Migration on first read: if the key is absent and the legacy pre-#30 key
  `rs2b0t:multibox:accounts` exists, adopt its entries.
- Console seed API: `multibox.importProfiles(json)` (array of
  `{username, password}`) for one-time import, e.g. from
  `multibox-accounts.recovered.json` (gitignored).

### 2. Add-bot chooser (multibox.html + `src/bot/multibox/main.ts`)

- "+ add bot" opens a modal: saved-profile rows (click → load; ✕ → delete) and a
  create-new form (username + password → `upsert` then load).
- Load calls the existing `controller.add({username, password})`: creds injected
  via `handle.setCredentials`, auto-login armed, box id = username → settings and
  last script restore through existing code. Duplicate usernames stay deduped by
  the controller (no-op if already in the wall).
- Deleting a profile does not touch a running slot; it only removes the stored
  entry.

### 3. Creds write-back

Saving a login in a bot's own panel upserts the matching profile (same-origin
localStorage). Shared helper lives beside `box.ts` so BotPanel doesn't import
multibox code; it writes only when `boxId()` is non-empty (standalone bot.html
tabs are unaffected).

### 4. Rail drawer

- Slim handle on the rail edge toggles collapsed/expanded.
- Collapsed: rail width → handle only, tile mirroring loop paused (bots keep
  ticking); main pane takes the full width.
- State persisted in wall localStorage.

### 5. Amendments (user-requested during execution)

- Rail collapses by width, not `display: none` — the focused slot's fixed clip is
  a rail descendant and `display: none` blanked it. Handle sits at the top edge.
- Each rail tile carries a ✕ in its cap that removes the bot (`controller.remove`).
- The chooser has a "load all profiles" button that loads every saved profile
  (controller dedup makes already-loaded ones a no-op).

## Testing

- Unit (happy-dom, existing multibox test pattern): ProfileStore
  (list/upsert/remove/migration), chooser wiring (load path passes creds, create
  path persists), write-back helper, drawer state.
- Smoke: extend `tools/multibox-test.ts` — add one bot via create-new and one via
  the profile list; assert both reach ingame with the right box ids; keep the
  existing throttle/switch assertions green.
- Live: manual wall run from the main checkout.

## Caveats

- Passwords are plaintext in wall-origin localStorage — same posture as the
  pre-#30 roster.
- Profiles are per-origin (`localhost:8081` proxy vs local engine vs hosted are
  separate stores). The proxy port is stable by default.
