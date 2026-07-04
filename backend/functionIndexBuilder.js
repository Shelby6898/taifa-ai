const fs = require("fs");
const path = require("path");
const { WORKSPACE_DIR, loadIndex } = require("./fileIndexer");

const FUNCTION_INDEX_PATH = path.join(__dirname, "memory", "functionIndex.json");

const FUNCTION_DECLARATION_PATTERN = /function\s+(\w+)\s*\(/g;
const ARROW_FUNCTION_PATTERN = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/g;
const ROUTE_PATTERN = /(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;

function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function extractFromFile(relativePath, content) {
  const entries = [];
  let match;

  FUNCTION_DECLARATION_PATTERN.lastIndex = 0;
  while ((match = FUNCTION_DECLARATION_PATTERN.exec(content)) !== null) {
    entries.push({
      path: relativePath,
      type: "function",
      name: match[1],
      line: lineNumberAt(content, match.index)
    });
  }

  ARROW_FUNCTION_PATTERN.lastIndex = 0;
  while ((match = ARROW_FUNCTION_PATTERN.exec(content)) !== null) {
    entries.push({
      path: relativePath,
      type: "function",
      name: match[1],
      line: lineNumberAt(content, match.index)
    });
  }

  ROUTE_PATTERN.lastIndex = 0;
  while ((match = ROUTE_PATTERN.exec(content)) !== null) {
    entries.push({
      path: relativePath,
      type: "route",
      method: match[1].toUpperCase(),
      route: match[2],
      line: lineNumberAt(content, match.index)
    });
  }

  return entries;
}

function buildFunctionIndex() {
  const indexedFiles = loadIndex();
  let allEntries = [];

  for (const file of indexedFiles) {
    const absPath = path.join(WORKSPACE_DIR, file.path);
    let content = "";
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch (err) {
      continue;
    }
    allEntries = allEntries.concat(extractFromFile(file.path, content));
  }

  fs.mkdirSync(path.dirname(FUNCTION_INDEX_PATH), { recursive: true });
  fs.writeFileSync(FUNCTION_INDEX_PATH, JSON.stringify(allEntries, null, 2));
  console.log(`[functionIndexBuilder] Function index rebuilt — ${allEntries.length} entries @ ${new Date().toISOString()}`);
  return allEntries;
}

function loadFunctionIndex() {
  if (!fs.existsSync(FUNCTION_INDEX_PATH)) {
    return buildFunctionIndex();
  }
  return JSON.parse(fs.readFileSync(FUNCTION_INDEX_PATH, "utf-8"));
}

function scoreEntry(query, entry) {
  const queryWords = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const haystack = [entry.path, entry.name, entry.route].filter(Boolean).join(" ").toLowerCase();

  let score = 0;
  for (const word of queryWords) {
    const matches = haystack.split(word).length - 1;
    score += matches;
  }
  return score;
}

function searchFunctionIndex(query, topN = 5) {
  const index = loadFunctionIndex();
  const scored = index
    .map((entry) => ({ ...entry, score: scoreEntry(query, entry) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topN);
}

module.exports = { buildFunctionIndex, loadFunctionIndex, searchFunctionIndex };
