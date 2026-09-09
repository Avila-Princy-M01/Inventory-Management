#!/usr/bin/env bash
# start_tunneled.sh — Launch the Corridor Monitor with a PUBLIC HTTPS URL.
#
# Usage:
#   bash start_tunneled.sh
#
# What it does:
#   1. Starts the Flask server (backend) on 127.0.0.1:8000 if not already running.
#   2. Opens a free Cloudflare quick tunnel and prints the public URL.
#
# Notes:
#   - The public URL changes on each launch (quick tunnels are ephemeral).
#   - The app stays reachable only while this machine is on and online.
#   - cloudflared.exe is expected at /c/Users/PC/bin/cloudflared.exe (override
#     with the CLOUDFLARED env var).

set -u

CLOUDFLARED="${CLOUDFLARED:-/c/Users/PC/bin/cloudflared.exe}"
BASE_URL="http://127.0.0.1:8000"
BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"

# ── 1. Ensure the app server is running ───────────────────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE_URL/" || echo "000")
if [ "$CODE" != "200" ]; then
  echo "[start] Starting Corridor Monitor server on 127.0.0.1:8000 ..."
  (cd "$BACKEND_DIR" && python server.py > /tmp/chm_server.log 2>&1 &)
  for _ in $(seq 1 20); do
    sleep 1
    CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE_URL/" || echo "000")
    [ "$CODE" = "200" ] && break
  done
fi
if [ "$CODE" = "200" ]; then
  echo "[start] Server is up: $BASE_URL"
else
  echo "[start] ERROR: server failed to start — see /tmp/chm_server.log" >&2
  exit 1
fi

# ── 2. Open the public Cloudflare tunnel ──────────────────────────────────────
if [ ! -f "$CLOUDFLARED" ]; then
  echo "[start] ERROR: cloudflared not found at $CLOUDFLARED" >&2
  echo "[start] Download: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" >&2
  exit 1
fi

LOG=/tmp/cf_tunnel.log
echo "[start] Opening Cloudflare quick tunnel ..."
("$CLOUDFLARED" tunnel --url http://127.0.0.1:8000 --no-autoupdate > "$LOG" 2>&1 &)

PUBLIC_URL=""
for _ in $(seq 1 30); do
  sleep 2
  PUBLIC_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" | head -1)
  [ -n "$PUBLIC_URL" ] && break
done

if [ -z "$PUBLIC_URL" ]; then
  echo "[start] ERROR: tunnel did not come up — see $LOG" >&2
  exit 1
fi

echo ""
echo "==================================================================="
echo "  PUBLIC DEMO URL:"
echo "  $PUBLIC_URL"
echo ""
echo "  Local URL : $BASE_URL"
echo "  The URL changes on each launch. Keep this machine online while"
echo "  judges use the link. Stop the tunnel: taskkill //F //IM cloudflared.exe"
echo "==================================================================="
