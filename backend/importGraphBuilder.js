const fs = require("fs");
const path = require("path");
const { WORKSPACE_DIR, loadIndex } = require("./fileIndexer");

const GRAPH_PATH = path.join(__dirname, "memory", "importGraph.json");
const RESOLVE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];

const REQUIRE_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_PATTERN = /import\s+(?:[\w*\s{},]+from\s+)?['"]([^'"]+)['"]/g;

function extractSpecifiers(content) {
  const specifiers = new Set();
  let match;

  while ((match = REQUIRE_PATTERN.exec(content)) !== null) {
    specifiers.add(match[1]);
  }
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    specifiers.add(match[1]);
  }

  return [...specifiers];
}

function resolveSpecifier(importerRelativePath, specifier) {
  if (!specifier.startsWith(".")) {
    return { type: "external", name: specifier };
  }

  const importerAbsDir = path.dirname(path.join(WORKSPACE_DIR, importerRelativePath));
  const baseAbsPath = path.resolve(importerAbsDir, specifier);

  const candidates = [
    baseAbsPath,
    ...RESOLVE_EXTENSIONS.map((ext) => baseAbsPath + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(baseAbsPath, "index" + ext))
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { type: "resolved", path: path.relative(WORKSPACE_DIR, candidate) };
    }
  }

  return { type: "unresolved", name: specifier };
}

function buildImportGraph() {
  const indexedFiles = loadIndex();
  const nodes = {};

  for (const file of indexedFiles) {
    nodes[file.path] = { path: file.path, imports: [], importedBy: [] };
  }

  for (const file of indexedFiles) {
    const absPath = path.join(WORKSPACE_DIR, file.path);
    let content = "";
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch (err) {
      continue;
    }

    const specifiers = extractSpecifiers(content);
    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(file.path, specifier);
      nodes[file.path].imports.push(resolved);
    }
  }

  for (const file of Object.values(nodes)) {
    for (const imp of file.imports) {
      if (imp.type === "resolved" && nodes[imp.path]) {
        nodes[imp.path].importedBy.push(file.path);
      }
    }
  }

  const graph = Object.values(nodes);

  fs.mkdirSync(path.dirname(GRAPH_PATH), { recursive: true });
  fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));
  console.log(`[importGraphBuilder] Graph rebuilt — ${graph.length} files @ ${new Date().toISOString()}`);
  return graph;
}

function loadImportGraph() {
  if (!fs.existsSync(GRAPH_PATH)) {
    return buildImportGraph();
  }
  return JSON.parse(fs.readFileSync(GRAPH_PATH, "utf-8"));
}

function getFileRelations(relativePath) {
  const graph = loadImportGraph();
  return graph.find((f) => f.path === relativePath) || null;
}

module.exports = { buildImportGraph, loadImportGraph, getFileRelations };
