import assert from "node:assert/strict";
import test from "node:test";

import { createDevelopmentNetworkInspector } from "../dist/network.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function memoryNetwork(platform = "android") {
  return {
    platform,
    requests: [],
    observers: [],
    settlements: [],
    cancellations: [],
    requestText(request, observer = {}) {
      const index = this.requests.length;
      const settlement = deferred();
      this.requests.push(request);
      this.observers.push(observer);
      this.settlements.push(settlement);
      return Object.freeze({
        result: settlement.promise,
        cancel: () => this.cancellations.push(index),
      });
    },
  };
}

test("records bounded request lifecycle metadata without payload data", async () => {
  let now = 10;
  const inspector = createDevelopmentNetworkInspector({
    captureRequestTargets: true,
    clock: () => now++,
  });
  const native = memoryNetwork();
  const network = inspector.instrument(native);
  const delivered = [];
  const updates = [];
  inspector.subscribe((snapshot) => updates.push(snapshot));

  const handle = network.requestText(
    {
      url: "https://api.example.test/v1/account?token=private#secret",
      method: "post",
      headers: { Authorization: "Bearer private" },
      body: '{"password":"private"}',
    },
    {
      onResponse: (response) => delivered.push(["response", response.status]),
      onChunk: (chunk) => delivered.push(["chunk", chunk.text]),
    },
  );

  assert.deepEqual(inspector.history(), [
    {
      protocolVersion: 0,
      id: 1,
      platform: "android",
      method: "POST",
      requestTarget: "https://api.example.test/v1/account",
      state: "pending",
      startedAt: 10,
      updatedAt: 10,
      chunkCount: 0,
      receivedCharacters: 0,
      loadedBytes: 0,
    },
  ]);
  assert.equal(inspector.activeCount(), 1);
  assert.ok(Object.isFrozen(inspector.history()));
  assert.ok(Object.isFrozen(inspector.history()[0]));

  native.observers[0].onResponse({
    status: 200,
    url: "https://edge.example.test/v1/account?session=private",
    headers: { "Set-Cookie": "private" },
  });
  native.observers[0].onChunk({
    sequence: 1,
    text: "private response text",
    loaded: 21,
    total: 42,
  });
  native.settlements[0].resolve({
    response: {
      status: 200,
      url: "https://edge.example.test/v1/account?session=private",
      headers: { "Set-Cookie": "private" },
    },
    chunkCount: 1,
    receivedCharacters: 21,
  });
  assert.deepEqual(await handle.result, {
    response: {
      status: 200,
      url: "https://edge.example.test/v1/account?session=private",
      headers: { "Set-Cookie": "private" },
    },
    chunkCount: 1,
    receivedCharacters: 21,
  });
  await Promise.resolve();

  const [snapshot] = inspector.history();
  assert.equal(snapshot.state, "completed");
  assert.equal(snapshot.responseStatus, 200);
  assert.equal(snapshot.responseTarget, "https://edge.example.test/v1/account");
  assert.equal(snapshot.chunkCount, 1);
  assert.equal(snapshot.receivedCharacters, 21);
  assert.equal(snapshot.loadedBytes, 21);
  assert.equal(snapshot.totalBytes, 42);
  assert.equal(snapshot.startedAt, 10);
  assert.equal(snapshot.finishedAt, 13);
  assert.equal(snapshot.durationMilliseconds, 3);
  assert.equal(inspector.activeCount(), 0);
  assert.deepEqual(delivered, [
    ["response", 200],
    ["chunk", "private response text"],
  ]);
  const serialized = JSON.stringify(snapshot);
  for (const privateValue of [
    "token",
    "secret",
    "Authorization",
    "Bearer",
    "password",
    "private response",
    "Set-Cookie",
    "session",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue, "u"));
  }
  assert.equal(updates.length, 4);
});

