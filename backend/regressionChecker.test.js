const { test } = require('node:test');
const assert = require('node:assert');
const { detectRouteRegressions, extractRoutes } = require('./regressionChecker');

const BEFORE_BOTH_LIMITED = `
router.post('/register', registerRateLimiter, async (req, res) => {
  // ...
});

router.post('/login', loginRateLimiter, async (req, res) => {
  // ...
});
`;

test('extractRoutes finds both routes with the correct argument counts', () => {
  const routes = extractRoutes(BEFORE_BOTH_LIMITED);
  assert.strictEqual(routes.length, 2);
  assert.strictEqual(routes[0].method, 'post');
  assert.strictEqual(routes[0].path, '/register');
  assert.strictEqual(routes[0].argCount, 2); // registerRateLimiter, async handler
  assert.strictEqual(routes[1].argCount, 2);
});

test('catches the exact attempt-2 bug: /register silently loses its rate limiter while /login keeps it', () => {
  const AFTER_REGISTER_DROPPED = `
router.post('/register', async (req, res) => {
  // ...
});

router.post('/login', loginRateLimiter, async (req, res) => {
  // ...
});
`;

  const warnings = detectRouteRegressions(BEFORE_BOTH_LIMITED, AFTER_REGISTER_DROPPED);

  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /\/register/);
  assert.match(warnings[0], /now has only 1/);
});

test('catches the exact attempt-3 bug: both routes silently revert to no rate limiting at all', () => {
  const AFTER_FULL_REVERT = `
router.post('/register', async (req, res) => {
  // ...
});

router.post('/login', async (req, res) => {
  // ...
});
`;

  const warnings = detectRouteRegressions(BEFORE_BOTH_LIMITED, AFTER_FULL_REVERT);

  assert.strictEqual(warnings.length, 2);
  assert.match(warnings[0], /\/register/);
  assert.match(warnings[1], /\/login/);
});

test('reports no regressions when a route is correctly preserved with the same middleware', () => {
  const AFTER_UNCHANGED = BEFORE_BOTH_LIMITED;
  const warnings = detectRouteRegressions(BEFORE_BOTH_LIMITED, AFTER_UNCHANGED);
  assert.strictEqual(warnings.length, 0);
});

test('reports no regressions when a route gains additional middleware (not a regression)', () => {
  const AFTER_MORE_MIDDLEWARE = `
router.post('/register', registerRateLimiter, validateInput, async (req, res) => {
  // ...
});

router.post('/login', loginRateLimiter, async (req, res) => {
  // ...
});
`;
  const warnings = detectRouteRegressions(BEFORE_BOTH_LIMITED, AFTER_MORE_MIDDLEWARE);
  assert.strictEqual(warnings.length, 0);
});

test('reports a regression when an entire route disappears', () => {
  const AFTER_ROUTE_REMOVED = `
router.post('/login', loginRateLimiter, async (req, res) => {
  // ...
});
`;
  const warnings = detectRouteRegressions(BEFORE_BOTH_LIMITED, AFTER_ROUTE_REMOVED);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /missing now/);
});

test('reports no regressions for a brand-new file with no prior version', () => {
  const warnings = detectRouteRegressions(null, BEFORE_BOTH_LIMITED);
  assert.strictEqual(warnings.length, 0);
});

test('correctly handles route paths and handler bodies containing commas, parens, and nested braces', () => {
  const BEFORE_COMPLEX = `
router.post('/notes', authMiddleware, async (req, res) => {
  const x = someFunc(a, b, { key: 'value, with comma' });
  res.json({ a: 1, b: 2 });
});
`;
  const routes = extractRoutes(BEFORE_COMPLEX);
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0].argCount, 2); // authMiddleware, async handler -- the inner commas must NOT be counted as extra top-level args
});
