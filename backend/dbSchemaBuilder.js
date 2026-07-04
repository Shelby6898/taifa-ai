const fs = require("fs");
const path = require("path");
const { WORKSPACE_DIR, loadIndex } = require("./fileIndexer");

const DB_SCHEMA_PATH = path.join(__dirname, "memory", "dbSchema.json");

// Matches: const userSchema = { ... } or const UserModel = { ... }
// Captures the variable name and the object literal body.
const SCHEMA_DECLARATION_PATTERN = /(?:const|let|var)\s+(\w*(?:Schema|Model))\s*=\s*\{([^}]*)\}/g;
// Matches a field line inside a schema body: fieldName: Type
const FIELD_PATTERN = /(\w+)\s*:\s*([A-Za-z_][\w.]*)/g;

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
function buildDbSchemaGraph() {
  const indexedFiles = loadIndex();
  let allSchemas = [];

  for (const file of indexedFiles) {
    const absPath = path.join(WORKSPACE_DIR, file.path);
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

  fs.mkdirSync(path.dirname(DB_SCHEMA_PATH), { recursive: true });
  fs.writeFileSync(DB_SCHEMA_PATH, JSON.stringify(allSchemas, null, 2));
  console.log(`[dbSchemaBuilder] DB schema graph rebuilt — ${allSchemas.length} schema(s) @ ${new Date().toISOString()}`);
  return allSchemas;
}

function loadDbSchemaGraph() {
  if (!fs.existsSync(DB_SCHEMA_PATH)) {
    return buildDbSchemaGraph();
  }
  return JSON.parse(fs.readFileSync(DB_SCHEMA_PATH, "utf-8"));
}

module.exports = { buildDbSchemaGraph, loadDbSchemaGraph };
