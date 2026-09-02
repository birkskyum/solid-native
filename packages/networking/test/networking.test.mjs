import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_MAX_CHUNK_CHARACTERS,
  NETWORK_MAX_HEADER_COUNT,
  NETWORK_MAX_REQUEST_BODY_CHARACTERS,
  NETWORK_MAX_RESPONSE_CHARACTERS,
  NetworkRequestCancelledError,
  NetworkRequestTimedOutError,
  NetworkTransportError,
  createNetworkService,
} from "../dist/index.js";

function memoryAdapter(platform = "android") {
  return {
    platform,
    requests: [],
    listeners: [],
    cancellations: [],
    startTextRequest(request, listener) {
      const index = this.requests.length;
      this.requests.push(request);
      this.listeners.push(listener);
      return Object.freeze({
        cancel: () => this.cancellations.push(index),
      });
    },
    emit(index, event) {
      this.listeners[index](event);
    },
  };
}

test("normalizes bounded requests and streams validated native text", async () => {
  const adapter = memoryAdapter();
  const network = createNetworkService(adapter);
  const responses = [];
  const chunks = [];
  const handle = network.requestText(
    {
      url: "https://api.example.test/v1/stream?customer=42",
      method: "post",
      headers: {
        Authorization: "Bearer private",
        "Content-Type": "application/json",
      },
      body: '{"prompt":"hello"}',
      credentials: "omit",
      timeoutMilliseconds: 4_000,
      maxResponseCharacters: 100,
    },
    {
      onResponse: (response) => responses.push(response),
      onChunk: (chunk) => chunks.push(chunk),
    },
  );
  assert.equal(network.platform, "android");
  assert.ok(Object.isFrozen(network));
  assert.ok(Object.isFrozen(handle));
  await Promise.resolve();
  assert.deepEqual(adapter.requests, [
    {
      url: "https://api.example.test/v1/stream?customer=42",
      method: "POST",
      headers: {
        Authorization: "Bearer private",
        "Content-Type": "application/json",
      },
      body: '{"prompt":"hello"}',
      withCredentials: false,
      timeoutMilliseconds: 4_000,
      maxResponseCharacters: 100,
    },
  ]);
  assert.ok(Object.isFrozen(adapter.requests[0]));
  assert.ok(Object.isFrozen(adapter.requests[0].headers));

  adapter.emit(0, {
    kind: "response",
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    url: "https://edge.example.test/v1/stream",
  });
  adapter.emit(0, {
    kind: "chunk",
    text: "first",
    loaded: 5,
    total: -1,
  });
  adapter.emit(0, {
    kind: "chunk",
    text: "-second",
    loaded: 12,
    total: null,
  });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });
  const result = await handle.result;

  assert.deepEqual(responses, [
    {
      status: 200,
      url: "https://edge.example.test/v1/stream",
      headers: { "Content-Type": "text/event-stream" },
    },
  ]);
  assert.deepEqual(chunks, [
    { sequence: 1, text: "first", loaded: 5 },
    { sequence: 2, text: "-second", loaded: 12 },
  ]);
  assert.deepEqual(result, {
    response: responses[0],
    chunkCount: 2,
    receivedCharacters: 12,
  });
  assert.ok(Object.isFrozen(responses[0]));
  assert.ok(Object.isFrozen(responses[0].headers));
  assert.ok(chunks.every(Object.isFrozen));
  assert.ok(Object.isFrozen(result));
  handle.cancel();
  assert.deepEqual(adapter.cancellations, []);
});

test("uses safe defaults and falls back to the requested response URL", async () => {
  const adapter = memoryAdapter("ios");
  const network = createNetworkService(adapter);
  const handle = network.requestText({ url: "https://api.example.test/empty" });
  await Promise.resolve();
  assert.deepEqual(adapter.requests[0], {
    url: "https://api.example.test/empty",
    method: "GET",
    headers: {},
    withCredentials: true,
    timeoutMilliseconds: 30_000,
    maxResponseCharacters: 8_388_608,
  });
  adapter.emit(0, {
    kind: "response",
    status: 204,
    headers: null,
    url: null,
  });
  adapter.emit(0, { kind: "complete", error: "", timedOut: false });
  assert.deepEqual(await handle.result, {
    response: {
      status: 204,
      url: "https://api.example.test/empty",
      headers: {},
    },
    chunkCount: 0,
    receivedCharacters: 0,
  });
});

