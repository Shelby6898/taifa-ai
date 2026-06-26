const FIX_PATTERN = /^fix(?: this)?:\s*/;

function parseFixCommand(message) {
  if (!message || typeof message !== "string") {
    return { isFixCommand: false };
  }

  const rawFirstLine = message.split("\n")[0];

  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;

  const match = firstLine.match(FIX_PATTERN);

  if (!match) {
    return { isFixCommand: false };
  }

  // Everything after the prefix, INCLUDING subsequent lines, is the
  // error text — unlike write/edit commands, an error report is
  // naturally multi-line (stack traces have multiple frames), so we
  // don't restrict this to the first line only.
  const restOfFirstLine = firstLine.slice(match[0].length);
  const remainingLines = message.split("\n").slice(1).join("\n");
  const errorText = (restOfFirstLine + "\n" + remainingLines).trim();

  if (!errorText) {
    return { isFixCommand: true, errorText: "", malformed: true };
  }

  return { isFixCommand: true, errorText };
}

module.exports = { parseFixCommand };
