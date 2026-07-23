const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchReplaceBlocks, applySearchReplaceBlocks } = require('./searchReplaceParser');

test('parses a single well-formed SEARCH/REPLACE block', () => {
  const raw = `<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE`;

  const { blocks, parseError } = parseSearchReplaceBlocks(raw);
  assert.strictEqual(parseError, null);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].search, 'const x = 1;');
  assert.strictEqual(blocks[0].replace, 'const x = 2;');
});

test('parses multiple SEARCH/REPLACE blocks in one output', () => {
  const raw = `<<<<<<< SEARCH
const a = 1;
=======
const a = 10;
>>>>>>> REPLACE

<<<<<<< SEARCH
const b = 2;
=======
const b = 20;
>>>>>>> REPLACE`;

  const { blocks, parseError } = parseSearchReplaceBlocks(raw);
  assert.strictEqual(parseError, null);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].search, 'const a = 1;');
  assert.strictEqual(blocks[1].search, 'const b = 2;');
});

test('reports a parse error when no valid blocks exist at all', () => {
  const raw = `Sorry, I can't make that change. Here's why: ...`;
  const { blocks, parseError } = parseSearchReplaceBlocks(raw);
  assert.strictEqual(blocks.length, 0);
  assert.ok(parseError);
});

test('applies a single matching block correctly, leaving the rest of the file untouched', () => {
  const original = `line one\nconst x = 1;\nline three`;
  const blocks = [{ search: 'const x = 1;', replace: 'const x = 2;' }];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.content, `line one\nconst x = 2;\nline three`);
});

test('applies multiple blocks in sequence', () => {
  const original = `const a = 1;\nconst b = 2;\nconst c = 3;`;
  const blocks = [
    { search: 'const a = 1;', replace: 'const a = 10;' },
    { search: 'const c = 3;', replace: 'const c = 30;' }
  ];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.content, `const a = 10;\nconst b = 2;\nconst c = 30;`);
});

test('fails clearly when the SEARCH text does not exist verbatim in the file', () => {
  const original = `const x = 1;`;
  const blocks = [{ search: 'const y = 1;', replace: 'const y = 2;' }];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failedBlockIndex, 0);
  assert.match(result.reason, /does not appear verbatim/);
});

test('fails clearly when the SEARCH text is ambiguous (matches more than once)', () => {
  const original = `const x = 1;\nconst x = 1;`;
  const blocks = [{ search: 'const x = 1;', replace: 'const x = 2;' }];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.failedBlockIndex, 0);
  assert.match(result.reason, /matches 2 different locations/);
});

test('fails on an empty SEARCH block rather than matching everywhere', () => {
  const original = `some content`;
  const blocks = [{ search: '', replace: 'new content' }];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.success, false);
  assert.match(result.reason, /empty/);
});

test('proves the core regression-proofing property: a scoped patch adding rate limiting to ONE route leaves an unrelated route completely untouched', () => {
  // This mirrors the exact real bug from tonight: full-file regeneration
  // silently reverted the /login route's rate limiter while attempting
  // to add one to /register. A scoped patch can only touch what its
  // SEARCH block names -- there is no way for it to accidentally alter
  // unrelated code, because unrelated code is never even sent back by
  // the model as part of the "replace" text.
  const original = `router.post('/register', async (req, res) => {
  // register logic
});

router.post('/login', loginRateLimiter, async (req, res) => {
  // login logic
});`;

  const blocks = [
    {
      search: `router.post('/register', async (req, res) => {`,
      replace: `router.post('/register', registerRateLimiter, async (req, res) => {`
    }
  ];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.success, true);
  // The /register route now has the rate limiter...
  assert.match(result.content, /router\.post\('\/register', registerRateLimiter,/);
  // ...and the /login route, which the instruction never mentioned,
  // is byte-for-byte exactly as it was before.
  assert.match(result.content, /router\.post\('\/login', loginRateLimiter, async \(req, res\) => \{\n  \/\/ login logic\n\}\);/);
});