test("cancels before native start without crossing the adapter", async () => {
  const adapter = memoryAdapter();
  const network = createNetworkService(adapter);
  const handle = network.requestText({ url: "https://api.example.test/later" });
  handle.cancel();
  handle.cancel();
  await assert.rejects(handle.result, NetworkRequestCancelledError);
  await Promise.resolve();
  assert.deepEqual(adapter.requests, []);
  assert.deepEqual(adapter.cancellations, []);
});

test("cancels active native work exactly once", async () => {
  const adapter = memoryAdapter();
  const network = createNetworkService(adapter);
  const handle = network.requestText({ url: "https://api.example.test/slow" });
  await Promise.resolve();
  handle.cancel();
  handle.cancel();
  await assert.rejects(handle.result, NetworkRequestCancelledError);
  assert.deepEqual(adapter.cancellations, [0]);
  adapter.emit(0, {
    kind: "response",
    status: 200,
    headers: {},
    url: null,
  });
});

test("maps native timeout and transport completion errors", async () => {
  const adapter = memoryAdapter();
  const network = createNetworkService(adapter);
  const timeout = network.requestText({
    url: "https://api.example.test/timeout",
  });
  const failed = network.requestText({
    url: "https://api.example.test/failure",
  });
  await Promise.resolve();
  adapter.emit(0, {
    kind: "complete",
    error: "request timed out",
    timedOut: true,
  });
  adapter.emit(1, {
    kind: "complete",
    error: "connection reset",
    timedOut: false,
  });
  await assert.rejects(timeout.result, NetworkRequestTimedOutError);
  await assert.rejects(failed.result, NetworkTransportError);
  assert.deepEqual(adapter.cancellations, []);
});

test("rejects invalid requests before native work", async () => {
  const adapter = memoryAdapter();
  const network = createNetworkService(adapter);
  for (const request of [
    null,
    { url: "relative/path" },
    { url: "file:///private/data" },
    { url: "https://user:secret@api.example.test/" },
    { url: "https://api.example.test/line\nbreak" },
    { url: "https://api.example.test/", method: "bad method" },
    { url: "https://api.example.test/", method: "GET", body: "no" },
    { url: "https://api.example.test/", credentials: "same-origin" },
    { url: "https://api.example.test/", timeoutMilliseconds: 0 },
    { url: "https://api.example.test:0/" },
    { url: "https://api.example.test:65536/" },
    { url: "https://-api.example.test/" },
    { url: "https://api.example.test\\redirect" },
    {
      url: "https://api.example.test/",
      maxResponseCharacters: NETWORK_MAX_RESPONSE_CHARACTERS + 1,
    },
    {
      url: "https://api.example.test/",
      body: "x".repeat(NETWORK_MAX_REQUEST_BODY_CHARACTERS + 1),
    },
    {
      url: "https://api.example.test/",
      headers: { Authorization: "one\r\nInjected: true" },
    },
    {
      url: "https://api.example.test/",
      headers: Object.fromEntries(
        Array.from({ length: NETWORK_MAX_HEADER_COUNT + 1 }, (_, index) => [
          `X-${index}`,
          "x",
        ]),
      ),
    },
  ]) {
    assert.throws(() => network.requestText(request));
  }
  assert.throws(
    () =>
      network.requestText(
        { url: "https://api.example.test/" },
        { onChunk: true },
      ),
    /onChunk/u,
  );
  await Promise.resolve();
  assert.deepEqual(adapter.requests, []);
});

