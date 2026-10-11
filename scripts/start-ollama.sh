#!/data/data/com.termux/files/usr/bin/bash
# Run this in its own dedicated Termux session. If Ollama is already
# running elsewhere, this just confirms it and exits — it won't try to
# start a second instance on top of it.

echo "Checking Ollama..."

if curl -s -o /dev/null -w "" http://127.0.0.1:11434/api/tags 2>/dev/null; then
  echo "✅ Ollama is already running on port 11434."
  echo "   (Nothing more to do in this session — safe to close it.)"
  exit 0
fi

echo "Ollama not responding — starting it in this session (stays in foreground)..."
echo "   Leave this session open. Switch to another session to continue."
echo ""
ollama serve
