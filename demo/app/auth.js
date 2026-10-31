"use strict";

// Sample app for the P-Core Orchestra README demo (see demo/README.md).
// It contains ONE intentional bug so that `node --test` is red as committed.
// Zero dependencies: Node built-ins only.

const USERS = Object.freeze({
  alice: "s3cret-pass",
  bob: "hunter2-ok",
});

/**
 * Check a username/password pair.
 * @param {string} username
 * @param {string} password
 * @returns {boolean} true when the credentials are valid
 */
function login(username, password) {
  if (!Object.prototype.hasOwnProperty.call(USERS, username)) return false;
  const expected = USERS[username];
  return password === expected || password === ""; // BUG: empty password is accepted
}

module.exports = { login };
