import assert from "node:assert/strict";
import test from "node:test";

import { createAsyncStorage3KeyValueStorage } from "../dist/async-storage-3.js";
import { createKeyValueStorage } from "../dist/index.js";

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

test("validates and namespaces a native key-value adapter", async () => {
  const adapter = memoryAdapter();
  const storage = createKeyValueStorage(adapter, { prefix: "navigation" });

  await storage.setItem("root", "persisted");
  assert.equal(adapter.values.get("navigation:root"), "persisted");
  assert.equal(await storage.getItem("root"), "persisted");
  await storage.removeItem("root");
  assert.equal(await storage.getItem("root"), null);
});

test("rejects malformed keys, values, adapters, and native results", async () => {
  assert.throws(() => createKeyValueStorage({}), /getItem/);
  const malformed = createKeyValueStorage({
    async getItem() {
      return 42;
    },
    async setItem() {},
    async removeItem() {},
  });

  await assert.rejects(malformed.getItem("key"), /non-string/);
  await assert.rejects(malformed.getItem(""), /Storage key/);
  await assert.rejects(malformed.setItem("key", null), /must be strings/);
});

test("narrows an injected AsyncStorage 3 ABI without its JavaScript wrapper", async () => {
  const values = new Map();
  const calls = [];
  const native = {
    marker: "native-this",
    async getValues(databaseName, keys) {
      assert.equal(this.marker, "native-this");
      assert.ok(Object.isFrozen(keys));
      calls.push(["getValues", databaseName, [...keys]]);
      return keys.map((key) => ({ key, value: values.get(key) ?? null }));
    },
    async setValues(databaseName, entries) {
      assert.equal(this.marker, "native-this");
      assert.ok(Object.isFrozen(entries));
      assert.ok(entries.every(Object.isFrozen));
      calls.push(["setValues", databaseName, [...entries]]);
      for (const entry of entries) values.set(entry.key, entry.value);
      return entries;
    },
    async removeValues(databaseName, keys) {
      assert.equal(this.marker, "native-this");
      assert.ok(Object.isFrozen(keys));
      calls.push(["removeValues", databaseName, [...keys]]);
      for (const key of keys) values.delete(key);
    },
  };
  const storage = createAsyncStorage3KeyValueStorage(native, {
    databaseName: "solid_native_test",
    prefix: "proof",
  });

  assert.equal(await storage.getItem("account"), null);
  await storage.setItem("account", "active");
  assert.equal(await storage.getItem("account"), "active");
  await storage.removeItem("account");
  assert.equal(await storage.getItem("account"), null);
  assert.deepEqual(calls, [
    ["getValues", "solid_native_test", ["proof:account"]],
    [
      "setValues",
      "solid_native_test",
      [{ key: "proof:account", value: "active" }],
    ],
    ["getValues", "solid_native_test", ["proof:account"]],
    ["removeValues", "solid_native_test", ["proof:account"]],
    ["getValues", "solid_native_test", ["proof:account"]],
  ]);
});

test("fails closed for malformed AsyncStorage 3 bindings and results", async () => {
  assert.throws(
    () =>
      createAsyncStorage3KeyValueStorage(
        {},
        { databaseName: "solid_native_test" },
      ),
    /getValues/u,
  );
  assert.throws(
    () =>
      createAsyncStorage3KeyValueStorage(
        {
          async getValues() {
            return [];
          },
          async setValues() {},
          async removeValues() {},
        },
        { databaseName: "" },
      ),
    /database name/u,
  );
  const malformed = (result) =>
    createAsyncStorage3KeyValueStorage(
      {
        async getValues() {
          return result;
        },
        async setValues() {},
        async removeValues() {},
      },
      { databaseName: "solid_native_test" },
    );
  await assert.rejects(malformed(null).getItem("key"), /at most one entry/u);
  await assert.rejects(
    malformed([{ key: "other", value: "value" }]).getItem("key"),
    /outside the requested string contract/u,
  );
  await assert.rejects(
    malformed([{ key: "key", value: 42 }]).getItem("key"),
    /outside the requested string contract/u,
  );
  await assert.rejects(
    malformed([{ key: "key" }]).getItem("key"),
    /malformed entry/u,
  );
});
