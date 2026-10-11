#!/data/data/com.termux/files/usr/bin/bash
# Run this in its own dedicated Termux session.
#
# Scoped strictly to taifa-ai/backend by working directory — this script
# NEVER kills or restarts a process just because it's named "node
# server.js", since other projects on this device (e.g. Taifatech) run
# a same-named script under a different path. A mix-up here cost real
# time during a past session. If something is already listening on
# port 5000 and it ISN'T ours, this script stops and tells you, rather
# than touching it.

PORT=5000
BACKEND_DIR="$HOME/taifa-ai/backend"

echo "Checking Taifa AI backend (port $PORT)..."

if curl -s -o /dev/null -w "" "http://localhost:$PORT/api/session/current" 2>/dev/null; then
  RUNNING_PID=$(pgrep -f "node server.js" | while read -r pid; do
    CWD=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    if [ "$CWD" = "$BACKEND_DIR" ]; then
      echo "$pid"
      break
    fi
  done)

  if [ -n "$RUNNING_PID" ]; then
    echo "✅ Taifa AI backend is already running (pid $RUNNING_PID, $BACKEND_DIR)."
    exit 0
  else
    echo "⚠️  Something is already listening on port $PORT, but it is NOT"
    echo "   taifa-ai/backend (no matching process found at $BACKEND_DIR)."
    echo "   Not touching it. Check what's using port $PORT before continuing."
    exit 1
  fi
fi

echo "Not running — starting it in this session (stays in foreground)..."
echo "   Leave this session open. Switch to another session to continue."
echo ""
cd "$BACKEND_DIR" && node server.js
