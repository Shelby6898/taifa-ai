#!/data/data/com.termux/files/usr/bin/bash
# Starts Postgres if it's not already accepting connections, then verifies.
# Safe to re-run — pg_ctl handles the already-running case gracefully.

set -e

echo "Checking Postgres..."

if pg_isready -h 127.0.0.1 -p 5432 > /dev/null 2>&1; then
  echo "✅ Postgres is already running and accepting connections."
  exit 0
fi

echo "Postgres not responding — starting it..."
pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$PREFIX/var/lib/postgresql/server.log" start

sleep 2

if pg_isready -h 127.0.0.1 -p 5432 > /dev/null 2>&1; then
  echo "✅ Postgres started successfully."
else
  echo "❌ Postgres did not start. Check the log:"
  echo "   tail -50 $PREFIX/var/lib/postgresql/server.log"
  exit 1
fi
