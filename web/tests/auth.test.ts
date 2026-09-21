import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkKey, createSession, validSession, SESSION_SECONDS } from "../src/lib/auth";

process.env.SESSION_SECRET = "a".repeat(64);
process.env.LOGIN_KEY_HASH = createHash("sha256").update("test-only-key").digest("hex");
test("key check requires exact key", () => {
  assert.equal(checkKey("test-only-key"), true);
  assert.equal(checkKey("wrong"), false);
  assert.equal(checkKey(" test-only-key "), false);
});
test("session signature rejects tampering, expiry, and changed signing key", () => {
  const now = Date.now();
  const token = createSession(now);
  assert.equal(validSession(token, now), true);
  assert.equal(validSession(token, now + SESSION_SECONDS * 1000), false);
  assert.equal(validSession(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), now), false);
  assert.equal(validSession("forged", now), false);
  process.env.SESSION_SECRET = "b".repeat(64);
  assert.equal(validSession(token, now), false);
  process.env.SESSION_SECRET = "a".repeat(64);
});
