// Detects a specific, high-confidence class of regression: an Express
// route that existed in the prior version of a file but is missing (or
// has fewer arguments -- meaning less middleware, e.g. a dropped rate
// limiter) in the newly proposed version.
//
// This is deliberately narrow and heuristic, not a full AST diff. It
// targets exactly the failure mode observed repeatedly in manual
// testing: an edit silently reverting a route to a prior, less-guarded
// state, with no other signal (syntax/import checks, self-review, even
// passing tests) catching it.

// Given a string starting right after an opening '(', find the matching
// closing ')', respecting nested parens/braces/brackets and string
// literals. Returns the index of the matching ')' or -1 if unbalanced.
function findMatchingParen(str, startIdx) {
  let depth = 1;
  let i = startIdx;
  let inString = null; // null, or the quote character we're inside

  while (i < str.length && depth > 0) {
    const ch = str[i];

    if (inString) {
      if (ch === '\\') {
        i += 2; // skip escaped character
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }

    i++;
  }

  return -1; // unbalanced -- caller should treat this defensively
}

// Splits the contents of a function-call's argument list on top-level
// commas only (ignoring commas nested inside (), {}, [], or strings),
// so we get an accurate count of arguments passed to a route handler.
function splitTopLevelArgs(argsStr) {
  const args = [];
  let depth = 0;
  let current = '';
  let inString = null;

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];

    if (inString) {
      current += ch;
      if (ch === '\\') {
        i++;
        current += argsStr[i] || '';
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      current += ch;
    } else if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

// Extracts Express-style route registrations from source content:
// router.get('/path', ...args), app.post("/path", ...args), etc.
// Returns an array of { method, path, argCount, rawArgs }.
function extractRoutes(content) {
  const routes = [];
  const routeCallPattern = /\b(router|app)\.(get|post|put|delete|patch|use)\s*\(\s*(['"`])((?:\\.|(?!\3).)*)\3\s*,/g;

  let match;
  while ((match = routeCallPattern.exec(content)) !== null) {
    const [, , method, , path] = match;
    const openParenIdx = content.indexOf('(', match.index);
    const closeParenIdx = findMatchingParen(content, openParenIdx + 1);

    if (closeParenIdx === -1) continue; // unbalanced -- skip rather than misreport

    const fullArgsStr = content.slice(openParenIdx + 1, closeParenIdx);
    const allArgs = splitTopLevelArgs(fullArgsStr);
    // The route path itself is always the first argument -- exclude it
    // so argCount reflects only middleware + handler, which is what
    // actually matters for detecting a dropped middleware like a rate
    // limiter or auth check.
    const middlewareAndHandlerArgs = allArgs.slice(1);

    routes.push({
      method: method.toLowerCase(),
      path,
      argCount: middlewareAndHandlerArgs.length,
      rawArgs: middlewareAndHandlerArgs
    });
  }

  return routes;
}

// Compares the route set of `before` and `after` source content and
// returns a list of human-readable regression warnings. Returns an
// empty array if no regressions are detected (including when `before`
// is empty/null, e.g. for brand-new files -- there's nothing to
// regress from).
function detectRouteRegressions(before, after) {
  if (!before) return [];

  const beforeRoutes = extractRoutes(before);
  const afterRoutes = extractRoutes(after);
  const warnings = [];

  for (const beforeRoute of beforeRoutes) {
    const match = afterRoutes.find(
      (r) => r.method === beforeRoute.method && r.path === beforeRoute.path
    );

    if (!match) {
      warnings.push(
        `Route ${beforeRoute.method.toUpperCase()} '${beforeRoute.path}' existed before this change and appears to be missing now.`
      );
      continue;
    }

    if (match.argCount < beforeRoute.argCount) {
      warnings.push(
        `Route ${beforeRoute.method.toUpperCase()} '${beforeRoute.path}' had ${beforeRoute.argCount} argument(s) before (e.g. middleware + handler) and now has only ${match.argCount} -- something may have been silently dropped (e.g. a middleware like rate limiting or auth).`
      );
    }
  }

  return warnings;
}

module.exports = { extractRoutes, detectRouteRegressions };
