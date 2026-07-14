#!/usr/bin/env bash

###############################################################################
# Cleanup Orphaned Dev Processes
#
# This script kills orphaned processes from previous `npm run tauri:dev` sessions
# that weren't properly cleaned up.
#
# Usage: ./scripts/dev/cleanup-orphans.sh [--quiet]
###############################################################################

QUIET=false
if [ "${1:-}" = "--quiet" ]; then
    QUIET=true
fi

if [ "$QUIET" != "true" ]; then
    echo "🧹 Cleaning up orphaned development processes..."
    echo ""
fi

# Count processes before cleanup
BUILD_COUNT=$(ps aux | grep "build.js --watch" | grep -v grep | wc -l | xargs)
ESBUILD_COUNT=$(ps aux | grep "esbuild --service" | grep -v grep | wc -l | xargs)
ORGII_COUNT=$(pgrep -f "ORG2 Dev" | wc -l | xargs)
# Match the real cargo invocation produced by @tauri-apps/cli, which is a
# plain `cargo run` (optionally with --features, never --no-default-features
# in this project). The old "cargo run.*no-default-features" rule matched
# nothing this repo ever spawns.
CARGO_ORPHAN_COUNT=$(pgrep -f "cargo run" | wc -l | xargs)
ORG2_BINARY_COUNT=$(pgrep -f "target/(debug|release)/org2" | wc -l | xargs)
TAURI_CLI_COUNT=$(pgrep -f "tauri-apps/cli" | wc -l | xargs)
# Prefer `ss` (present on virtually every Linux/macOS box); fall back to lsof.
PORT_PID=""
if command -v ss >/dev/null 2>&1; then
    PORT_PID=$(ss -ltnp 2>/dev/null | grep ':1998' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
elif command -v lsof >/dev/null 2>&1; then
    PORT_PID=$(lsof -ti :1998 2>/dev/null | head -1)
fi

if [ "$QUIET" != "true" ]; then
    echo "Found orphaned processes:"
    echo "  - Node build watchers: $BUILD_COUNT"
    echo "  - esbuild services: $ESBUILD_COUNT"
    echo "  - ORG2 Dev (webpack): $ORGII_COUNT"
    echo "  - Orphaned cargo run: $CARGO_ORPHAN_COUNT"
    echo "  - org2 app binary: $ORG2_BINARY_COUNT"
    echo "  - tauri-cli dev: $TAURI_CLI_COUNT"
    if [ -n "$PORT_PID" ]; then
        echo "  - Port 1998 held by PID: $PORT_PID"
    else
        echo "  - Port 1998: free"
    fi
    echo ""
fi

TOTAL=$((BUILD_COUNT + ESBUILD_COUNT + ORGII_COUNT + CARGO_ORPHAN_COUNT + ORG2_BINARY_COUNT + TAURI_CLI_COUNT))
if [ "$TOTAL" -eq 0 ] && [ -z "$PORT_PID" ]; then
    if [ "$QUIET" != "true" ]; then
        echo "✅ No orphaned processes found. System is clean!"
    fi
    exit 0
fi

# Kill orphaned processes
if [ "$QUIET" != "true" ]; then
    echo "Killing orphaned processes..."
else
    SUMMARY_PARTS=""
    [ "$BUILD_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS build-watchers=$BUILD_COUNT"
    [ "$ESBUILD_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS esbuild=$ESBUILD_COUNT"
    [ "$ORGII_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS orgii-dev=$ORGII_COUNT"
    [ "$CARGO_ORPHAN_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS cargo=$CARGO_ORPHAN_COUNT"
    [ "$ORG2_BINARY_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS org2-bin=$ORG2_BINARY_COUNT"
    [ "$TAURI_CLI_COUNT" -gt 0 ] && SUMMARY_PARTS="$SUMMARY_PARTS tauri-cli=$TAURI_CLI_COUNT"
    [ -n "$PORT_PID" ] && SUMMARY_PARTS="$SUMMARY_PARTS port-1998=$PORT_PID"
    echo "🧹 Cleanup:${SUMMARY_PARTS}"
fi

if [ "$BUILD_COUNT" -gt 0 ]; then
    pkill -f "build.js --watch" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $BUILD_COUNT build watchers"
fi

if [ "$ESBUILD_COUNT" -gt 0 ]; then
    pkill -f "esbuild --service" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $ESBUILD_COUNT esbuild services"
fi

if [ "$ORGII_COUNT" -gt 0 ]; then
    pkill -f "ORG2 Dev" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $ORGII_COUNT ORG2 Dev processes"
fi

if [ "$CARGO_ORPHAN_COUNT" -gt 0 ]; then
    pkill -f "cargo run" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $CARGO_ORPHAN_COUNT orphaned cargo run processes"
fi

if [ "$ORG2_BINARY_COUNT" -gt 0 ]; then
    pkill -f "target/(debug|release)/org2" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $ORG2_BINARY_COUNT org2 app binary processes"
fi

if [ "$TAURI_CLI_COUNT" -gt 0 ]; then
    pkill -f "tauri-apps/cli" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Killed $TAURI_CLI_COUNT tauri-cli dev processes"
fi

if [ -n "$PORT_PID" ]; then
    kill -9 "$PORT_PID" 2>/dev/null || true
    [ "$QUIET" != "true" ] && echo "  ✓ Freed port 1998 (killed PID $PORT_PID)"
fi

# Wait a moment for processes to die
sleep 1

# Verify cleanup
if [ "$QUIET" != "true" ]; then
    echo ""
    echo "Verification:"
fi
BUILD_AFTER=$(ps aux | grep "build.js --watch" | grep -v grep | wc -l | xargs)
ESBUILD_AFTER=$(ps aux | grep "esbuild --service" | grep -v grep | wc -l | xargs)
ORGII_AFTER=$(pgrep -f "ORG2 Dev" | wc -l | xargs)
CARGO_AFTER=$(pgrep -f "cargo run" | wc -l | xargs)
ORG2_BIN_AFTER=$(pgrep -f "target/(debug|release)/org2" | wc -l | xargs)
TAURI_CLI_AFTER=$(pgrep -f "tauri-apps/cli" | wc -l | xargs)
PORT_AFTER=""
if command -v ss >/dev/null 2>&1; then
    PORT_AFTER=$(ss -ltnp 2>/dev/null | grep ':1998' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
elif command -v lsof >/dev/null 2>&1; then
    PORT_AFTER=$(lsof -ti :1998 2>/dev/null | head -1)
fi

if [ "$QUIET" != "true" ]; then
    echo "  - Remaining build watchers: $BUILD_AFTER"
    echo "  - Remaining esbuild services: $ESBUILD_AFTER"
    echo "  - Remaining ORG2 Dev: $ORGII_AFTER"
    echo "  - Remaining cargo run: $CARGO_AFTER"
    echo "  - Remaining org2 binary: $ORG2_BIN_AFTER"
    echo "  - Remaining tauri-cli: $TAURI_CLI_AFTER"
    echo "  - Port 1998: ${PORT_AFTER:-free}"
    echo ""
fi

REMAINING=$((BUILD_AFTER + ESBUILD_AFTER + ORGII_AFTER + CARGO_AFTER + ORG2_BIN_AFTER + TAURI_CLI_AFTER))
if [ "$REMAINING" -eq 0 ] && [ -z "$PORT_AFTER" ]; then
    if [ "$QUIET" != "true" ]; then
        echo "✅ Cleanup successful! All orphaned processes removed."
    fi
else
    echo "⚠️  Cleanup left running processes: build-watchers=$BUILD_AFTER esbuild=$ESBUILD_AFTER orgii-dev=$ORGII_AFTER cargo=$CARGO_AFTER org2-bin=$ORG2_BIN_AFTER tauri-cli=$TAURI_CLI_AFTER port-1998=${PORT_AFTER:-free}"
    echo "   If you're not running dev server, try running this script again."
fi

exit 0
