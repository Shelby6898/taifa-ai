const fs = require("fs");
const path = require("path");
const { getWorkspaceDir } = require("./workspaceResolver");
const { loadIndex } = require("./fileIndexer");

// Matches: const userSchema = { ... } or const UserModel = { ... }
// Captures the variable name and the object literal body.
const SCHEMA_DECLARATION_PATTERN = /(?:const|let|var)\s+(\w*(?:Schema|Model))\s*=\s*\{([^}]*)\}/g;
// Matches a field line inside a schema body: fieldName: Type
const FIELD_PATTERN = /(\w+)\s*:\s*([A-Za-z_][\w.]*)/g;

function dbSchemaPathFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  return path.join(__dirname, "memory", `dbSchema-${studentId}__${projectName}.json`);
}

function extractSchemas(relativePath, content) {
  const schemas = [];
  let match;

  SCHEMA_DECLARATION_PATTERN.lastIndex = 0;
  while ((match = SCHEMA_DECLARATION_PATTERN.exec(content)) !== null) {
    const schemaName = match[1];
    const body = match[2];
    const fields = [];

    let fieldMatch;
    FIELD_PATTERN.lastIndex = 0;
    while ((fieldMatch = FIELD_PATTERN.exec(body)) !== null) {
      fields.push({ name: fieldMatch[1], type: fieldMatch[2] });
    }

    schemas.push({ path: relativePath, schemaName, fields });
  }

  return schemas;
}

// Detects Mongoose-style schema object literals (variables named
// *Schema or *Model) and extracts their fields. Also links fields that
// appear to reference another known schema — either by field name
// ending in "Id" that matches another schema's name, or by a type
// string containing another schema's name (e.g. ObjectId ref patterns).
//
// On Firestore-based projects (no formal schema files) this will
// correctly come back empty — that reflects the project's actual
// architecture, not a builder bug.
function buildDbSchemaGraph(sessionKey) {
  const workspaceDir = getWorkspaceDir(sessionKey);
  const indexedFiles = loadIndex(sessionKey);
  let allSchemas = [];

  for (const file of indexedFiles) {
    const absPath = path.join(workspaceDir, file.path);
    let content = "";
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch (err) {
      continue;
    }
    allSchemas = allSchemas.concat(extractSchemas(file.path, content));
  }

  const schemaNamesLower = allSchemas.map((s) => s.schemaName.replace(/Schema|Model/i, "").toLowerCase());

  for (const schema of allSchemas) {
    for (const field of schema.fields) {
      const fieldBase = field.name.replace(/Id$/, "").toLowerCase();
      const typeBase = field.type.toLowerCase();

      const matchIndex = schemaNamesLower.findIndex(
        (name) => name.length > 2 && (fieldBase === name || typeBase.includes(name))
      );

      if (matchIndex !== -1 && allSchemas[matchIndex].schemaName !== schema.schemaName) {
        field.referencesSchema = allSchemas[matchIndex].schemaName;
      }
    }
  }

  const dbSchemaPath = dbSchemaPathFor(sessionKey);
  fs.mkdirSync(path.dirname(dbSchemaPath), { recursive: true });
  fs.writeFileSync(dbSchemaPath, JSON.stringify(allSchemas, null, 2));
  console.log(`[dbSchemaBuilder] DB schema graph rebuilt for ${sessionKey} — ${allSchemas.length} schema(s) @ ${new Date().toISOString()}`);
  return allSchemas;
}

function loadDbSchemaGraph(sessionKey) {
  const dbSchemaPath = dbSchemaPathFor(sessionKey);
  if (!fs.existsSync(dbSchemaPath)) {
    return buildDbSchemaGraph(sessionKey);
  }
  return JSON.parse(fs.readFileSync(dbSchemaPath, "utf-8"));
}

module.exports = { buildDbSchemaGraph, loadDbSchemaGraph };
