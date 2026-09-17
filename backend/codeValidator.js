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
  /\.findOneAndUpdate\s*\(/,
  /\.findOneAndDelete\s*\(/,
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

  const modelNames = new Set();
  for (const f of files) {
    if (/models\//i.test(f.path)) {
      modelNames.add(f.path.split("/").pop().replace(/\.[jt]sx?$/i, ""));
    }
  }

  for (const file of files) {
    const content = file.after || "";
    let flagged = false;

    // new Model({...}); await instance.save(); is a Mongoose instantiate-
    // and-save idiom, distinct from the method-call checks above --
    // Sequelize's idiomatic equivalent is Model.create()/Model.build()
    // + .save(), not bare `new Model()`. Found via live testing:
    // contactRequestRoutes.js used `new ContactRequest({...});
    // await contactRequest.save();` and neither existing check caught it.
    for (const modelName of modelNames) {
      const instantiatePattern = new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*new\\s+${modelName}\\s*\\(`);
      const instMatch = content.match(instantiatePattern);
      if (instMatch) {
        const varName = instMatch[1];
        const saveCallPattern = new RegExp(`\\b${varName}\\.save\\s*\\(`);
        if (saveCallPattern.test(content)) {
          issues.push({
            path: file.path,
            type: "orm_method_mismatch",
            detail: `Uses "new ${modelName}(...)" + ".save()" -- a Mongoose instantiate-and-save idiom -- but architecture specifies ${blueprint.database} (expected ${modelName}.create(...) or ${modelName}.build(...) + .save()).`
          });
        }
      }
    }

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

// Check 5: unresolved model require path. Flags `require('.../models/X')`
// where X doesn't match any actual model filename in the batch -- distinct
// from checkUnimportedModelUsage, which only checks that a model NAME is
// bound somewhere, never that the require PATH itself resolves. Found via
// live testing: contactRequestRoutes.js had
// `require('../models/contact_request')` when the real file is
// `backend/models/ContactRequest.js` -- would throw "Cannot find module"
// at runtime. Deliberately only matches requires ending in a specific
// filename under models/ (e.g. "../models/X"), not barrel imports like
// `require('../models')`, to avoid false positives on the common
// `const { User } = require('../models')` pattern.
function checkUnresolvedModelPath(files) {
  const issues = [];

  const knownModelFilenames = new Set();
  for (const file of files) {
    if (/models\//i.test(file.path)) {
      knownModelFilenames.add(file.path.split("/").pop().replace(/\.[jt]sx?$/i, ""));
    }
  }
  if (knownModelFilenames.size === 0) return issues;

  const requirePattern = /require\(\s*['"]([^'"]*\/models\/([^'"\/]+))['"]\s*\)/g;
  for (const file of files) {
    if (/models\//i.test(file.path)) continue;
    const content = file.after || "";

    let match;
    while ((match = requirePattern.exec(content)) !== null) {
      const requiredPath = match[1];
      const requiredBase = match[2].replace(/\.[jt]sx?$/i, "");
      if (!knownModelFilenames.has(requiredBase)) {
        issues.push({
          path: file.path,
          type: "unresolved_model_path",
          detail: `Requires "${requiredPath}" but no model file named "${requiredBase}" exists -- known models: ${[...knownModelFilenames].join(", ")}.`
        });
      }
    }
  }
  return issues;
}

// Check 6: direct factory-model require. Model files in this codebase
// are commonly written as a FACTORY FUNCTION -- `module.exports = (db) =>
// { ... return Model; }` -- that only becomes a real, usable Sequelize
// model once called inside `../models/index.js` (the barrel file) with a
// real db instance. Requiring a factory-exporting model file DIRECTLY
// (`require('../models/X')`, not the barrel `require('../models')`) binds
// either the raw unexecuted function itself, or undefined if destructured
// (`const { X } = require('../models/X')`) -- both silently broken at
// runtime, even though the model NAME and require PATH are both perfectly
// correct (so neither checkUnimportedModelUsage nor
// checkUnresolvedModelPath catches this). Found via live testing:
// propertyRoutes.js and agentRoutes.js both did this in the same batch.
function isFactoryExportModel(modelFileContent) {
  return /module\.exports\s*=\s*\([^)]*\)\s*=>\s*\{/.test(modelFileContent);
}

function checkDirectFactoryRequire(files) {
  const issues = [];

  const factoryModelNames = new Set();
  for (const file of files) {
    if (/models\//i.test(file.path)) {
      const base = file.path.split("/").pop().replace(/\.[jt]sx?$/i, "");
      if (isFactoryExportModel(file.after || "")) {
        factoryModelNames.add(base);
      }
    }
  }
  if (factoryModelNames.size === 0) return issues;

  for (const file of files) {
    if (/models\//i.test(file.path)) continue;
    const content = file.after || "";

    for (const modelName of factoryModelNames) {
      const directRequirePattern = new RegExp(`require\\(\\s*['"][^'"]*\\/models\\/${modelName}['"]\\s*\\)`);
      if (directRequirePattern.test(content)) {
        issues.push({
          path: file.path,
          type: "direct_factory_require",
          detail: `Requires "${modelName}" directly from its model file, but ${modelName}.js exports a factory function that only becomes a real model when called inside the models barrel (../models/index.js) -- use "const { ${modelName} } = require('../models')" instead, or ${modelName} will be undefined or an unusable raw function.`
        });
      }
    }
  }
  return issues;
}

// Check 7: barrel require without destructuring. `const ModelName =
// require('../models')` (no curly braces) binds the ENTIRE models
// barrel object (which exports { User, Property, Favorite, ... } all
// together) to the variable ModelName -- not the model itself. Found
// live: favoriteRoutes.js did `const Favorite = require('../models');`
// then called `Favorite.create(...)`, which would fail since the
// barrel object itself has no .create method. This passed the
// existing isModelImported "direct assignment" check, since that
// check only verifies SOME require binds the name -- it doesn't
// distinguish a barrel-path require (wrong without destructuring)
// from a specific-model-file require (right, that's what direct
// assignment is actually for). Deliberately only matches a require
// path that resolves to exactly the barrel ('../models', './models',
// 'models', with no further /Something after it) -- a direct require
// of a specific model FILE is a different, already-covered case
// (checkDirectFactoryRequire).
function checkBarrelWithoutDestructuring(files) {
  const issues = [];

  const modelNames = new Set();
  for (const file of files) {
    if (/models\//i.test(file.path)) {
      modelNames.add(file.path.split("/").pop().replace(/\.[jt]sx?$/i, ""));
    }
  }
  if (modelNames.size === 0) return issues;

  const directBarrelPattern = /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]((?:\.\.?\/)*models)['"]\s*\)/g;

  for (const file of files) {
    if (/models\//i.test(file.path)) continue;
    const content = file.after || "";

    let match;
    while ((match = directBarrelPattern.exec(content)) !== null) {
      const varName = match[1];
      if (modelNames.has(varName)) {
        issues.push({
          path: file.path,
          type: "barrel_without_destructuring",
          detail: `Requires the models barrel directly as "${varName}" (\`const ${varName} = require('${match[2]}')\`) instead of destructuring -- this binds the WHOLE barrel object, not the ${varName} model. Use "const { ${varName} } = require('${match[2]}')" instead.`
        });
      }
    }
  }
  return issues;
}

// Check 8: undefined Sequelize association target. `ModelA.belongsToMany
// (ModelB, ...)` / `.hasMany(ModelB)` / `.hasOne(ModelB)` / `.belongsTo
// (ModelB)` reference a second model at MODULE LOAD TIME (not inside a
// function), so if ModelB is never imported/defined in that file, the
// require() itself throws immediately -- not just a specific route
// handler. Distinct from checkUnimportedModelUsage: that check skips
// files under models/ entirely (models aren't checked against
// themselves), but association bugs commonly happen INSIDE a model
// file referencing another model it never imported. Found live:
// User.js called User.belongsToMany(Produce, ...), User.hasMany(Buyer),
// Buyer.belongsTo(User) with neither Produce nor Buyer ever required.
const ASSOCIATION_METHODS = ["belongsToMany", "hasMany", "hasOne", "belongsTo"];

function isModelDefinedLocally(content, modelName) {
  const viaConst = new RegExp(`(?:const|let|var)\\s+${modelName}\\s*=\\s*sequelize\\.define\\s*\\(`);
  const viaLiteral = new RegExp(`sequelize\\.define\\s*\\(\\s*['"]${modelName}['"]`);
  return viaConst.test(content) || viaLiteral.test(content);
}

function checkUndefinedAssociationTarget(files) {
  const issues = [];

  // No modelNames pre-filter: the original bug (User.js referencing
  // Produce/Buyer) involved model names that had NO file in the batch
  // at all, which a "does a file exist for this name" gate would always
  // skip. Instead, treat any capitalized identifier passed as the first
  // arg to an association method as a model reference, and flag it
  // unless it's actually imported or defined locally in this file.
  const assocPattern = new RegExp(`(\\w+)\\.(?:${ASSOCIATION_METHODS.join("|")})\\s*\\(\\s*(\\w+)`, "g");

  for (const file of files) {
    const content = file.after || "";
    let match;
    while ((match = assocPattern.exec(content)) !== null) {
      const subjectModel = match[1];
      const targetModel = match[2];

      // Check the subject (Model.belongsTo(...)) and the argument
      // (...belongsTo(Model)) independently -- either one can be the
      // undefined variable. Real bug: `Buyer.belongsTo(User)` where
      // User was fine but Buyer itself was never defined.
      for (const candidate of [subjectModel, targetModel]) {
        if (!/^[A-Z]/.test(candidate)) continue; // skip option objects / lowercase args
        if (isModelImported(content, candidate) || isModelDefinedLocally(content, candidate)) continue;

        issues.push({
          path: file.path,
          type: "undefined_association_target",
          detail: `Calls an association (\`${match[0]}...\`) involving "${candidate}", but "${candidate}" is never imported or defined in this file -- will throw at module load time, not just when a route is hit.`
        });
      }
    }
  }
  return issues;
}

// Check 9 (best-effort): frontend/backend response-field mismatch. A
// frontend file reads response.data.FIELD, but no backend route file in
// this batch ever sends a "FIELD" key in any res.json({...}) call --
// that field will always be undefined. Deliberately combines ALL sent
// keys across ALL route files in the batch (rather than trying to
// correlate a specific axios URL to a specific route's exact response
// shape, which would be fragile with regex alone) -- this trades some
// precision for a much lower false-positive rate, since it only flags a
// field that's NEVER sent anywhere, not one sent by a different route
// than the one called. Found live: SignupForm.js checked
// response.data.success, but no route anywhere sent a "success" key.
function extractResJsonKeys(routeContent) {
  const keys = new Set();
  const jsonCallPattern = /res(?:\.status\s*\(\s*\d+\s*\))?\.json\s*\(\s*\{([^}]*)\}/g;
  let m;
  while ((m = jsonCallPattern.exec(routeContent)) !== null) {
    // Split top-level properties on commas (good enough for the flat,
    // single-level object literals res.json({...}) is normally called
    // with -- nested braces/values aren't expected here). For each
    // property, prefer the part before ":" if present (explicit
    // key: value); otherwise the whole trimmed segment IS the key,
    // since it's an ES6 shorthand property like `token` in
    // `res.json({ message: '...', token, user })`. The original regex
    // only matched the ":"-form and silently dropped every shorthand
    // key, which meant legitimately-sent fields were reported as
    // never sent.
    const props = m[1].split(",");
    for (const prop of props) {
      const trimmed = prop.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(":");
      const key = colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx).trim();
      const keyMatch = key.match(/^[\w$]+$/);
      if (keyMatch) keys.add(keyMatch[0]);
    }
  }
  return keys;
}

function checkFrontendBackendResponseMismatch(files) {
  const issues = [];

  const routeFiles = files.filter((f) => /routes?\//i.test(f.path));
  if (routeFiles.length === 0) return issues;

  const allSentKeys = new Set();
  for (const rf of routeFiles) {
    for (const k of extractResJsonKeys(rf.after || "")) allSentKeys.add(k);
  }
  if (allSentKeys.size === 0) return issues;

  for (const file of files) {
    if (!/\.[jt]sx?$/i.test(file.path)) continue;
    if (/routes?\//i.test(file.path) || /models\//i.test(file.path)) continue;
    const content = file.after || "";

    // Don't assume the axios result is named "response" or "res" --
    // the real bug used `const hashedPassword = await axios.post(...)`.
    // First collect every variable that an awaited axios call was
    // assigned to, then check THAT name's .data.field accesses.
    const assignPattern = /(?:const|let|var)\s+(\w+)\s*=\s*await\s+axios\s*\.\s*\w+\s*\(/g;
    const axiosVarNames = new Set();
    let am;
    while ((am = assignPattern.exec(content)) !== null) {
      axiosVarNames.add(am[1]);
    }
    if (axiosVarNames.size === 0) continue;

    const checked = new Set();
    for (const varName of axiosVarNames) {
      const accessPattern = new RegExp(`\\b${varName}\\.data\\.(\\w+)`, "g");
      let match;
      while ((match = accessPattern.exec(content)) !== null) {
        const field = match[1];
        const dedupeKey = `${varName}.${field}`;
        if (checked.has(dedupeKey)) continue;
        checked.add(dedupeKey);
        if (!allSentKeys.has(field)) {
          issues.push({
            path: file.path,
            type: "response_field_mismatch",
            detail: `Reads "${varName}.data.${field}" but no backend route in this batch's res.json(...) calls ever sends a "${field}" key -- this field will always be undefined.`
          });
        }
      }
    }
  }
  return issues;
}

// Check 10: destructured plain-export model. Mirrors checkBarrelWithoutDestructuring's
// pattern but for the inverse mistake: a model file that exports the
// Sequelize model DIRECTLY (`module.exports = sequelize.define(...)`,
// not wrapped in an object and not the factory-function pattern already
// covered by checkDirectFactoryRequire) gets destructured elsewhere
// (`const { User } = require('../models/User')`) instead of assigned
// directly (`const User = require('../models/User')`). Destructuring a
// property that was never exported as a named key silently binds
// undefined. Found live: userRoutes.js did this for User.js while
// courseRoutes.js in the SAME batch correctly used the direct-assignment
// form for the identical export style on Course.js -- proving this is a
// real, inconsistent mistake the model makes, not a deliberate choice.
function isPlainDefineExportModel(modelFileContent) {
  return /module\.exports\s*=\s*sequelize\.define\s*\(/.test(modelFileContent);
}

function checkDestructuredPlainExport(files) {
  const issues = [];

  const plainExportModelNames = new Set();
  for (const file of files) {
    if (/models\//i.test(file.path)) {
      const base = file.path.split("/").pop().replace(/\.[jt]sx?$/i, "");
      if (isPlainDefineExportModel(file.after || "")) {
        plainExportModelNames.add(base);
      }
    }
  }
  if (plainExportModelNames.size === 0) return issues;

  for (const file of files) {
    if (/models\//i.test(file.path)) continue;
    const content = file.after || "";

    for (const modelName of plainExportModelNames) {
      const destructurePattern = new RegExp(`\\{[^}]*\\b${modelName}\\b[^}]*\\}\\s*=\\s*require\\s*\\(\\s*['"][^'"]*\\/models\\/${modelName}['"]\\s*\\)`);
      if (destructurePattern.test(content)) {
        issues.push({
          path: file.path,
          type: "destructured_plain_export",
          detail: `Destructures "{ ${modelName} }" from its model file, but ${modelName}.js exports the model directly (\`module.exports = sequelize.define(...)\`), not as a named property -- this binds ${modelName} to undefined. Use "const ${modelName} = require('../models/${modelName}')" instead.`
        });
      }
    }
  }
  return issues;
}

// Check 11: missing database connection module. Model files commonly
// require a relative connection module ('../db', '../database',
// '../sequelize', '../connection') assuming it already exists, but
// nothing in the current batch creates one and it may never have been
// created in any earlier batch either. Scoped deliberately narrow: only
// files under models/, only these 4 specific basenames (the ones
// actually observed live -- Property.js requiring '../database' in one
// batch, User/Course/Registration.js requiring '../db' in another, both
// real batches generated tonight) -- a broad "any missing relative
// require" check would have far too many false positives (intentional
// future files, files from batches outside what this validator can
// see). Existence is checked against existingConnectionModules, a Set
// gathered by the CALLER via real fs.existsSync checks against the
// actual workspace on disk -- deliberately not just the current batch's
// files, specifically to avoid falsely flagging a connection module
// that was legitimately created in an earlier batch this validator has
// no other visibility into.
const CONNECTION_MODULE_BASENAMES = ["db", "database", "sequelize", "connection"];

function checkMissingConnectionModule(files, existingConnectionModules) {
  const issues = [];
  const existing = existingConnectionModules || new Set();

  const requirePattern = /require\(\s*['"](\.\.?\/(?:[^'"\/]+\/)*(db|database|sequelize|connection))['"]\s*\)/g;

  for (const file of files) {
    if (!/models\//i.test(file.path)) continue;
    const content = file.after || "";

    let match;
    while ((match = requirePattern.exec(content)) !== null) {
      const requiredPath = match[1];
      const basename = match[2];
      if (!existing.has(basename)) {
        issues.push({
          path: file.path,
          type: "missing_connection_module",
          detail: `Requires "${requiredPath}" as its database connection, but no ${basename}.js file exists in the workspace yet (from this batch or an earlier one) -- this will throw "Cannot find module" the moment ${file.path} loads.`
        });
      }
    }
  }
  return issues;
}

function validateGeneratedCode(files, blueprint, existingConnectionModules) {
  return [
    ...checkOrmMethodMismatch(files, blueprint),
    ...checkUnimportedModelUsage(files),
    ...checkModelBypass(files),
    ...checkFieldReferenceMismatch(files),
    ...checkUnresolvedModelPath(files),
    ...checkDirectFactoryRequire(files),
    ...checkBarrelWithoutDestructuring(files),
    ...checkUndefinedAssociationTarget(files),
    ...checkFrontendBackendResponseMismatch(files),
    ...checkDestructuredPlainExport(files),
    ...checkMissingConnectionModule(files, existingConnectionModules)
  ];
}

module.exports = {
  validateGeneratedCode,
  checkOrmMethodMismatch,
  checkUnimportedModelUsage,
  checkModelBypass,
  checkFieldReferenceMismatch,
  checkUnresolvedModelPath,
  checkDirectFactoryRequire,
  checkBarrelWithoutDestructuring,
  checkUndefinedAssociationTarget,
  checkFrontendBackendResponseMismatch,
  checkDestructuredPlainExport,
  checkMissingConnectionModule,
  CONNECTION_MODULE_BASENAMES
};
