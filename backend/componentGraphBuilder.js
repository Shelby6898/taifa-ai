const fs = require("fs");
const path = require("path");
const { getWorkspaceDir } = require("./workspaceResolver");
const { loadImportGraph } = require("./importGraphBuilder");

const JSX_TAG_PATTERN = /<([A-Z][A-Za-z0-9_]*)/g;

function componentGraphPathFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  return path.join(__dirname, "memory", `componentGraph-${studentId}__${projectName}.json`);
}

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
function buildComponentGraph(sessionKey) {
  const workspaceDir = getWorkspaceDir(sessionKey);
  const importGraph = loadImportGraph(sessionKey);
  const componentEdges = [];

  for (const file of importGraph) {
    const absPath = path.join(workspaceDir, file.path);
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

  const componentGraphPath = componentGraphPathFor(sessionKey);
  fs.mkdirSync(path.dirname(componentGraphPath), { recursive: true });
  fs.writeFileSync(componentGraphPath, JSON.stringify(componentEdges, null, 2));
  console.log(`[componentGraphBuilder] Component graph rebuilt for ${sessionKey} — ${componentEdges.length} file(s) with render edges @ ${new Date().toISOString()}`);
  return componentEdges;
}

function loadComponentGraph(sessionKey) {
  const componentGraphPath = componentGraphPathFor(sessionKey);
  if (!fs.existsSync(componentGraphPath)) {
    return buildComponentGraph(sessionKey);
  }
  return JSON.parse(fs.readFileSync(componentGraphPath, "utf-8"));
}

function getComponentRelations(sessionKey, relativePath) {
  const graph = loadComponentGraph(sessionKey);
  return graph.find((f) => f.path === relativePath) || null;
}

module.exports = { buildComponentGraph, loadComponentGraph, getComponentRelations };