test("aborts malformed or out-of-order native streams", async () => {
  const cases = [
    { kind: "chunk", text: "early", loaded: 5, total: -1 },
    { kind: "response", status: 99, headers: {}, url: null },
    {
      kind: "response",
      status: 200,
      headers: { "Bad Header": "x" },
      url: null,
    },
    { kind: "complete", error: null, timedOut: false },
    { kind: "complete", error: null, timedOut: "no" },
    { kind: "future" },
  ];
  for (const event of cases) {
    const adapter = memoryAdapter();
    const network = createNetworkService(adapter);
    const handle = network.requestText({
      url: "https://api.example.test/stream",
    });
    await Promise.resolve();
    adapter.emit(0, event);
    await assert.rejects(handle.result);
    assert.deepEqual(adapter.cancellations, [0]);
  }
});

test("bounds chunks, aggregate response size, and progress", async () => {
  for (const events of [
    [
      {
        kind: "chunk",
        text: "x".repeat(NETWORK_MAX_CHUNK_CHARACTERS + 1),
        loaded: 1,
        total: -1,
      },
    ],
    [
      { kind: "chunk", text: "123456", loaded: 6, total: -1 },
      { kind: "chunk", text: "78901", loaded: 11, total: -1 },
    ],
    [
      { kind: "chunk", text: "first", loaded: 5, total: -1 },
      { kind: "chunk", text: "back", loaded: 4, total: -1 },
    ],
    [{ kind: "chunk", text: "too far", loaded: 8, total: 7 }],
  ]) {
    const adapter = memoryAdapter();
    const network = createNetworkService(adapter);
    const handle = network.requestText({
      url: "https://api.example.test/bounded",
      maxResponseCharacters: 10,
    });
    await Promise.resolve();
    adapter.emit(0, {
      kind: "response",
      status: 200,
      headers: {},
      url: null,
    });
    for (const event of events) adapter.emit(0, event);
    await assert.rejects(handle.result);
    assert.deepEqual(adapter.cancellations, [0]);
  }
});

test("turns observer failures into owned request failures", async () => {
  const adapter = memoryAdapter();
  const network = createNetworkService(adapter);
  const expected = new Error("consumer failed");
  const handle = network.requestText(
    { url: "https://api.example.test/observer" },
    {
      onChunk() {
        throw expected;
      },
    },
  );
  await Promise.resolve();
  adapter.emit(0, {
    kind: "response",
    status: 200,
    headers: {},
    url: null,
  });
  adapter.emit(0, { kind: "chunk", text: "x", loaded: 1, total: -1 });
  await assert.rejects(handle.result, (error) => error === expected);
  assert.deepEqual(adapter.cancellations, [0]);
});

test("snapshots observers and rejects asynchronous chunk callbacks", async () => {
  const adapter = memoryAdapter();
  const network = createNetworkService(adapter);
  const calls = [];
  const observer = {
    onChunk(chunk) {
      calls.push(["original", chunk.text]);
    },
  };
  const snapshot = network.requestText(
    { url: "https://[::1]:8443/stream" },
    observer,
  );
  observer.onChunk = () => calls.push(["mutated"]);
  await Promise.resolve();
  adapter.emit(0, {
    kind: "response",
    status: 200,
    headers: {},
    url: null,
  });
  adapter.emit(0, { kind: "chunk", text: "kept", loaded: 4, total: -1 });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });
  await snapshot.result;
  assert.deepEqual(calls, [["original", "kept"]]);

  const asynchronous = network.requestText(
    { url: "http://localhost:8080/stream" },
    {
      async onChunk() {},
    },
  );
  await Promise.resolve();
  adapter.emit(1, {
    kind: "response",
    status: 200,
    headers: {},
    url: null,
  });
  adapter.emit(1, { kind: "chunk", text: "x", loaded: 1, total: -1 });
  await assert.rejects(asynchronous.result, /must complete synchronously/u);
  assert.deepEqual(adapter.cancellations, [1]);
});

test("validates the platform adapter contract", () => {
  assert.throws(() => createNetworkService(null), /plain object/u);
  assert.throws(
    () => createNetworkService({ platform: "web", startTextRequest() {} }),
    /android or ios/u,
  );
  assert.throws(
    () => createNetworkService({ platform: "ios", startTextRequest: true }),
    /startTextRequest/u,
  );
});
