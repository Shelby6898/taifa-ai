// Pure, stateless helpers for building up a plan/clarification description
// string across multiple turns. Extracted out of server.js (which has no
// module.exports and starts listening on a port the moment it's required)
// so these can be unit tested directly without needing a running server.

// Replaces any previously-appended section under the given marker with a
// new one, instead of stacking indefinitely. Each correction/revision the
// user sends should supersede the last one of the same kind, not pile on
// top of it -- unbounded accumulation drowns the model in every past
// (often superseded) complaint, which empirically made it LESS likely to
// satisfy the latest one, not more.
function replaceLastSection(description, marker, newText) {
  const markerIndex = description.indexOf(marker);
  const base = markerIndex === -1 ? description : description.slice(0, markerIndex);
  return base.replace(/\n+$/, "") + "\n\n" + marker + newText;
}

// The model occasionally echoes the field labels it was given back into
// the content itself, producing "Path: <path>\nDescription: <real text>"
// instead of just the real text. Strips that redundant echo when present,
// leaving the description untouched otherwise. Deterministic, no model call.
function cleanDescription(description) {
  if (typeof description !== "string") return description;
  const match = description.match(/^Path:\s*.*?\n\s*Description:\s*(.*)$/is);
  return match ? match[1].trim() : description;
}

module.exports = { replaceLastSection, cleanDescription };
