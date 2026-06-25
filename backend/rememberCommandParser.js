const REMEMBER_PATTERN = /^remember:\s*/;

function parseRememberCommand(message) {
  if (!message || typeof message !== "string") {
    return { isRememberCommand: false };
  }

  const rawFirstLine = message.split("\n")[0];

  // Same autocapitalize tolerance as the write-command parser —
  // mobile keyboards capitalize the first letter of new messages.
  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;

  const match = firstLine.match(REMEMBER_PATTERN);

  if (!match) {
    return { isRememberCommand: false };
  }

  const fact = firstLine.slice(match[0].length).trim();

  if (!fact) {
    return { isRememberCommand: true, fact: "", malformed: true };
  }

  return { isRememberCommand: true, fact };
}

module.exports = { parseRememberCommand };
