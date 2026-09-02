import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_JSON_MAX_DEPTH,
  NETWORK_JSON_MAX_DOCUMENT_CHARACTERS,
  NETWORK_JSON_MAX_CHUNKS,
  NETWORK_JSON_MAX_NODES,
  NetworkJSONProtocolError,
  requestJSON,
} from "../dist/json.js";
import {
  NetworkRequestCancelledError,
  createNetworkService,
} from "../dist/index.js";

function memoryAdapter() {
  return {
    platform: "android",
    requests: [],
    listeners: [],
    cancellations: [],
    startTextRequest(request, listener) {
      const index = this.requests.length;
      this.requests.push(request);
      this.listeners.push(listener);
      return {
        cancel: () => this.cancellations.push(index),
      };
    },
    emit(index, event) {
      this.listeners[index](event);
    },
  };
}

function emitResponse(adapter, contentType = "application/json") {
  adapter.emit(0, {
    kind: "response",
    status: 200,
    headers: { "Content-Type": contentType },
    url: null,
  });
}

test("assembles and deeply freezes one bounded JSON document", async () => {
  const adapter = memoryAdapter();
  const service = createNetworkService(adapter);
  const observed = [];
  const handle = requestJSON(
    service,
    { url: "https://api.example.test/profile" },
    { onResult: (result) => observed.push(result) },
  );
  await Promise.resolve();
  emitResponse(adapter, "application/problem+json; charset=utf-8");
  const firstChunk = '{"ok":true,"items":[1,';
  const secondChunk = '2],"nested":{"name":"Solid"}}';
  adapter.emit(0, {
    kind: "chunk",
    text: firstChunk,
    loaded: firstChunk.length,
    total: -1,
  });
  adapter.emit(0, {
    kind: "chunk",
    text: secondChunk,
    loaded: firstChunk.length + secondChunk.length,
    total: -1,
  });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });

  const result = await handle.result;
  assert.deepEqual(result, {
    response: {
      status: 200,
      url: "https://api.example.test/profile",
      headers: { "Content-Type": "application/problem+json; charset=utf-8" },
    },
    chunkCount: 2,
    receivedCharacters: firstChunk.length + secondChunk.length,
    value: {
      ok: true,
      items: [1, 2],
      nested: { name: "Solid" },
    },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.items), true);
  assert.equal(Object.isFrozen(result.value.nested), true);
  assert.deepEqual(observed, [result]);
  handle.cancel();
  assert.deepEqual(adapter.cancellations, []);
});

test("preserves special JSON keys as inert frozen data", async () => {
  const adapter = memoryAdapter();
  const handle = requestJSON(createNetworkService(adapter), {
    url: "https://api.example.test/special-keys",
  });
  await Promise.resolve();
  emitResponse(adapter);
  const source = '{"__proto__":{"safe":true},"constructor":"data"}';
  adapter.emit(0, {
    kind: "chunk",
    text: source,
    loaded: source.length,
    total: source.length,
  });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });

  const { value } = await handle.result;
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal(value.__proto__.safe, true);
  assert.equal(value.constructor, "data");
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.isFrozen(value.__proto__), true);
});

test("enforces JSON media types unless explicitly disabled", async () => {
  for (const contentType of [
    undefined,
    "text/json",
    "text/plain",
    "application/not json+json",
  ]) {
    const adapter = memoryAdapter();
    const handle = requestJSON(createNetworkService(adapter), {
      url: "https://api.example.test/wrong-media-type",
    });
    await Promise.resolve();
    adapter.emit(0, {
      kind: "response",
      status: 200,
      headers: contentType === undefined ? {} : { "Content-Type": contentType },
      url: null,
    });
    await assert.rejects(handle.result, NetworkJSONProtocolError);
    assert.deepEqual(adapter.cancellations, [0]);
  }

  const adapter = memoryAdapter();
  const handle = requestJSON(
    createNetworkService(adapter),
    { url: "https://api.example.test/nonstandard" },
    {},
    { requireJSONContentType: false },
  );
  await Promise.resolve();
  emitResponse(adapter, "text/plain");
  adapter.emit(0, { kind: "chunk", text: "null", loaded: 4, total: 4 });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });
  assert.equal((await handle.result).value, null);
});

