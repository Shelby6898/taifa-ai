function stripCodeFences(rawOutput) {
  if (!rawOutput || typeof rawOutput !== "string") {
    return "";
  }

  let content = rawOutput.trim();

  // Primary pattern: clean fence wrapping the ENTIRE output, nothing
  // before or after. This is the common, well-behaved case.
  const fenceMatch = content.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);

  if (fenceMatch) {
    return fenceMatch[1];
  }

  const lines = content.split("\n");

  // If it starts with an opening fence, strip that first line.
  if (lines[0].startsWith("```")) {
    lines.shift();
  }

  // Now find the FIRST closing fence anywhere in the remaining lines —
  // not just check if the last line happens to be one. Anything from
  // that closing fence onward (including trailing explanation prose
  // the model sometimes adds after the code block) gets discarded.
  const closingFenceIndex = lines.findIndex((line) => line.trim() === "```");

  if (closingFenceIndex !== -1) {
    return lines.slice(0, closingFenceIndex).join("\n");
  }

  // No closing fence found at all (truncated/malformed output) —
  // return everything we have rather than discarding real content.
  return lines.join("\n");
}

module.exports = { stripCodeFences };
