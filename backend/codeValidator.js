// codeValidator.js — mechanically checks a completed batch of GENERATED CODE
// (not plan-time descriptions — planValidator.js already covers those).
// Same philosophy as planValidator.js: deterministic regex/string checks
// only, no model calls, every check here traces back to a real bug found
// via live review of actual generated diffs. Runs once after a batch of
// files finishes generating, before the diffs are shown for human review.

// .find(/.findOne( are shared vocabulary between Mongoose and Sequelize --
// real, live testing showed Sequelize code using them correctly
// (e.g. User.findOne({ where: { email } })) getting falsely flagged.
// These two are checked separately in checkOrmMethodMismatch by looking
// for the absence of a "where:" wrapper, rather than being an automatic
// flag. Only genuinely Mongoose-exclusive methods stay in this list.
const MONGOOSE_CALL_PATTERNS = [
  /\.findById\s*\(/,
  /\.findByIdAndUpdate\s*\(/,
  /\.findByIdAndDelete\s*\(/,
  /mongoose\.Schema/,
  /mongoose\.model\s*\(/
];

const AMBIGUOUS_CALL_PATTERNS = [
  { name: ".find(", regex: /\.find\s*\(([^;]{0,200})/ },
  { name: ".findOne(", regex: /\.findOne\s*\(([^;]{0,200})/ }
];

const SQL_DATABASES = ["postgresql", "postgres", "mysql", "mariadb", "sqlite", "sql server", "mssql"];
const SEQUELIZE_QUERY_METHODS = ["findOne", "findAll", "findByPk", "update", "destroy", "count", "create"];

function isSqlArchitecture(blueprint) {
  if (!blueprint || !blueprint.database) return false;
  const dbName = blueprint.database.toLowerCase();
  return SQL_DATABASES.some((sql) => dbName.includes(sql));
}

function isModelImported(content, modelName) {
  const destructured = new RegExp(`\\{[^}]*\\b${modelName}\\b[^}]*\\}\\s*=\\s*require\\s*\\(`);
  const direct = new RegExp(`\\b(?:const|let|var)\\s+${modelName}\\s*=\\s*require\\s*\\(`);
  const esImport = new RegExp(`\\bimport\\b[^;\\n]*\\b${modelName}\\b`);
  return destructured.test(content) || direct.test(content) || esImport.test(content);
}

function checkOrmMethodMismatch(files, blueprint) {
  const issues = [];
  if (!isSqlArchitecture(blueprint)) return issues;

  for (const file of files) {
    const content = file.after || "";
    let flagged = false;

    for (const pattern of MONGOOSE_CALL_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        issues.push({
          path: file.path,
          type: "orm_method_mismatch",
          detail: `Uses Mongoose-style call "${match[0]}" but architecture specifies ${blueprint.database} (expected Sequelize/SQL-style calls like findAll, .update, .destroy).`
        });
        flagged = true;
        break;
      }
    }
    if (flagged) continue;

    for (const { name, regex } of AMBIGUOUS_CALL_PATTERNS) {
      const match = content.match(regex);
      if (match && !/\bwhere\s*:/.test(match[1])) {
        issues.push({
          path: file.path,
          type: "orm_method_mismatch",
          detail: `Uses "${name}" without a where: wrapper -- looks like Mongoose-style usage, but architecture specifies ${blueprint.database} (expected a Sequelize where: clause).`
        });
        break;
      }
    }
  }
  return issues;
}

function checkUnimportedModelUsage(files) {
  const issues = [];

  const modelNames = new Set();
  for (const file of files) {
    const base = file.path.split("/").pop().replace(/\.[jt]sx?$/i, "");
    if (/models\//i.test(file.path) || /Model$/i.test(base)) {
      modelNames.add(base.replace(/Model$/i, ""));
    }
  }
  if (modelNames.size === 0) return issues;

  for (const file of files) {
    const content = file.after || "";
    if (/models\//i.test(file.path)) continue;

    for (const modelName of modelNames) {
      const methodCallPattern = new RegExp(`\\b${modelName}\\.[a-zA-Z]+\\s*\\(`);
      const includeRefPattern = new RegExp(`\\bmodel\\s*:\\s*${modelName}\\b`);
      const used = methodCallPattern.test(content) || includeRefPattern.test(content);
      if (!used) continue;

      if (!isModelImported(content, modelName)) {
        issues.push({
          path: file.path,
          type: "unimported_model",
          detail: `References "${modelName}" (method call or include: block) but "${modelName}" is never imported or declared in this file — will throw a ReferenceError.`
        });
      }
    }
  }
  return issues;
}

function checkModelBypass(files) {
  const issues = [];

  const modelNames = new Set();
  for (const file of files) {
    const base = file.path.split("/").pop().replace(/\.[jt]sx?$/i, "");
    if (/models\//i.test(file.path) || /Model$/i.test(base)) {
      modelNames.add(base.replace(/Model$/i, ""));
    }
  }

  const arrayDatastorePattern = /(?:let|const|var)\s+(\w+)\s*=\s*\[\s*\]/g;

  for (const file of files) {
    if (!/routes?\/|controllers?\//i.test(file.path)) continue;
    const content = file.after || "";

    let match;
    while ((match = arrayDatastorePattern.exec(content)) !== null) {
      const varName = match[1];
      const pushPattern = new RegExp(`\\b${varName}\\.push\\s*\\(`);
      if (!pushPattern.test(content)) continue;

      const importsAnyModel = [...modelNames].some((m) => isModelImported(content, m));

      if (!importsAnyModel) {
        issues.push({
          path: file.path,
          type: "model_bypass",
          detail: `Uses an in-memory array ("${varName}") as a datastore instead of importing a real model — no model import found in this file.`
        });
      }
    }
  }
  return issues;
}

function extractSequelizeFields(modelFileContent) {
  const fields = new Set();
  const fieldPattern = /(\w+)\s*:\s*\{/g;
  const excluded = new Set(["type", "references", "defaultValue", "validate", "unique"]);
  let match;
  while ((match = fieldPattern.exec(modelFileContent)) !== null) {
    if (!excluded.has(match[1])) fields.add(match[1]);
  }
  return fields;
}

function findOwningModel(content, whereIndex, knownModelNames) {
  const beforeText = content.slice(0, whereIndex);
  const callPattern = new RegExp(`(\\w+)\\.(?:${SEQUELIZE_QUERY_METHODS.join("|")})\\s*\\(`, "g");
  let lastModel = null;
  let m;
  while ((m = callPattern.exec(beforeText)) !== null) {
    if (knownModelNames.has(m[1])) lastModel = m[1];
  }
  return lastModel;
}

function checkFieldReferenceMismatch(files) {
  const issues = [];

  const modelFieldsByName = {};
  for (const file of files) {
    const base = file.path.split("/").pop().replace(/\.[jt]sx?$/i, "");
    if (/models\//i.test(file.path) || /Model$/i.test(base)) {
      const modelName = base.replace(/Model$/i, "");
      modelFieldsByName[modelName] = extractSequelizeFields(file.after || "");
    }
  }
  const knownModelNames = new Set(Object.keys(modelFieldsByName));
  if (knownModelNames.size === 0) return issues;

  for (const file of files) {
    if (/models\//i.test(file.path)) continue;
    const content = file.after || "";

    const wherePattern = /where\s*:\s*\{\s*(\w+)/g;
    let match;
    while ((match = wherePattern.exec(content)) !== null) {
      const field = match[1];
      if (field === "id") continue;

      const owningModel = findOwningModel(content, match.index, knownModelNames);
      if (!owningModel) continue;

      const fields = modelFieldsByName[owningModel];
      if (fields.has(field)) continue;

      issues.push({
        path: file.path,
        type: "field_reference_mismatch",
        detail: `Queries "where: { ${field} }" against ${owningModel} but ${owningModel} does not declare a "${field}" field.`
      });
    }
  }
  return issues;
}

function validateGeneratedCode(files, blueprint) {
  return [
    ...checkOrmMethodMismatch(files, blueprint),
    ...checkUnimportedModelUsage(files),
    ...checkModelBypass(files),
    ...checkFieldReferenceMismatch(files)
  ];
}

module.exports = {
  validateGeneratedCode,
  checkOrmMethodMismatch,
  checkUnimportedModelUsage,
  checkModelBypass,
  checkFieldReferenceMismatch
};
