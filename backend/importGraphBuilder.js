const fs = require("fs");
const path = require("path");
const { getWorkspaceDir } = require("./workspaceResolver");
const { loadIndex } = require("./fileIndexer");

const RESOLVE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const REQUIRE_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_PATTERN = /import\s+(?:[\w*\s{},]+from\s+)?['"]([^'"]+)['"]/g;

function graphPathFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  return path.join(__dirname, "memory", `importGraph-${studentId}__${projectName}.json`);
}

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

function resolveSpecifier(workspaceDir, importerRelativePath, specifier) {
  if (!specifier.startsWith(".")) {
    return { type: "external", name: specifier };
  }

  const importerAbsDir = path.dirname(path.join(workspaceDir, importerRelativePath));
  const baseAbsPath = path.resolve(importerAbsDir, specifier);

  const candidates = [
    baseAbsPath,
    ...RESOLVE_EXTENSIONS.map((ext) => baseAbsPath + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(baseAbsPath, "index" + ext))
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { type: "resolved", path: path.relative(workspaceDir, candidate) };
    }
  }

  return { type: "unresolved", name: specifier };
}

function buildImportGraph(sessionKey) {
  const workspaceDir = getWorkspaceDir(sessionKey);
  const indexedFiles = loadIndex(sessionKey);
  const nodes = {};

  for (const file of indexedFiles) {
    nodes[file.path] = { path: file.path, imports: [], importedBy: [] };
  }

  for (const file of indexedFiles) {
    const absPath = path.join(workspaceDir, file.path);
    let content = "";
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch (err) {
      continue;
    }

    const specifiers = extractSpecifiers(content);
    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(workspaceDir, file.path, specifier);
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
  const graphPath = graphPathFor(sessionKey);
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  console.log(`[importGraphBuilder] Graph rebuilt for ${sessionKey} — ${graph.length} files @ ${new Date().toISOString()}`);
  return graph;
}

function loadImportGraph(sessionKey) {
  const graphPath = graphPathFor(sessionKey);
  if (!fs.existsSync(graphPath)) {
    return buildImportGraph(sessionKey);
  }
  return JSON.parse(fs.readFileSync(graphPath, "utf-8"));
}

function getFileRelations(sessionKey, relativePath) {
  const graph = loadImportGraph(sessionKey);
  return graph.find((f) => f.path === relativePath) || null;
}

module.exports = { buildImportGraph, loadImportGraph, getFileRelations };
