const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");

const WORKSPACE_DIR = path.join(__dirname, "..", "workspace");
const INDEX_PATH = path.join(__dirname, "memory", "fileIndex.json");
const LINES_TO_INDEX = 40;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);
const SKIP_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".lock", ".woff", ".ttf"]);
const DEBOUNCE_MS = 1000;

let debounceTimer = null;

function walkDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) continue;
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function readFirstLines(filePath, n) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").slice(0, n).join("\n");
  } catch (err) {
    return "";
  }
}

function buildIndex() {
  const files = walkDir(WORKSPACE_DIR);
  const index = files.map((filePath) => {
    const relativePath = path.relative(WORKSPACE_DIR, filePath);
    const snippet = readFirstLines(filePath, LINES_TO_INDEX);
    return { path: relativePath, snippet };
  });

  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  console.log(`[fileIndexer] Index rebuilt — ${index.length} files indexed @ ${new Date().toISOString()}`);
  return index;
}

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    return buildIndex();
  }
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
}

function scoreFile(query, file) {
  const queryWords = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const haystack = (file.path + " " + file.snippet).toLowerCase();

  let score = 0;
  for (const word of queryWords) {
    const matches = haystack.split(word).length - 1;
    score += matches;
  }
  return score;
}

function searchIndex(query, topN = 3) {
  const index = loadIndex();
  const scored = index
    .map((file) => ({ ...file, score: scoreFile(query, file) }))
    .filter((file) => file.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topN);
}

// Returns the ENTIRE indexed workspace, formatted as one block —
// used for documentation generation, where we want a full picture
// of the project rather than a relevance-filtered subset.
// Known limitation: this has no size cap. On a small workspace this
// is fine; on a large one it will exceed the model's context window.
// A future version would need per-file summarization before this
// becomes safe at scale.
function formatFullIndex() {
  const index = loadIndex();

  if (index.length === 0) {
    return "";
  }

  return index
    .map((file) => `--- ${file.path} ---\n${file.snippet}`)
    .join("\n\n");
}

function debouncedRebuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    buildIndex();
  }, DEBOUNCE_MS);
}

function startWatching() {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const watcher = chokidar.watch(WORKSPACE_DIR, {
    ignored: (filePath) => {
      const segments = filePath.split(path.sep);
      return segments.some((seg) => SKIP_DIRS.has(seg));
    },
    ignoreInitial: true,
    persistent: true
  });

  watcher
    .on("add", debouncedRebuild)
    .on("change", debouncedRebuild)
    .on("unlink", debouncedRebuild)
    .on("error", (err) => console.error("[fileIndexer] Watcher error:", err.message));

  console.log(`[fileIndexer] Watching ${WORKSPACE_DIR} for changes`);

  buildIndex();

  return watcher;
}

module.exports = { buildIndex, loadIndex, searchIndex, formatFullIndex, startWatching };
