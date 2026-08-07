// planValidator.js — mechanically checks an assembled plan against the
// approved architecture and stated requirements. Not an AI self-review:
// deterministic string/keyword checks only, same philosophy as
// regressionChecker.js and packageJsonChecker.js.

const NOSQL_TERMS = ["document", "firestore", "collection", "nosql"];
const SQL_DATABASES = ["postgresql", "postgres", "mysql", "mariadb", "sqlite", "sql server", "mssql"];

function checkVocabularyConsistency(files, blueprint) {
  const issues = [];
  if (!blueprint || !blueprint.database) return issues;

  const dbName = blueprint.database.toLowerCase();
  const isSqlDb = SQL_DATABASES.some((sql) => dbName.includes(sql));
  if (!isSqlDb) return issues;

  for (const file of files) {
    const desc = (file.description || "").toLowerCase();
    for (const term of NOSQL_TERMS) {
      if (desc.includes(term)) {
        issues.push({
          path: file.path,
          type: "vocabulary_inconsistency",
          detail: `Description uses NoSQL term "${term}" but architecture specifies ${blueprint.database} (a SQL database).`
        });
        break;
      }
    }
  }
  return issues;
}

// Phrases that signal a component/area was explicitly excluded from scope.
// Kept deliberately simple and literal — false negatives (missing an
// exclusion) are safer than false positives (blocking a legitimate file).
const EXCLUSION_PATTERNS = [
  { phrase: /frontend[:\s]*not needed/i, area: "frontend", pathHint: /^frontend\// },
  { phrase: /no frontend/i, area: "frontend", pathHint: /^frontend\// },
  { phrase: /api only/i, area: "frontend", pathHint: /^frontend\// },
];

function checkExcludedScope(files, requirementsText) {
  const issues = [];
  if (!requirementsText) return issues;

  const text = requirementsText.toLowerCase();
  const flaggedAreas = new Map(); // "path::area" -> true, so one file+area combo is only flagged once even if multiple phrases match

  for (const rule of EXCLUSION_PATTERNS) {
    if (rule.phrase.test(text)) {
      for (const file of files) {
        if (rule.pathHint.test(file.path)) {
          const key = `${file.path}::${rule.area}`;
          if (flaggedAreas.has(key)) continue;
          flaggedAreas.set(key, true);
          issues.push({
            path: file.path,
            type: "excluded_scope",
            detail: `Requirements explicitly excluded "${rule.area}", but this file falls under that area.`
          });
        }
      }
    }
  }
  return issues;
}

// Phrases that signal a component/platform is explicitly REQUIRED, and what
// path/description keyword should show up somewhere in the plan if it's
// actually been covered.
// Scoped deliberately to only what we've seen actually fail live —
// Android was omitted from a real plan despite being explicitly required.
// Not adding an iOS rule yet: the ticketing requirements say "iOS can be
// added in a later release," a deferral, not a requirement — a naive
// keyword match would have false-flagged a correctly-scoped plan. Add iOS
// (or other platforms) only once we have a real evidenced case and a
// pattern for distinguishing "required now" from "deferred."
const REQUIRED_PATTERNS = [
  { phrase: /android/i, area: "Android", keyword: /android|kotlin/i },
];

function checkMissingRequiredScope(files, requirementsText) {
  const issues = [];
  if (!requirementsText) return issues;

  const text = requirementsText.toLowerCase();

  for (const rule of REQUIRED_PATTERNS) {
    if (rule.phrase.test(text)) {
      const covered = files.some((f) =>
        rule.keyword.test(f.path) || rule.keyword.test(f.description || "")
      );
      if (!covered) {
        issues.push({
          type: "missing_required_scope",
          detail: `Requirements explicitly require "${rule.area}", but no planned file references it.`
        });
      }
    }
  }
  return issues;
}

module.exports = { checkVocabularyConsistency, checkExcludedScope, checkMissingRequiredScope };
