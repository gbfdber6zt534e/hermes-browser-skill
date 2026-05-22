#!/bin/bash
# start_all.sh — startet Browser Agent + Perplexity Bridge

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "═══════════════════════════════════════"
echo "  hermes-browser-skill — Start"
echo "═══════════════════════════════════════"

# Display prüfen
if [ -z "$DISPLAY" ]; then
  export DISPLAY=:0
  echo "[display] DISPLAY nicht gesetzt — verwende :0"
else
  echo "[display] DISPLAY=$DISPLAY"
fi

# Perplexity Bridge
echo "[pplx] Starte Perplexity Auth2API auf :8319 ..."
cd "$ROOT/perplexity_bridge"
node dist/index.js > "$ROOT/logs/pplx.log" 2>&1 &
PPLX_PID=$!
echo "[pplx] PID=$PPLX_PID"

sleep 1

# Browser Agent
echo "[browser] Starte Browser Agent auf :7421 ..."
cd "$ROOT/browser_agent"
python browser_server.py > "$ROOT/logs/browser.log" 2>&1 &
BROWSER_PID=$!
echo "[browser] PID=$BROWSER_PID"

sleep 2

echo ""
echo "✓ Alle Services laufen:"
echo "  WebGUI:          http://127.0.0.1:7421/gui"
echo "  Browser Agent:   http://127.0.0.1:7421"
echo "  Perplexity API:  http://127.0.0.1:8319"
echo ""
echo "Logs: tail -f logs/browser.log | logs/pplx.log"
echo "Stoppen: kill $BROWSER_PID $PPLX_PID"
echo "═══════════════════════════════════════"

# PIDs speichern
mkdir -p "$ROOT/logs"
echo "$BROWSER_PID $PPLX_PID" > "$ROOT/logs/pids.txt"

wait
