const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  extractRequiredPackages,
  checkUndeclaredDependencies,
  checkPackageVersionsExist,
  normalizePackageName
} = require('./packageJsonChecker');

// Self-contained fixture: created before tests run, removed after --
// never depends on external shell state being set up (and remembered)
// correctly beforehand.
const FIXTURE_DIR = path.join(os.tmpdir() || require('os').homedir(), 'taifa-ai-pkgtest-fixture');

before(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'package.json'),
    JSON.stringify({
      name: 'test-project',
      dependencies: {
        express: '^4.17.1',
        'firebase-admin': '^13.10.0'
      }
    }, null, 2)
  );
});

after(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

test('normalizePackageName handles plain, scoped, and subpath specifiers', () => {
  assert.strictEqual(normalizePackageName('express'), 'express');
  assert.strictEqual(normalizePackageName('firebase-admin/firestore'), 'firebase-admin');
  assert.strictEqual(normalizePackageName('@testing-library/react'), '@testing-library/react');
  assert.strictEqual(normalizePackageName('@testing-library/react/dist/foo'), '@testing-library/react');
  assert.strictEqual(normalizePackageName('./localFile'), null);
  assert.strictEqual(normalizePackageName('../models/User'), null);
  assert.strictEqual(normalizePackageName('fs'), null); // Node builtin
  assert.strictEqual(normalizePackageName('node:crypto'), null);
});

test('extractRequiredPackages finds require() and import specifiers, ignoring relative paths and builtins', () => {
  const content = `
    const express = require('express');
    const bcrypt = require('bcryptjs');
    const User = require('../models/User');
    import React from 'react';
    import { useState } from 'react';
    const fs = require('fs');
  `;
  const packages = extractRequiredPackages(content);
  assert.ok(packages.has('express'));
  assert.ok(packages.has('bcryptjs'));
  assert.ok(packages.has('react'));
  assert.ok(!packages.has('../models/User'));
  assert.ok(!packages.has('fs'));
});

test('checkUndeclaredDependencies catches a real-world case: bcrypt used but never declared in package.json', () => {
  const content = `
    const express = require('express');
    const bcrypt = require('bcrypt');
    const firebaseAdmin = require('firebase-admin');
  `;
  const undeclared = checkUndeclaredDependencies(
    path.join(FIXTURE_DIR, 'someFile.js'),
    content
  );
  assert.deepStrictEqual(undeclared.sort(), ['bcrypt']);
});

test('checkUndeclaredDependencies reports nothing when all requires are properly declared', () => {
  const content = `
    const express = require('express');
    const admin = require('firebase-admin');
  `;
  const undeclared = checkUndeclaredDependencies(
    path.join(FIXTURE_DIR, 'someFile.js'),
    content
  );
  assert.deepStrictEqual(undeclared, []);
});

test('checkPackageVersionsExist catches the real tonight bug: firebase-admin@^9.20.0 never existed', async () => {
  const fakePackageJson = JSON.stringify({
    dependencies: { "firebase-admin": "^9.20.0" }
  });
  const result = await checkPackageVersionsExist(fakePackageJson);
  assert.strictEqual(result.invalidVersions.length, 1);
  assert.strictEqual(result.invalidVersions[0].name, 'firebase-admin');
  assert.strictEqual(result.invalidVersions[0].exactVersion, '9.20.0');
});

test('checkPackageVersionsExist correctly passes a real, currently-installed version', async () => {
  const realPackageJson = JSON.stringify({
    dependencies: { "firebase-admin": "^13.10.0" }
  });
  const result = await checkPackageVersionsExist(realPackageJson);
  assert.strictEqual(result.invalidVersions.length, 0);
});
