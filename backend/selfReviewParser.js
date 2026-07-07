// Parses the model's self-review response defensively. The model has
// been observed to sometimes ignore the requested exact format (e.g.
// answering in full prose instead of "YES: <sentence>"), so this does
// not assume a clean match — it looks for a leading YES/NO regardless
// of exact formatting, and falls back to "uncertain" rather than
// guessing wrong when the response doesn't clearly indicate either.
function parseSelfReview(rawResponse) {
  const trimmed = (rawResponse || "").trim();
  const firstLine = trimmed.split("\n")[0].trim();

  if (/^no\b/i.test(firstLine)) {
    return { flagged: false, note: null };
  }

  if (/^yes\b/i.test(firstLine)) {
    const note = trimmed.replace(/^yes:?\s*/i, "").trim() || firstLine;
    return { flagged: true, note: note.slice(0, 300) };
  }

  return { flagged: null, note: "Self-review response was not in the expected format: " + trimmed.slice(0, 200) };
}

module.exports = { parseSelfReview };
