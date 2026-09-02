import assert from "node:assert/strict";
import test from "node:test";

import {
  SECURE_STORAGE_MAX_KEY_LENGTH,
  SECURE_STORAGE_MAX_VALUE_LENGTH,
  createSecureStorage,
} from "../dist/index.js";

function memoryAdapter() {
  const values = new Map();
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

test("stores bounded strings and preserves empty secrets", async () => {
  const adapter = memoryAdapter();
  const storage = createSecureStorage(adapter);

  await storage.setItem("session", "");
  assert.equal(await storage.getItem("session"), "");
  await storage.setItem("session", "opaque-token");
  assert.equal(await storage.getItem("session"), "opaque-token");
  await storage.removeItem("session");
  assert.equal(await storage.getItem("session"), null);
  assert.ok(Object.isFrozen(storage));
});

test("serializes calls even when native promises settle out of order", async () => {
  const calls = [];
  const releases = [];
  const storage = createSecureStorage({
    async getItem(key) {
      calls.push(["get", key]);
      return null;
    },
    setItem(key, value) {
      calls.push(["set", key, value]);
      return new Promise((resolve) => releases.push(resolve));
    },
    async removeItem(key) {
      calls.push(["remove", key]);
    },
  });

  const write = storage.setItem("session", "first");
  const remove = storage.removeItem("session");
  await Promise.resolve();
  assert.deepEqual(calls, [["set", "session", "first"]]);
  releases.shift()();
  await write;
  await remove;
  assert.deepEqual(calls, [
    ["set", "session", "first"],
    ["remove", "session"],
  ]);
});

test("continues the operation queue after a native rejection", async () => {
  const expected = new Error("write failed");
  const adapter = memoryAdapter();
  adapter.setItem = async () => {
    throw expected;
  };
  const storage = createSecureStorage(adapter);

  await assert.rejects(storage.setItem("session", "token"), expected);
  assert.equal(await storage.getItem("session"), null);
});

test("rejects malformed adapters, keys, values, and native results", async () => {
  assert.throws(() => createSecureStorage(null), /must be an object/u);
  assert.throws(() => createSecureStorage({}), /getItem/u);
  const storage = createSecureStorage(memoryAdapter());
  await assert.rejects(storage.getItem(""), /keys/u);
  await assert.rejects(
    storage.getItem("x".repeat(SECURE_STORAGE_MAX_KEY_LENGTH + 1)),
    /keys/u,
  );
  await assert.rejects(storage.getItem("bad\0key"), /keys/u);
  await assert.rejects(storage.setItem("key", null), /values/u);
  await assert.rejects(
    storage.setItem("key", "x".repeat(SECURE_STORAGE_MAX_VALUE_LENGTH + 1)),
    /values/u,
  );
  const malformed = createSecureStorage({
    async getItem() {
      return 42;
    },
    async setItem() {},
    async removeItem() {},
  });
  await assert.rejects(malformed.getItem("key"), /native secure-storage/u);
});
