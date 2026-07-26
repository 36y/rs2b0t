#!/bin/sh
# Launch Firefox in a dedicated systemd scope so cgroup-v2 CPU and memory
# controllers are both available without including the MCP server or terminal.
set -eu

FIREFOX_BIN=${B0T_REAL_FIREFOX_BIN:-/usr/bin/firefox}
[ -x "$FIREFOX_BIN" ] || {
    echo "ERROR: Firefox not found at $FIREFOX_BIN (set B0T_REAL_FIREFOX_BIN)." >&2
    exit 1
}

command -v systemd-run >/dev/null 2>&1 || {
    echo "ERROR: Firefox resource telemetry requires systemd-run." >&2
    exit 1
}

VIEWER_SCOPE="rs2b0t-viewer-mcp-$$.scope"

# In --scope mode systemd-run replaces itself with Firefox, preserving the PID
# registered by geckodriver. Firefox and every child inherit the scope, while
# geckodriver and firefox-devtools-mcp stay outside it.
exec systemd-run --user --scope --quiet \
    --unit="$VIEWER_SCOPE" \
    --property=MemoryAccounting=yes \
    -- "$FIREFOX_BIN" "$@"
