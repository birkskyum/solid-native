import assert from "node:assert/strict";
import test from "node:test";

import {
  createAndroidImageAdapter,
  createIOSImageAdapter,
} from "../dist/react-native-adapter.js";

function androidModule() {
  return {
    calls: [],
    async getSize(uri) {
      this.calls.push(["getSize", uri]);
      return { width: 64, height: 32 };
    },
    async getSizeWithHeaders(uri, headers) {
      this.calls.push(["getSizeWithHeaders", uri, headers]);
      return { width: 128, height: 64 };
    },
    async prefetchImage(uri, requestId) {
      this.calls.push(["prefetchImage", uri, requestId]);
      return true;
    },
    abortRequest(requestId) {
      this.calls.push(["abortRequest", requestId]);
    },
    async queryCache(uris) {
      this.calls.push(["queryCache", uris]);
      return {};
    },
  };
}

test("maps the Android request-id and object-dimensions ABI exactly", async () => {
  const module = androidModule();
  const adapter = createAndroidImageAdapter(module);
  assert.deepEqual(
    await adapter.getDimensions({ uri: "https://images.example/a.png" }),
    { width: 64, height: 32 },
  );
  const headers = Object.freeze({ Authorization: "private" });
  assert.deepEqual(
    await adapter.getDimensions({
      uri: "https://images.example/b.png",
      headers,
    }),
    { width: 128, height: 64 },
  );
  assert.equal(
    await adapter.prefetchImage("https://images.example/a.png", 41),
    true,
  );
  adapter.cancelPrefetch(41);
  assert.deepEqual(await adapter.queryCache(["file:///a.png"]), {});
  assert.deepEqual(module.calls, [
    ["getSize", "https://images.example/a.png"],
    ["getSizeWithHeaders", "https://images.example/b.png", headers],
    ["prefetchImage", "https://images.example/a.png", 41],
    ["abortRequest", 41],
    ["queryCache", ["file:///a.png"]],
  ]);
});

test("maps the iOS tuple ABI without passing an Android request id", async () => {
  const calls = [];
  const module = {
    async getSize(uri) {
      calls.push(["getSize", uri]);
      return [75, 25];
    },
    async getSizeWithHeaders(uri, headers) {
      calls.push(["getSizeWithHeaders", uri, headers]);
      return { width: 150, height: 50 };
    },
    async prefetchImage(...args) {
      calls.push(["prefetchImage", ...args]);
      return true;
    },
    async queryCache(uris) {
      calls.push(["queryCache", uris]);
      return { "file:///a.png": "disk" };
    },
  };
  const adapter = createIOSImageAdapter(module);
  assert.deepEqual(
    await adapter.getDimensions({ uri: "file:///bundle/a.png" }),
    { width: 75, height: 25 },
  );
  const headers = Object.freeze({ Cookie: "private" });
  assert.deepEqual(
    await adapter.getDimensions({
      uri: "https://images.example/b.png",
      headers,
    }),
    { width: 150, height: 50 },
  );
  assert.equal(await adapter.prefetchImage("file:///bundle/a.png", 99), true);
  adapter.cancelPrefetch(99);
  assert.deepEqual(await adapter.queryCache(["file:///a.png"]), {
    "file:///a.png": "disk",
  });
  assert.deepEqual(calls, [
    ["getSize", "file:///bundle/a.png"],
    ["getSizeWithHeaders", "https://images.example/b.png", headers],
    ["prefetchImage", "file:///bundle/a.png"],
    ["queryCache", ["file:///a.png"]],
  ]);
});

test("rejects malformed iOS tuples and incomplete native modules", async () => {
  const module = androidModule();
  const ios = createIOSImageAdapter({
    ...module,
    async getSize() {
      return [1];
    },
  });
  await assert.rejects(
    ios.getDimensions({ uri: "file:///invalid.png" }),
    /must contain width and height/u,
  );
  assert.throws(
    () => createAndroidImageAdapter({ ...module, abortRequest: true }),
    /must provide abortRequest/u,
  );
  assert.throws(
    () => createIOSImageAdapter({ ...module, queryCache: undefined }),
    /must provide queryCache/u,
  );
});
