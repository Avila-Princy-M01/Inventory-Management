#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
if [ -d "cipher-corridor-monitor" ]; then
  cd cipher-corridor-monitor
fi

echo "======================================================================"
echo " CORRIDOR HEALTH MONITOR — NOVO NORDISK GBS"
echo " Single-Click Clean Launch Engine (macOS / Linux)"
echo "======================================================================"
echo ""

# 1. Free port 8000
echo "[1/4] Freeing Port 8000..."
if command -v fuser >/dev/null 2>&1; then
  fuser -k 8000/tcp 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
fi

# 2. Check dependencies
echo "[2/4] Verifying Python runtime and core dependencies..."
python3 -m pip install -r requirements.txt --quiet || true

# 3. Ensure dashboard_data.json exists
echo "[3/4] Verifying analytical dataset cache..."
if [ ! -f "backend/dashboard_data.json" ]; then
  python3 backend/generate_dashboard_data.py
fi

# 4. Open browser in background and start server
echo "[4/4] Launching application on http://localhost:8000..."
(sleep 1 && (xdg-open http://localhost:8000 2>/dev/null || open http://localhost:8000 2>/dev/null || true)) &
python3 backend/server.py
