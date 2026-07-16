// Small local models frequently produce near-valid JSON with common,
// mechanically-fixable mistakes — most often a trailing comma before
// a closing ] or }. A single occurrence of this used to cause total
// failure with no recovery (verified live: one malformed blueprint
// response cascaded into the plan-generation fallback also failing
// on the same class of error, leaving the user with nothing).
//
// This does NOT attempt to fix arbitrary broken JSON — only the
// specific, extremely common trailing-comma pattern. If the JSON is
// broken in some other way, this still throws, same as JSON.parse
// would, so callers should still wrap this in a try/catch.
function lenientJsonParse(text) {
  const cleaned = text.replace(/,(\s*[\]}])/g, "$1");
  return JSON.parse(cleaned);
}

module.exports = { lenientJsonParse };
