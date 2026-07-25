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
  assert.strictEqual(result.allSucceeded, true);
  assert.strictEqual(result.appliedCount, 1);
  assert.strictEqual(result.content, `line one\nconst x = 2;\nline three`);
});

test('applies multiple blocks in sequence when all match', () => {
  const original = `const a = 1;\nconst b = 2;\nconst c = 3;`;
  const blocks = [
    { search: 'const a = 1;', replace: 'const a = 10;' },
    { search: 'const c = 3;', replace: 'const c = 30;' }
  ];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.allSucceeded, true);
  assert.strictEqual(result.appliedCount, 2);
  assert.strictEqual(result.content, `const a = 10;\nconst b = 2;\nconst c = 30;`);
});

test('reports failure clearly when the SEARCH text does not exist verbatim in the file', () => {
  const original = `const x = 1;`;
  const blocks = [{ search: 'const y = 1;', replace: 'const y = 2;' }];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.allSucceeded, false);
  assert.strictEqual(result.noneSucceeded, true);
  assert.strictEqual(result.failedBlocks.length, 1);
  assert.match(result.failedBlocks[0].reason, /does not appear verbatim/);
});

test('reports failure clearly when the SEARCH text is ambiguous (matches more than once)', () => {
  const original = `const x = 1;\nconst x = 1;`;
  const blocks = [{ search: 'const x = 1;', replace: 'const x = 2;' }];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.allSucceeded, false);
  assert.match(result.failedBlocks[0].reason, /matches 2 different locations/);
});

test('fails on an empty SEARCH block rather than matching everywhere, without blocking other blocks', () => {
  const original = `const a = 1;\nconst b = 2;`;
  const blocks = [
    { search: '', replace: 'new content' },
    { search: 'const b = 2;', replace: 'const b = 20;' }
  ];

  const result = applySearchReplaceBlocks(original, blocks);
  assert.strictEqual(result.appliedCount, 1);
  assert.strictEqual(result.failedBlocks.length, 1);
  assert.match(result.failedBlocks[0].reason, /empty/);
  assert.strictEqual(result.content, `const a = 1;\nconst b = 20;`);
});

test('PARTIAL APPLICATION: applies the blocks that match and reports the ones that fail, rather than discarding everything', () => {
  const original = `router.post('/register', async (req, res) => {\n  // register logic\n});\n\nrouter.post('/login', async (req, res) => {\n  // login logic\n});`;

  const blocks = [
    {
      // This one matches -- should be applied.
      search: `router.post('/register', async (req, res) => {`,
      replace: `router.post('/register', registerRateLimiter, async (req, res) => {`
    },
    {
      // This one does NOT match anything real -- should fail without
      // affecting the block above.
      search: `router.post('/nonexistent-route', async (req, res) => {`,
      replace: `router.post('/nonexistent-route', someMiddleware, async (req, res) => {`
    }
  ];

  const result = applySearchReplaceBlocks(original, blocks);

  assert.strictEqual(result.allSucceeded, false);
  assert.strictEqual(result.noneSucceeded, false);
  assert.strictEqual(result.appliedCount, 1);
  assert.strictEqual(result.totalBlocks, 2);
  assert.strictEqual(result.failedBlocks.length, 1);
  assert.strictEqual(result.failedBlocks[0].index, 1);

  // The successful block WAS applied...
  assert.match(result.content, /router\.post\('\/register', registerRateLimiter,/);
  // ...and the unrelated /login route is still byte-for-byte untouched.
  assert.match(result.content, /router\.post\('\/login', async \(req, res\) => \{\n  \/\/ login logic\n\}\);/);
});

test('proves the core regression-proofing property: a scoped patch adding rate limiting to ONE route leaves an unrelated route completely untouched', () => {
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
  assert.strictEqual(result.allSucceeded, true);
  assert.match(result.content, /router\.post\('\/register', registerRateLimiter,/);
  assert.match(result.content, /router\.post\('\/login', loginRateLimiter, async \(req, res\) => \{\n  \/\/ login logic\n\}\);/);
});
