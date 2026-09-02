import assert from "node:assert/strict";
import test from "node:test";

import {
  createAndroidNetworkingAdapter,
  createIOSNetworkingAdapter,
} from "../dist/react-native-adapter.js";

function nativeRequest(overrides = {}) {
  return Object.freeze({
    url: "https://api.example.test/stream",
    method: "POST",
    headers: Object.freeze({ "Content-Type": "application/json" }),
    body: '{"prompt":"hello"}',
    withCredentials: false,
    timeoutMilliseconds: 5_000,
    maxResponseCharacters: 1_000,
    ...overrides,
  });
}

function eventEmitter() {
  const listeners = new Map();
  const removals = [];
  return {
    removals,
    addListener(name, listener) {
      const entries = listeners.get(name) ?? new Set();
      entries.add(listener);
      listeners.set(name, entries);
      let active = true;
      return {
        remove() {
          if (!active) return;
          active = false;
          entries.delete(listener);
          removals.push(name);
        },
      };
    },
    emit(name, payload) {
      for (const listener of [...(listeners.get(name) ?? [])])
        listener(payload);
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    },
  };
}

test("maps Android's caller-owned request ID and tuple headers exactly", () => {
  const calls = [];
  const module = {
    sendRequest(...args) {
      calls.push(["sendRequest", ...args]);
    },
    abortRequest(id) {
      calls.push(["abortRequest", id]);
    },
  };
  const emitter = eventEmitter();
  const adapter = createAndroidNetworkingAdapter(module, emitter);
  const events = [];
  const handle = adapter.startTextRequest(nativeRequest(), (event) =>
    events.push(event),
  );
  assert.deepEqual(calls, [
    [
      "sendRequest",
      "POST",
      "https://api.example.test/stream",
      1,
      [["Content-Type", "application/json"]],
      { string: '{"prompt":"hello"}' },
      "text",
      true,
      5_000,
      false,
    ],
  ]);
  emitter.emit("didReceiveNetworkResponse", [
    1,
    200,
    { "Content-Type": "text/plain" },
    "https://api.example.test/stream",
  ]);
  emitter.emit("didReceiveNetworkIncrementalData", [1, "hello", 5, -1]);
  // RN 0.87 Android emits only [requestId, error] for success and for
  // non-timeout failures. The third element is present only for a timeout.
  emitter.emit("didCompleteNetworkResponse", [1, null]);
  assert.deepEqual(events, [
    {
      kind: "response",
      status: 200,
      headers: { "Content-Type": "text/plain" },
      url: "https://api.example.test/stream",
    },
    { kind: "chunk", text: "hello", loaded: 5, total: -1 },
    { kind: "complete", error: null, timedOut: false },
  ]);
  assert.equal(emitter.listenerCount("didReceiveNetworkResponse"), 0);
  assert.equal(emitter.removals.length, 3);
  handle.cancel();
  assert.equal(calls.length, 1);
});

test("preserves Android's explicit timeout completion flag", () => {
  const module = {
    sendRequest() {},
    abortRequest() {},
  };
  const emitter = eventEmitter();
  const adapter = createAndroidNetworkingAdapter(module, emitter);
  const events = [];
  adapter.startTextRequest(nativeRequest(), (event) => events.push(event));
  emitter.emit("didCompleteNetworkResponse", [1, "request timed out", true]);
  assert.deepEqual(events, [
    { kind: "complete", error: "request timed out", timedOut: true },
  ]);
});

test("isolates concurrent Android requests and aborts one exactly once", () => {
  const calls = [];
  const module = {
    sendRequest(_method, _url, id) {
      calls.push(["send", id]);
    },
    abortRequest(id) {
      calls.push(["abort", id]);
    },
  };
  const emitter = eventEmitter();
  const adapter = createAndroidNetworkingAdapter(module, emitter);
  const firstEvents = [];
  const secondEvents = [];
  const first = adapter.startTextRequest(nativeRequest(), (event) =>
    firstEvents.push(event),
  );
  adapter.startTextRequest(nativeRequest(), (event) =>
    secondEvents.push(event),
  );
  emitter.emit("didReceiveNetworkResponse", [2, 201, {}, null]);
  first.cancel();
  first.cancel();
  emitter.emit("didReceiveNetworkIncrementalData", [1, "ignored", 7, -1]);
  emitter.emit("didReceiveNetworkIncrementalData", [2, "kept", 4, -1]);
  assert.deepEqual(firstEvents, []);
  assert.deepEqual(secondEvents, [
    { kind: "response", status: 201, headers: {}, url: null },
    { kind: "chunk", text: "kept", loaded: 4, total: -1 },
  ]);
  assert.deepEqual(calls, [
    ["send", 1],
    ["send", 2],
    ["abort", 1],
  ]);
});

test("maps iOS's object request and callback-owned request ID", () => {
  const calls = [];
  const module = {
    sendRequest(query, callback) {
      calls.push(["sendRequest", query]);
      callback(41);
    },
    abortRequest(id) {
      calls.push(["abortRequest", id]);
    },
  };
  const emitter = eventEmitter();
  const adapter = createIOSNetworkingAdapter(module, emitter);
  const events = [];
  const handle = adapter.startTextRequest(nativeRequest(), (event) =>
    events.push(event),
  );
  assert.deepEqual(calls, [
    [
      "sendRequest",
      {
        method: "POST",
        url: "https://api.example.test/stream",
        data: { string: '{"prompt":"hello"}' },
        headers: { "Content-Type": "application/json" },
        responseType: "text",
        incrementalUpdates: true,
        timeout: 5_000,
        withCredentials: false,
      },
    ],
  ]);
  emitter.emit("didReceiveNetworkResponse", [41, 200, {}, null]);
  emitter.emit("didReceiveNetworkIncrementalData", [41, "chunk", 5, 10]);
  // The RN 0.87 physical iOS event path can omit the false timeout slot.
  emitter.emit("didCompleteNetworkResponse", [41, null]);
  assert.deepEqual(events, [
    { kind: "response", status: 200, headers: {}, url: null },
    { kind: "chunk", text: "chunk", loaded: 5, total: 10 },
    { kind: "complete", error: null, timedOut: false },
  ]);
  handle.cancel();
  assert.equal(calls.length, 1);
  assert.equal(emitter.removals.length, 3);
});

