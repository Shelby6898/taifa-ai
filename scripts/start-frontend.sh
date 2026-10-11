#!/data/data/com.termux/files/usr/bin/bash
# Run this in its own dedicated Termux session.
# Scoped to taifa-ai/frontend by working directory, same reasoning as
# start-backend.sh — never assume a same-named process is ours.

PORT=3000
FRONTEND_DIR="$HOME/taifa-ai/frontend"

echo "Checking Taifa AI frontend (port $PORT)..."

if curl -s -o /dev/null -w "" "http://localhost:$PORT" 2>/dev/null; then
  RUNNING_PID=$(pgrep -f "react-scripts start" | while read -r pid; do
    CWD=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    if [ "$CWD" = "$FRONTEND_DIR" ]; then
      echo "$pid"
      break
    fi
  done)

  if [ -n "$RUNNING_PID" ]; then
    echo "✅ Taifa AI frontend is already running (pid $RUNNING_PID, $FRONTEND_DIR)."
    exit 0
  else
    echo "⚠️  Something is already listening on port $PORT, but it is NOT"
    echo "   taifa-ai/frontend (no matching process found at $FRONTEND_DIR)."
    echo "   Not touching it. Check what's using port $PORT before continuing."
    exit 1
  fi
fi

echo "Not running — starting it in this session (stays in foreground)..."
echo "   Leave this session open. Switch to another session to continue."
echo ""
cd "$FRONTEND_DIR" && npm start