test("rejects malformed, oversized, deep, and overly broad documents", async () => {
  const cases = [
    {
      source: "{",
      options: {},
      error: NetworkJSONProtocolError,
    },
    {
      source: "1234",
      options: { maxDocumentCharacters: 3 },
      error: /exceeded 3 characters/u,
      cancelled: true,
    },
    {
      source: '{"nested":{"too":"deep"}}',
      options: { maxDepth: 1 },
      error: /exceeded depth 1/u,
    },
    {
      source: "[1,2,3]",
      options: { maxNodes: 3 },
      error: /exceeded 3 values/u,
    },
  ];
  for (const item of cases) {
    const adapter = memoryAdapter();
    const handle = requestJSON(
      createNetworkService(adapter),
      { url: "https://api.example.test/invalid" },
      {},
      item.options,
    );
    await Promise.resolve();
    emitResponse(adapter);
    adapter.emit(0, {
      kind: "chunk",
      text: item.source,
      loaded: item.source.length,
      total: item.source.length,
    });
    if (!item.cancelled) {
      adapter.emit(0, { kind: "complete", error: null, timedOut: false });
    }
    await assert.rejects(handle.result, item.error);
    assert.deepEqual(adapter.cancellations, item.cancelled ? [0] : []);
  }
});

test("validates options and requester handles before exposing them", async () => {
  let requests = 0;
  const requester = {
    requestText() {
      requests += 1;
      return { result: Promise.resolve({}), cancel() {} };
    },
  };
  for (const options of [
    null,
    { unexpected: true },
    { requireJSONContentType: "yes" },
    { maxDocumentCharacters: 0 },
    { maxDocumentCharacters: NETWORK_JSON_MAX_DOCUMENT_CHARACTERS + 1 },
    { maxDepth: NETWORK_JSON_MAX_DEPTH + 1 },
    { maxNodes: NETWORK_JSON_MAX_NODES + 1 },
    { maxChunks: NETWORK_JSON_MAX_CHUNKS + 1 },
  ]) {
    assert.throws(
      () =>
        requestJSON(
          requester,
          { url: "https://api.example.test/options" },
          {},
          options,
        ),
      /Network JSON/u,
    );
  }
  assert.equal(requests, 0);

  assert.throws(
    () => requestJSON(null, { url: "https://api.example.test/requester" }),
    /requester/u,
  );
  assert.throws(
    () =>
      requestJSON(
        { requestText: () => ({ result: Promise.resolve({}) }) },
        { url: "https://api.example.test/handle" },
      ),
    /invalid request handle/u,
  );
});

test("bounds empty native chunks independently of document size", async () => {
  const adapter = memoryAdapter();
  const handle = requestJSON(
    createNetworkService(adapter),
    { url: "https://api.example.test/too-many-chunks" },
    {},
    { maxChunks: 2 },
  );
  await Promise.resolve();
  emitResponse(adapter);
  for (let index = 0; index < 3; index += 1) {
    adapter.emit(0, {
      kind: "chunk",
      text: "",
      loaded: 0,
      total: -1,
    });
  }
  await assert.rejects(handle.result, /exceeded 2 chunks/u);
  assert.deepEqual(adapter.cancellations, [0]);
});

test("snapshots observers and rejects asynchronous delivery", async () => {
  const adapter = memoryAdapter();
  const calls = [];
  const observer = { onResult: (result) => calls.push(result.value) };
  const handle = requestJSON(
    createNetworkService(adapter),
    { url: "https://api.example.test/observer" },
    observer,
  );
  observer.onResult = () => calls.push("mutated");
  await Promise.resolve();
  emitResponse(adapter);
  adapter.emit(0, { kind: "chunk", text: "42", loaded: 2, total: 2 });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });
  assert.equal((await handle.result).value, 42);
  assert.deepEqual(calls, [42]);

  const asyncAdapter = memoryAdapter();
  const asynchronous = requestJSON(
    createNetworkService(asyncAdapter),
    { url: "https://api.example.test/async-observer" },
    { onResult: async () => undefined },
  );
  await Promise.resolve();
  emitResponse(asyncAdapter);
  asyncAdapter.emit(0, {
    kind: "chunk",
    text: "true",
    loaded: 4,
    total: 4,
  });
  asyncAdapter.emit(0, {
    kind: "complete",
    error: null,
    timedOut: false,
  });
  await assert.rejects(asynchronous.result, /must complete synchronously/u);
});

test("delegates cancellation to the owner-safe text request", async () => {
  const adapter = memoryAdapter();
  const handle = requestJSON(createNetworkService(adapter), {
    url: "https://api.example.test/cancelled",
  });
  await Promise.resolve();
  handle.cancel();
  handle.cancel();
  await assert.rejects(handle.result, NetworkRequestCancelledError);
  assert.deepEqual(adapter.cancellations, [0]);
});
