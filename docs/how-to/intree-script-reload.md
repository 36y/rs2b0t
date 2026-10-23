# Reload InTree scripts in the live wall

## Initial installation (one restart)

Pull the feature branch and launch as usual using Git Bash:

```powershell
& "C:\Program Files\Git\bin\bash.exe" tools/b0t.sh
```

The launcher fetches the live public login key and builds the client and
reloadable InTree modules together. Keep this launcher running.

## Subsequent script edits (no game restart)

In a second PowerShell terminal in the repository root:

```powershell
bun run build:bot:scripts
```

This reads the existing `out/intree-scripts.json` build target and live
public login key, compiles the InTree entrypoint, and refuses to replace the
running host or its shared chunks. It only writes the script entrypoint and
script-side chunks. Stop the active script, wait for it to stop, then choose
**Browse → Reload InTree scripts** and start the updated script.

If a shared runtime chunk changes, the command fails before updating the
host and asks for a full rebuild/restart. Do not rerun `tools/b0t.sh` while
the wall is open: the launcher intentionally refuses overlapping launches.

**Limitations:** The scripts-only command still recompiles the shared build
in memory to verify compatibility, so it is not yet an incremental compile.
It avoids replacing the live client files. The initial client load imports
InTree registrations asynchronously. A failed script import retains the
previous registrations.

If `bun run build:bot:scripts` reports a host compatibility error, do not
click Reload. Restart only when you're ready to deploy changes to shared
client/runtime code.
