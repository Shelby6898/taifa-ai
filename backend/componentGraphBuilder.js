const fs = require("fs");
const path = require("path");
const { WORKSPACE_DIR } = require("./fileIndexer");
const { loadImportGraph } = require("./importGraphBuilder");

const COMPONENT_GRAPH_PATH = path.join(__dirname, "memory", "componentGraph.json");

const JSX_TAG_PATTERN = /<([A-Z][A-Za-z0-9_]*)/g;

function basenameNoExt(relativePath) {
  return path.basename(relativePath, path.extname(relativePath));
}

function extractJsxTags(content) {
  const tags = new Set();
  let match;
  JSX_TAG_PATTERN.lastIndex = 0;
  while ((match = JSX_TAG_PATTERN.exec(content)) !== null) {
    tags.add(match[1]);
  }
  return tags;
}

// Derives "renders" edges from the existing import graph: for each file,
// look at what it already resolves-imports, then check whether that
// import's basename also appears as a capitalized JSX tag in the same
// file's content. This distinguishes "imports and renders as a component"
// from "imports and uses as a value/hook/utility" without needing a
// separate import-parsing pass.
function buildComponentGraph() {
  const importGraph = loadImportGraph();
  const componentEdges = [];

  for (const file of importGraph) {
    const absPath = path.join(WORKSPACE_DIR, file.path);
    let content = "";
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch (err) {
      continue;
    }

    const jsxTags = extractJsxTags(content);
    if (jsxTags.size === 0) continue;

    const renders = [];
    for (const imp of file.imports) {
      if (imp.type !== "resolved") continue;
      const importedName = basenameNoExt(imp.path);
      if (jsxTags.has(importedName)) {
        renders.push(imp.path);
      }
    }

    if (renders.length > 0) {
      componentEdges.push({ path: file.path, renders });
    }
  }

  fs.mkdirSync(path.dirname(COMPONENT_GRAPH_PATH), { recursive: true });
  fs.writeFileSync(COMPONENT_GRAPH_PATH, JSON.stringify(componentEdges, null, 2));
  console.log(`[componentGraphBuilder] Component graph rebuilt — ${componentEdges.length} file(s) with render edges @ ${new Date().toISOString()}`);
  return componentEdges;
}

function loadComponentGraph() {
  if (!fs.existsSync(COMPONENT_GRAPH_PATH)) {
    return buildComponentGraph();
  }
  return JSON.parse(fs.readFileSync(COMPONENT_GRAPH_PATH, "utf-8"));
}

function getComponentRelations(relativePath) {
  const graph = loadComponentGraph();
  return graph.find((f) => f.path === relativePath) || null;
}

module.exports = { buildComponentGraph, loadComponentGraph, getComponentRelations };
