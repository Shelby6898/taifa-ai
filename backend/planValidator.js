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
// Each mention of the trigger phrase is checked for nearby deferral
// language (e.g. "Android comes later") within DEFERRAL_WINDOW characters;
// a mention is only treated as a real requirement if at least one
// occurrence has no such deferral language nearby. This lets deferral
// statements like "iOS can be added in a later release" pass through
// without a false positive, while still catching genuine same-release
// requirements.
const DEFERRAL_WINDOW = 60;
const DEFERRAL_PATTERN = /\b(later|come later|future release|future phase|next release|next phase|phase 2|v2|subsequent release|added later|not (?:in|for|part of) (?:the )?(?:first|initial|mvp|v1)|afterward|down the line)\b/i;

const REQUIRED_PATTERNS = [
  { phrase: /android/gi, area: "Android", keyword: /android|kotlin/i },
];

function hasNonDeferredMatch(text, phrase) {
  const re = new RegExp(phrase.source, phrase.flags.includes("g") ? phrase.flags : phrase.flags + "g");
  let match;
  while ((match = re.exec(text)) !== null) {
    const start = Math.max(0, match.index - DEFERRAL_WINDOW);
    const end = Math.min(text.length, match.index + match[0].length + DEFERRAL_WINDOW);
    const context = text.slice(start, end);
    if (!DEFERRAL_PATTERN.test(context)) {
      return true;
    }
  }
  return false;
}

function checkMissingRequiredScope(files, requirementsText) {
  const issues = [];
  if (!requirementsText) return issues;

  const text = requirementsText.toLowerCase();

  for (const rule of REQUIRED_PATTERNS) {
    if (hasNonDeferredMatch(text, rule.phrase)) {
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
