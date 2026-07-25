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

// Applies a sequence of search/replace blocks to the original content.
// Each block is attempted independently: blocks whose SEARCH text
// matches exactly once in the CURRENT working content (i.e. after any
// earlier blocks have already been applied) are applied; blocks that
// fail (zero matches, ambiguous multiple matches, or empty SEARCH
// text) are skipped and reported, but do NOT prevent the remaining
// blocks from being attempted.
//
// This is a deliberate choice: if a model produces one good change and
// one bad one in the same response, discarding the good change too
// would throw away real, verifiably-correct work. Every skipped block
// is reported in full detail (never silently dropped) so a human
// reviewing the result knows exactly what did and didn't happen and
// why -- "apply what matches, report what failed" rather than
// all-or-nothing.
//
// Returns:
//   content        - the file content with all successfully-matched
//                     blocks applied (identical to originalContent if
//                     none matched)
//   appliedCount    - how many blocks were successfully applied
//   totalBlocks     - how many blocks were attempted
//   failedBlocks    - array of { index, search, reason } for every
//                     block that could not be applied
//   allSucceeded    - true only if every block applied cleanly
//   noneSucceeded   - true if not a single block could be applied
function applySearchReplaceBlocks(originalContent, blocks) {
  let workingContent = originalContent;
  let appliedCount = 0;
  const failedBlocks = [];

  for (let i = 0; i < blocks.length; i++) {
    const { search, replace } = blocks[i];

    if (!search || search.trim().length === 0) {
      failedBlocks.push({
        index: i,
        search,
        reason: `Block ${i + 1}: SEARCH text is empty, which would match everywhere and can't be applied safely.`
      });
      continue;
    }

    const occurrences = countOccurrences(workingContent, search);

    if (occurrences === 0) {
      failedBlocks.push({
        index: i,
        search,
        reason: `Block ${i + 1}: the SEARCH text does not appear verbatim in the file. The model may have paraphrased or misremembered the existing code instead of copying it exactly.`
      });
      continue;
    }

    if (occurrences > 1) {
      failedBlocks.push({
        index: i,
        search,
        reason: `Block ${i + 1}: the SEARCH text matches ${occurrences} different locations in the file, so it's ambiguous which one should be replaced. The SEARCH snippet needs to include more surrounding context to uniquely identify one location.`
      });
      continue;
    }

    workingContent = workingContent.replace(search, replace);
    appliedCount++;
  }

  return {
    content: workingContent,
    appliedCount,
    totalBlocks: blocks.length,
    failedBlocks,
    allSucceeded: failedBlocks.length === 0,
    noneSucceeded: appliedCount === 0
  };
}

module.exports = { parseSearchReplaceBlocks, applySearchReplaceBlocks };
