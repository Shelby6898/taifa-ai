function stripCodeFences(rawOutput) {
  if (!rawOutput || typeof rawOutput !== "string") {
    return "";
  }

  let content = rawOutput.trim();

  // Pattern: starts with ``` optionally followed by a language tag,
  // ends with ```. Strip both, keep everything in between.
  const fenceMatch = content.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);

  if (fenceMatch) {
    return fenceMatch[1];
  }

  // Fallback: if it starts with ``` but doesn't cleanly match the
  // full pattern above (e.g. trailing whitespace after closing fence),
  // strip a leading fence line and a trailing fence line individually.
  const lines = content.split("\n");

  if (lines[0].startsWith("```")) {
    lines.shift();
  }

  if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
    lines.pop();
  }

  return lines.join("\n");
}

module.exports = { stripCodeFences };
