const DOCUMENT_PATTERN = /^document:?\s*/;

function parseDocumentCommand(message) {
  if (!message || typeof message !== "string") {
    return { isDocumentCommand: false };
  }

  const rawFirstLine = message.split("\n")[0];

  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;

  // Require the word "document" to be the ENTIRE first line's content
  // (aside from the optional colon and whitespace) — this avoids
  // accidentally matching normal sentences that happen to start with
  // the word "document" as a verb, e.g. "document this for me please"
  // would NOT match, only a bare "document" or "document:" command will.
  const trimmedFirstLine = firstLine.trim();

  if (trimmedFirstLine !== "document" && trimmedFirstLine !== "document:") {
    return { isDocumentCommand: false };
  }

  return { isDocumentCommand: true };
}

module.exports = { parseDocumentCommand };
