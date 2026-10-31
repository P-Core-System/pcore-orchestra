"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { login } = require("./auth.js");

test("accepts a valid username and password", () => {
  assert.strictEqual(login("alice", "s3cret-pass"), true);
});

test("rejects a wrong password", () => {
  assert.strictEqual(login("alice", "wrong"), false);
});

test("rejects an unknown user", () => {
  assert.strictEqual(login("mallory", "s3cret-pass"), false);
});

test("rejects an empty password", () => {
  assert.strictEqual(login("alice", ""), false);
});
