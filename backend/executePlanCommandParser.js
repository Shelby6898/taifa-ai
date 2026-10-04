const TRIGGER_PATTERN = /^execute plan:\s*(.*)$/;

// Parses a multi-line "execute plan:" command. The first line carries
// the trigger and overall task description; every line after that is
// expected to be "path: description", split on the FIRST colon only so
// a description containing its own colon (e.g. "handles login: verifies
// credentials") still parses correctly.
function parseExecutePlanCommand(message) {
  if (!message || typeof message !== "string") {
    return { isExecutePlanCommand: false };
  }

  const lines = message.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { isExecutePlanCommand: false };
  }

  const firstLine = lines[0][0].toLowerCase() + lines[0].slice(1);
  const match = firstLine.match(TRIGGER_PATTERN);

  if (!match) {
    return { isExecutePlanCommand: false };
  }

  const description = match[1].trim();
  const fileLines = lines.slice(1);

  if (!description) {
    return { isExecutePlanCommand: true, malformed: true, reason: "No description provided. The first line after \"execute plan:\" must be a one-sentence overall description, then one \"path: description\" line per file." };
  }

  const looksLikeAFileLine = /^[^\s:]+\.[A-Za-z0-9]+\s*:\s*\S/.test(description);
  if (looksLikeAFileLine) {
    return { isExecutePlanCommand: true, malformed: true, reason: "The first line after \"execute plan:\" looks like a file entry (\"" + description + "\"), not an overall description. Put a one-sentence description on the trigger line, then list files one per line after it." };
  }

  if (fileLines.length === 0) {
    return { isExecutePlanCommand: true, malformed: true, reason: "No files listed. Add one line per file after the description, formatted as: path/to/file.js: description" };
  }

  const files = [];
  const malformedLines = [];

  for (const line of fileLines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      malformedLines.push(line);
      continue;
    }

    const path = line.slice(0, colonIndex).trim();
    const fileDescription = line.slice(colonIndex + 1).trim();

    if (!path || !fileDescription) {
      malformedLines.push(line);
      continue;
    }

    files.push({ path, description: fileDescription });
  }

  if (malformedLines.length > 0) {
    return {
      isExecutePlanCommand: true,
      malformed: true,
      reason: "These lines could not be parsed as \"path: description\": " + malformedLines.join(" | ")
    };
  }

  return { isExecutePlanCommand: true, malformed: false, description, files };
}

module.exports = { parseExecutePlanCommand };
