// Parses and applies "SEARCH/REPLACE" style edit blocks, the pattern
// used by several AI coding tools (e.g. Aider) specifically because it
// works reliably with small models that struggle with precise
// line-numbered diffs: the model only has to reproduce an exact
// snippet of existing code plus its replacement, with no line-number
// bookkeeping required at all.
//
// This is the core of moving away from full-file regeneration, which
// was the root cause of several real regressions found in manual
// testing tonight (a full-file edit silently dropping an existing
// feature that the instruction never asked to remove). A scoped patch
// can only touch the exact snippet it names -- everything else in the
// file is mechanically guaranteed to survive untouched.

const SEARCH_MARKER = "<<<<<<< SEARCH";
const DIVIDER_MARKER = "=======";
const REPLACE_MARKER = ">>>>>>> REPLACE";

// Extracts { search, replace } pairs from the model's raw output.
// Returns { blocks, parseError }. parseError is set (and blocks is
// empty) if the output contains no recognizable blocks at all, so the
// caller can distinguish "the model produced zero valid blocks" from
// "the model produced blocks, but applying them failed" -- these need
// different handling and different error messages.
function parseSearchReplaceBlocks(rawText) {
  const blocks = [];
  let cursor = 0;

  while (true) {
    const searchStart = rawText.indexOf(SEARCH_MARKER, cursor);
    if (searchStart === -1) break;

    const dividerStart = rawText.indexOf(DIVIDER_MARKER, searchStart + SEARCH_MARKER.length);
    if (dividerStart === -1) break; // malformed -- no divider found, stop parsing

    const replaceEnd = rawText.indexOf(REPLACE_MARKER, dividerStart + DIVIDER_MARKER.length);
    if (replaceEnd === -1) break; // malformed -- no closing marker, stop parsing

    const search = rawText
      .slice(searchStart + SEARCH_MARKER.length, dividerStart)
      .replace(/^\n/, "")
      .replace(/\n$/, "");

    const replace = rawText
      .slice(dividerStart + DIVIDER_MARKER.length, replaceEnd)
      .replace(/^\n/, "")
      .replace(/\n$/, "");

    blocks.push({ search, replace });
    cursor = replaceEnd + REPLACE_MARKER.length;
  }

  if (blocks.length === 0) {
    return { blocks: [], parseError: "No valid SEARCH/REPLACE blocks found in the model's output." };
  }

  return { blocks, parseError: null };
}

// Counts non-overlapping occurrences of `needle` in `haystack`.
function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) break;
    count++;
    idx += needle.length;
  }
  return count;
}

// Applies a sequence of search/replace blocks to the original content,
// one at a time, each against the result of the previous step. Each
// block's `search` text must match EXACTLY ONCE in the current working
// content at the time it's applied -- zero matches (the model
// hallucinated a snippet that doesn't actually exist verbatim) or
// multiple matches (the snippet is ambiguous -- which one did the
// model actually mean?) are both treated as a hard failure rather than
// guessed at, consistent with refusing rather than silently doing
// something that might be wrong.
//
// Returns { success: true, content } on success, or
// { success: false, reason, failedBlockIndex } on failure -- the
// working content up to the point of failure is discarded entirely
// rather than partially applied, so a failure never leaves the file in
// a half-patched state.
function applySearchReplaceBlocks(originalContent, blocks) {
  let workingContent = originalContent;

  for (let i = 0; i < blocks.length; i++) {
    const { search, replace } = blocks[i];

    if (!search || search.trim().length === 0) {
      return {
        success: false,
        reason: `Block ${i + 1}: SEARCH text is empty, which would match everywhere and can't be applied safely.`,
        failedBlockIndex: i
      };
    }

    const occurrences = countOccurrences(workingContent, search);

    if (occurrences === 0) {
      return {
        success: false,
        reason: `Block ${i + 1}: the SEARCH text does not appear verbatim in the file. The model may have paraphrased or misremembered the existing code instead of copying it exactly.`,
        failedBlockIndex: i
      };
    }

    if (occurrences > 1) {
      return {
        success: false,
        reason: `Block ${i + 1}: the SEARCH text matches ${occurrences} different locations in the file, so it's ambiguous which one should be replaced. The SEARCH snippet needs to include more surrounding context to uniquely identify one location.`,
        failedBlockIndex: i
      };
    }

    workingContent = workingContent.replace(search, replace);
  }

  return { success: true, content: workingContent };
}

module.exports = { parseSearchReplaceBlocks, applySearchReplaceBlocks };