test("accepts iOS's initial zero request identifier", () => {
  const module = {
    sendRequest(_query, callback) {
      callback(0);
    },
    abortRequest() {},
  };
  const emitter = eventEmitter();
  const adapter = createIOSNetworkingAdapter(module, emitter);
  const events = [];
  adapter.startTextRequest(nativeRequest(), (event) => events.push(event));
  emitter.emit("didCompleteNetworkResponse", [0, null, false]);
  assert.deepEqual(events, [
    { kind: "complete", error: null, timedOut: false },
  ]);
});

test("canonically settles invalid iOS callback request identifiers", () => {
  const module = {
    sendRequest(_query, callback) {
      callback(-1);
    },
    abortRequest() {},
  };
  const emitter = eventEmitter();
  const adapter = createIOSNetworkingAdapter(module, emitter);
  const events = [];
  adapter.startTextRequest(nativeRequest(), (event) => events.push(event));
  assert.deepEqual(events, [
    {
      kind: "complete",
      error:
        "The iOS Networking module returned an invalid request identifier.",
      timedOut: false,
    },
  ]);
  assert.equal(emitter.removals.length, 3);
});

test("normalizes React Native bridgeless timeout flags at the adapter boundary", () => {
  for (const [nativeFlag, expected] of [
    [null, false],
    [undefined, false],
    [0, false],
    [1, true],
  ]) {
    const module = {
      sendRequest(_query, callback) {
        callback(41);
      },
      abortRequest() {},
    };
    const emitter = eventEmitter();
    const adapter = createIOSNetworkingAdapter(module, emitter);
    const events = [];
    adapter.startTextRequest(nativeRequest(), (event) => events.push(event));
    emitter.emit("didCompleteNetworkResponse", [
      41,
      expected ? "request timed out" : null,
      nativeFlag,
    ]);
    assert.deepEqual(events, [
      {
        kind: "complete",
        error: expected ? "request timed out" : null,
        timedOut: expected,
      },
    ]);
  }
});

test("does not normalize malformed completion tuple lengths", () => {
  const module = {
    sendRequest(_query, callback) {
      callback(41);
    },
    abortRequest() {},
  };
  const emitter = eventEmitter();
  const adapter = createIOSNetworkingAdapter(module, emitter);
  const events = [];
  adapter.startTextRequest(nativeRequest(), (event) => events.push(event));
  assert.throws(
    () =>
      emitter.emit("didCompleteNetworkResponse", [
        41,
        null,
        false,
        "unexpected",
      ]),
    /received 4/u,
  );
  assert.deepEqual(events, []);
  assert.equal(emitter.removals.length, 3);
});

test("reports unsupported native completion flag kinds without values", () => {
  const module = {
    sendRequest(_query, callback) {
      callback(41);
    },
    abortRequest() {},
  };
  const emitter = eventEmitter();
  const adapter = createIOSNetworkingAdapter(module, emitter);
  adapter.startTextRequest(nativeRequest(), () => {});
  assert.throws(
    () => emitter.emit("didCompleteNetworkResponse", [41, null, "false"]),
    /unsupported kind string/u,
  );
  assert.equal(emitter.removals.length, 3);
});

test("remembers iOS cancellation until the native callback assigns an ID", () => {
  const calls = [];
  let assignRequestId;
  const module = {
    sendRequest(_query, callback) {
      assignRequestId = callback;
    },
    abortRequest(id) {
      calls.push(["abortRequest", id]);
    },
  };
  const emitter = eventEmitter();
  const adapter = createIOSNetworkingAdapter(module, emitter);
  const handle = adapter.startTextRequest(nativeRequest(), () => {
    throw new Error("cancelled requests cannot deliver events");
  });
  handle.cancel();
  assert.deepEqual(calls, []);
  assignRequestId(73);
  assert.deepEqual(calls, [["abortRequest", 73]]);
  assert.equal(emitter.removals.length, 3);
});

test("surfaces malformed native tuples to the validating service", () => {
  const module = {
    sendRequest(_method, _url, _id) {},
    abortRequest() {},
  };
  const emitter = eventEmitter();
  const adapter = createAndroidNetworkingAdapter(module, emitter);
  const events = [];
  adapter.startTextRequest(nativeRequest(), (event) => events.push(event));
  emitter.emit("didReceiveNetworkResponse", [1, 200]);
  assert.deepEqual(events, [
    { kind: "response", status: undefined, headers: undefined, url: undefined },
  ]);
});

test("validates native module and emitter contracts", () => {
  const emitter = eventEmitter();
  assert.throws(
    () => createAndroidNetworkingAdapter({ sendRequest() {} }, emitter),
    /abortRequest/u,
  );
  assert.throws(
    () => createIOSNetworkingAdapter({ abortRequest() {} }, emitter),
    /sendRequest/u,
  );
  assert.throws(
    () =>
      createAndroidNetworkingAdapter(
        { sendRequest() {}, abortRequest() {} },
        { addListener: true },
      ),
    /addListener/u,
  );
});
