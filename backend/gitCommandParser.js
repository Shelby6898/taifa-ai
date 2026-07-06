const STATUS_PHRASES = new Set(["git status", "git status:"]);
const DIFF_PHRASES = new Set(["git diff", "git diff:"]);
const COMMIT_PHRASES = new Set(["commit changes", "commit changes:"]);

function parseGitCommand(message) {
  if (!message || typeof message !== "string") {
    return { type: null };
  }

  const rawFirstLine = message.split("\n")[0];
  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;
  const trimmed = firstLine.trim();

  if (STATUS_PHRASES.has(trimmed)) return { type: "status" };
  if (DIFF_PHRASES.has(trimmed)) return { type: "diff" };
  if (COMMIT_PHRASES.has(trimmed)) return { type: "commit" };

  return { type: null };
}

module.exports = { parseGitCommand };
