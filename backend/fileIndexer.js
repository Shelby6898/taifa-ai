const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");

const WORKSPACE_DIR = path.join(__dirname, "..", "workspace");
const INDEX_PATH = path.join(__dirname, "memory", "fileIndex.json");
const LINES_TO_INDEX = 40;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);
const SKIP_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".lock", ".woff", ".ttf"]);
const DEBOUNCE_MS = 1000;

// --- Token budget config for formatFullIndex() ---
const MAX_INDEX_TOKENS = 1200;   // leave headroom for history + memory + prompt within a 6144 num_ctx
const MAX_LINES_PER_FILE = 25;   // trim from the 40-line stored snippet when formatting into a prompt
const CHARS_PER_TOKEN = 4;       // rough estimate, fine for budgeting, not precision

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

function searchIndex(query, topN = 3, excludeExtensions = []) {
  const index = loadIndex();
  const filteredIndex = index.filter((f) => !excludeExtensions.some((ext) => f.path.toLowerCase().endsWith(ext)));
  const scored = filteredIndex
    .map((file) => ({ ...file, score: scoreFile(query, file) }))
    .filter((file) => file.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topN);
}

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Builds a compact relationship summary for a file, pulled from the
// import graph, component graph, and DB schema graph: what it imports,
// what imports it back, what components it renders, and its schema
// fields if it defines one. Returns only the lines that have content,
// so files with nothing to say don't waste tokens on empty labels.
function formatRelationsLine(relations, componentRelations, schemaEntries) {
  let line = "";

  if (relations) {
    const importParts = relations.imports.map((imp) => {
      if (imp.type === "resolved") return imp.path;
      if (imp.type === "external") return `${imp.name} [external]`;
      return `${imp.name} [unresolved]`;
    });
    const importedByParts = relations.importedBy;

    if (importParts.length > 0) line += `Imports: ${importParts.join(", ")}\n`;
    if (importedByParts.length > 0) line += `Imported by: ${importedByParts.join(", ")}\n`;
  }

  if (componentRelations && componentRelations.renders.length > 0) {
    line += `Renders: ${componentRelations.renders.join(", ")}\n`;
  }

  if (schemaEntries && schemaEntries.length > 0) {
    for (const schema of schemaEntries) {
      const fieldParts = schema.fields.map((f) =>
        f.referencesSchema ? `${f.name}:${f.type}->${f.referencesSchema}` : `${f.name}:${f.type}`
      );
      line += `Schema ${schema.schemaName}: ${fieldParts.join(", ")}\n`;
    }
  }

  return line;
}

// Returns the indexed workspace formatted as one block, capped to a token
// budget so it can't overflow the model's context window.
//
// If `query` is provided (e.g. a plan description), files are ranked by
// relevance to that query first, so the highest-signal files survive the
// cap. If no query is given (e.g. documentation generation, which wants
// a general picture rather than a targeted one), files are kept in
// original index order until the budget runs out.
//
// Each file's snippet is preceded by a relations block combining the
// import graph, component graph, and DB schema graph, so the model sees
// structural relationships between files, not just isolated content.
// This means longer per-file entries than before — the token cap now has
// more competing structural context to fit before dropping files.
//
// Any files that don't fit are named in a trailing notice so it's visible
// to both the model and anyone debugging output, rather than silently
// dropped.
function formatFullIndex(query = null) {
  const index = loadIndex();
  const codeOnlyIndex = index.filter((f) => !f.path.toLowerCase().endsWith(".md"));

  if (index.length === 0) {
    return "";
  }

  const { getFileRelations } = require("./importGraphBuilder");
  const { loadComponentGraph } = require("./componentGraphBuilder");
  const { loadDbSchemaGraph } = require("./dbSchemaBuilder");

  const componentGraph = loadComponentGraph();
  const schemaGraph = loadDbSchemaGraph();

  const ranked = query
    ? [...codeOnlyIndex]
        .map((file) => ({ ...file, score: scoreFile(query, file) }))
        .sort((a, b) => b.score - a.score)
    : codeOnlyIndex;

  let budget = MAX_INDEX_TOKENS;
  const included = [];
  const dropped = [];

  for (const file of ranked) {
    const relations = getFileRelations(file.path);
    const componentRelations = componentGraph.find((c) => c.path === file.path) || null;
    const schemaEntries = schemaGraph.filter((s) => s.path === file.path);
    const relationsLine = formatRelationsLine(relations, componentRelations, schemaEntries);
    const trimmedSnippet = file.snippet.split("\n").slice(0, MAX_LINES_PER_FILE).join("\n");
    const entryText = `--- ${file.path} ---\n${relationsLine}${trimmedSnippet}`;
    const entryTokens = estimateTokens(entryText);

    if (entryTokens <= budget) {
      included.push(entryText);
      budget -= entryTokens;
    } else {
      dropped.push(file.path);
    }
  }

  let output = included.join("\n\n");

  if (dropped.length > 0) {
    output += `\n\n[Context budget reached — omitted ${dropped.length} file(s): ${dropped.join(", ")}]`;
  }

  return output;
}

function debouncedRebuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    buildIndex();
    const { buildImportGraph } = require("./importGraphBuilder");
    buildImportGraph();
    const { buildFunctionIndex } = require("./functionIndexBuilder");
    buildFunctionIndex();
    const { buildComponentGraph } = require("./componentGraphBuilder");
    buildComponentGraph();
    const { buildDbSchemaGraph } = require("./dbSchemaBuilder");
    buildDbSchemaGraph();
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
  const { buildImportGraph } = require("./importGraphBuilder");
  buildImportGraph();
  const { buildFunctionIndex } = require("./functionIndexBuilder");
  buildFunctionIndex();
  const { buildComponentGraph } = require("./componentGraphBuilder");
  buildComponentGraph();
  const { buildDbSchemaGraph } = require("./dbSchemaBuilder");
  buildDbSchemaGraph();

  return watcher;
}

module.exports = { buildIndex, loadIndex, searchIndex, formatFullIndex, startWatching, WORKSPACE_DIR };
