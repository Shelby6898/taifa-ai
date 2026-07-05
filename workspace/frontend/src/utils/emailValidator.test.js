import { test } from 'node:test';
import assert from 'node:assert';
import { isValidEmail } from './emailValidator.js';

test('accepts a standard valid email', () => {
  assert.strictEqual(isValidEmail('user@example.com'), true);
});

test('accepts an email with a subdomain', () => {
  assert.strictEqual(isValidEmail('user@mail.example.com'), true);
});

test('rejects an email with no @ symbol', () => {
  assert.strictEqual(isValidEmail('userexample.com'), false);
});

test('rejects an email with no domain', () => {
  assert.strictEqual(isValidEmail('user@'), false);
});

test('rejects an empty string', () => {
  assert.strictEqual(isValidEmail(''), false);
});
