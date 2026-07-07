const PATTERN = /^write tests:\s*(.+)$/;

function parseTestGenerationCommand(message) {
  if (!message || typeof message !== "string") {
    return { isTestGenerationCommand: false };
  }

  const rawFirstLine = message.split("\n")[0];
  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;

  const match = firstLine.trim().match(PATTERN);

  if (!match) {
    return { isTestGenerationCommand: false };
  }

  return { isTestGenerationCommand: true, targetPath: match[1].trim() };
}

module.exports = { parseTestGenerationCommand };
