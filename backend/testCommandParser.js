const TRIGGER_PHRASES = new Set(["run tests", "run tests:"]);

function parseTestCommand(message) {
  if (!message || typeof message !== "string") {
    return { isTestCommand: false };
  }

  const rawFirstLine = message.split("\n")[0];

  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;

  // Require "run tests" to be the ENTIRE first line (aside from an
  // optional trailing colon), same strictness as the document command,
  // so casual conversational use of the phrase doesn't accidentally
  // trigger a real command.
  const trimmedFirstLine = firstLine.trim();

  if (!TRIGGER_PHRASES.has(trimmedFirstLine)) {
    return { isTestCommand: false };
  }

  return { isTestCommand: true };
}

module.exports = { parseTestCommand };
