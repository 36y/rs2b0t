# Code review backlog

Repository-wide review performed on 2026-08-05 at `c318dbe608c7d5fb6b758af33c0a1c507a36ff7c`.
CI restoration and danger-zone escape behavior are handled separately by the review PR.

## Runtime correctness

- Preserve consecutive identical `chat.message` events. The current producer uses
  `type|username|text` as its only cursor, so a repeated newest line is mistaken for
  the previous boundary.
- Give `ScriptRunner.stop()` a bounded hard-stop path. A script awaiting a promise
  outside `Execution` can otherwise remain in `stopping` indefinitely.
- Add runner tests for unresolved external promises, stop during loop execution,
  crashes, pause/resume, and cleanup ordering.

## Public API

- Generate or contract-test `packages/rs2b0t-api` against the runtime ABI.
- Add the missing `Inventory.free()` declaration and audit the remaining manually
  mirrored exports.
- Bring packages, templates, and desktop code under dedicated typecheck/lint jobs.

## Trust and security

- Warn users that URL/local external scripts execute with full page privileges and
  can read plaintext account credentials from session storage.
- Consider origin allowlisting, signatures, or isolation for third-party scripts.
- Validate `message.source` as well as origin for multibox profile-save messages.
- Upgrade Electron 33 to a currently supported major and establish an update cadence.

## Maintainability

- Split active hotspots, beginning with `GatheringBot.ts`, then `ClientAdapter.ts`,
  `WalkExecutor.ts`, and the largest live harnesses.
- Generate README/docs counts for registered scripts and tests to prevent drift.
- Decide how collision-pack integration coverage should run without regenerating the
  engine-derived pack in ordinary CI. Unit CI should keep pack-backed tests explicitly
  skipped when the artifact is absent; a manual or scheduled workflow can exercise the
  real pack when one is supplied.
