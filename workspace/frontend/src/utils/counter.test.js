import { test } from "node:test";
import assert from "node:assert";

import createCounter from "./counter.js";

test("createCounter should increment", () => {
  const counter = createCounter();
  counter.increment();
  assert.strictEqual(counter.getValue(), 1);
});

test("createCounter should decrement", () => {
  const counter = createCounter();
  counter.decrement();
  assert.strictEqual(counter.getValue(), -1);
});

test("createCounter should return the initial value after reset", () => {
  const counter = createCounter();
  counter.increment();
  counter.reset();
  assert.strictEqual(counter.getValue(), 0);
});