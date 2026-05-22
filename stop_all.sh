#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$ROOT/logs/pids.txt" ]; then
  PIDS=$(cat "$ROOT/logs/pids.txt")
  echo "[stop] Beende PIDs: $PIDS"
  kill $PIDS 2>/dev/null && echo "[stop] ✓ Gestoppt" || echo "[stop] Prozesse bereits beendet"
  rm "$ROOT/logs/pids.txt"
else
  echo "[stop] Keine PID-Datei gefunden. Manuell: pkill -f browser_server.py && pkill -f 'node dist/index'"
fi
