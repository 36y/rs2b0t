# Profile Vault — Passphrase Encryption for MultiBox Profiles

2026-07-24. Approved design. Follow-up to
`2026-07-24-multibox-saved-profiles-design.md` (PR #35).

## Problem

Saved profiles (usernames + passwords) sit as plaintext JSON in wall-origin
localStorage — readable forever by anything that touches the disk (backups,
disk images, any process running as the user). Encrypt them at rest in every
run mode (Electron wall and browser tab).

Explicit non-goal: protecting a live, unlocked session. Code executing in the
page (XSS, compromised dependency) or malware on the machine can read the
in-memory key and decrypted cache; no client-side scheme prevents that.

## Requirements (user-confirmed)

- Master passphrase, never stored anywhere; prompt each wall launch on first
  profile use. Derived key lives only in a JS variable (dies with the page).
- Forgotten passphrase = wipe the store and recreate profiles ("no big deal").
- Works in all modes (WebCrypto, not Electron safeStorage).

## Design

Reads stay synchronous: unlock decrypts once into an in-memory cache; all
list/upsert/remove operate on the cache, writes re-encrypt and persist.

### 1. ProfileVault (`src/bot/multibox/ProfileVault.ts`)

- States: `empty` (no store), `locked` (encrypted blob), `plaintext-legacy`
  (pre-encryption array, incl. anything adopted from the pre-#30 roster key),
  `unlocked` (key + cache in module memory).
- Stored format, same key `rs2b0t:multibox:profiles`:
  `{ v: 1, kdf: 'PBKDF2-SHA256', iter: 310000, salt: <b64 16B>, iv: <b64 12B>, ct: <b64> }`
  — AES-256-GCM, fresh random IV per write.
- API: `status()`; `setup(pass): Promise<void>` (encrypts current cache —
  legacy entries or empty list); `unlock(pass): Promise<boolean>` (GCM auth
  failure = wrong passphrase → false); `reset()` (delete store → `empty`);
  sync `list()/upsert(p)/remove(username)` that throw when not unlocked
  (upsert/remove persist via a fire-and-forget re-encrypt).
- Replaces the storage half of `runtime/Profiles.ts`; the `Profile` type and
  legacy-array parsing move here.

### 2. VaultPrompt (`src/bot/multibox/VaultPrompt.ts`)

Modal in the chooser's visual style; joins the eslint DOM allowlist.

- **set** face (states `empty`/`plaintext-legacy`): passphrase + confirm
  fields (typo insurance — a typo'd passphrase is a silent lockout next
  launch); legacy copy: "set a passphrase to encrypt your saved profiles".
- **unlock** face (state `locked`): single field, inline error + retry on
  wrong passphrase, and a "start over" link → confirm → `reset()` → set face.
- Lazy gate: no prompt at wall boot. `ensureUnlocked(): Promise<boolean>` is
  the single funnel, invoked by: chooser open, `importProfiles`, and panel
  write-back messages. Resolves false if the user dismisses the modal.

### 3. Write-back via postMessage

Iframes never hold the key. `saveProfileForBox` (runtime, called by BotPanel
Save — BotPanel unchanged) becomes:
`window.parent.postMessage({ type: 'rs2b0t:profile-save', username, password }, location.origin)`
guarded on `boxId() !== ''` and `window.parent !== window`. The wall listens,
funnels through `ensureUnlocked`, then `vault.upsert`. Runtime code no longer
touches multibox storage directly.

### 4. Migration

`plaintext-legacy` (current PR #35 array format) is adopted at the first
unlock gate via the set face — entries are encrypted in place. No silent
plaintext mode remains once profiles are touched.

## Testing

- Vault unit tests (Bun ships WebCrypto): setup→unlock right/wrong, reset,
  legacy adoption, list/upsert/remove round-trip through real AES-GCM,
  throws-when-locked, fresh IV per write.
- VaultPrompt DOM tests: set/unlock/reset faces, confirm-mismatch error.
- Chooser tests: pre-unlock the vault in setup.
- Smoke: after the hermetic clear, first `#mbx-add` click yields the set
  face — fill passphrase + confirm, then all existing gates run unchanged.

## Caveats

- Unlock is per-launch and per-tab; two wall tabs unlock independently and
  last write wins (unchanged from today).
- An unlocked page exposes key + cache to any code running in it (see
  non-goal above).
