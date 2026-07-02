const PLAN_PATTERN = /^plan:\s*/;

function parsePlanCommand(message) {
  if (!message || typeof message !== "string") {
    return { isPlanCommand: false };
  }

  const rawFirstLine = message.split("\n")[0];

  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;

  const match = firstLine.match(PLAN_PATTERN);

  if (!match) {
    return { isPlanCommand: false };
  }

  const description = firstLine.slice(match[0].length).trim();

  if (!description) {
    return { isPlanCommand: true, description: "", malformed: true };
  }

  return { isPlanCommand: true, description };
}

module.exports = { parsePlanCommand };