test("redacts targets and error details by default", async () => {
  const inspector = createDevelopmentNetworkInspector({ clock: () => 1 });
  const native = memoryNetwork("ios");
  const network = inspector.instrument(native);
  const handle = network.requestText({
    url: "https://private.example.test/customers/42?key=secret",
  });
  const failure = Object.assign(new Error("token abc was rejected"), {
    name: "NetworkTransportError",
  });
  native.settlements[0].reject(failure);
  await assert.rejects(handle.result, (error) => error === failure);
  await Promise.resolve();

  assert.deepEqual(inspector.history(), [
    {
      protocolVersion: 0,
      id: 1,
      platform: "ios",
      method: "GET",
      state: "failed",
      startedAt: 1,
      updatedAt: 1,
      finishedAt: 1,
      durationMilliseconds: 0,
      chunkCount: 0,
      receivedCharacters: 0,
      loadedBytes: 0,
      errorName: "NetworkTransportError",
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(inspector.history()),
    /token|secret|private/u,
  );
});

test("records explicit cancellation once and preserves the native handle", async () => {
  const inspector = createDevelopmentNetworkInspector({ clock: () => 2 });
  const native = memoryNetwork();
  const network = inspector.instrument(native);
  const handle = network.requestText({ url: "https://api.example.test/slow" });

  handle.cancel();
  handle.cancel();
  assert.deepEqual(native.cancellations, [0, 0]);
  assert.equal(inspector.history()[0].state, "cancelled");
  assert.equal(inspector.activeCount(), 0);

  const failure = new Error("native cancellation settlement");
  native.settlements[0].reject(failure);
  await assert.rejects(handle.result, (error) => error === failure);
  await Promise.resolve();
  assert.equal(inspector.history()[0].state, "cancelled");
});

test("bounds memory without blocking requests when every slot is active", async () => {
  const inspector = createDevelopmentNetworkInspector({
    maxHistory: 2,
    clock: () => 3,
  });
  const native = memoryNetwork();
  const network = inspector.instrument(native);
  const first = network.requestText({ url: "https://api.example.test/one" });
  const second = network.requestText({ url: "https://api.example.test/two" });
  const third = network.requestText({ url: "https://api.example.test/three" });

  assert.equal(native.requests.length, 3);
  assert.equal(inspector.history().length, 2);
  assert.equal(inspector.activeCount(), 2);
  assert.equal(inspector.droppedCount(), 1);

  native.settlements[0].resolve({
    response: { status: 204, url: native.requests[0].url, headers: {} },
    chunkCount: 0,
    receivedCharacters: 0,
  });
  native.settlements[1].resolve({
    response: { status: 204, url: native.requests[1].url, headers: {} },
    chunkCount: 0,
    receivedCharacters: 0,
  });
  native.settlements[2].resolve({
    response: { status: 204, url: native.requests[2].url, headers: {} },
    chunkCount: 0,
    receivedCharacters: 0,
  });
  await Promise.all([first.result, second.result, third.result]);
  await Promise.resolve();

  const fourth = network.requestText({ url: "https://api.example.test/four" });
  assert.deepEqual(
    inspector.history().map((snapshot) => [snapshot.id, snapshot.state]),
    [
      [2, "completed"],
      [3, "pending"],
    ],
  );
  native.settlements[3].resolve({
    response: { status: 204, url: native.requests[3].url, headers: {} },
    chunkCount: 0,
    receivedCharacters: 0,
  });
  await fourth.result;
});

test("clears active tracking and isolates subscribers from request behavior", async () => {
  const inspector = createDevelopmentNetworkInspector({ clock: () => 4 });
  const native = memoryNetwork();
  const network = inspector.instrument(native);
  const observed = [];
  const subscription = inspector.subscribe((snapshot) => {
    observed.push(snapshot?.state ?? "cleared");
    throw new Error("inspector UI failed");
  });
  const request = network.requestText({ url: "https://api.example.test/one" });
  assert.deepEqual(observed, ["pending"]);
  inspector.clear();
  assert.deepEqual(inspector.history(), []);
  assert.equal(inspector.activeCount(), 0);
  assert.equal(inspector.droppedCount(), 0);

  native.settlements[0].resolve({
    response: { status: 204, url: native.requests[0].url, headers: {} },
    chunkCount: 0,
    receivedCharacters: 0,
  });
  await request.result;
  await Promise.resolve();
  assert.deepEqual(observed, ["pending", "cleared"]);
  subscription.remove();
  subscription.remove();
});

test("validates inspector configuration and wrapped service contracts", () => {
  assert.throws(
    () => createDevelopmentNetworkInspector({ maxHistory: 0 }),
    /maxHistory/u,
  );
  assert.throws(
    () => createDevelopmentNetworkInspector({ captureRequestTargets: "yes" }),
    /captureRequestTargets/u,
  );
  const inspector = createDevelopmentNetworkInspector();
  assert.throws(() => inspector.instrument({}), /platform/u);
  const network = inspector.instrument(memoryNetwork());
  assert.throws(
    () =>
      network.requestText(
        { url: "https://api.example.test/" },
        { onChunk: true },
      ),
    /onChunk/u,
  );
  assert.deepEqual(inspector.history(), []);

  let cancelled = 0;
  const invalid = inspector.instrument({
    platform: "android",
    requestText() {
      return {
        result: undefined,
        cancel() {
          cancelled++;
        },
      };
    },
  });
  assert.throws(
    () => invalid.requestText({ url: "https://api.example.test/" }),
    /invalid request handle/u,
  );
  assert.equal(cancelled, 1);
  assert.equal(inspector.history()[0].state, "failed");
});
