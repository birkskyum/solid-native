import assert from "node:assert/strict";
import test from "node:test";

import { createNetworkService } from "../dist/index.js";
import {
  ServerEventProtocolError,
  createServerEventDecoder,
  requestServerEvents,
} from "../dist/server-events.js";

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

test("decodes comments, fields, BOM, and every newline across chunks", () => {
  const decoder = createServerEventDecoder();
  const events = [];
  events.push(...decoder.push("\ufeff: heartbeat\r"));
  events.push(...decoder.push("\nid: customer-42\r\nevent: tool\r"));
  events.push(
    ...decoder.push("\ndata: first\r\ndata: second\r\nretry: 1500\r\n\r"),
  );
  events.push(...decoder.push("\ndata: ordinary\nignored: value\n\n"));
  events.push(...decoder.push("id: invalid\u0000id\ndata: retained-id\r\r"));
  events.push(...decoder.push("event\ndata: final"));
  events.push(...decoder.finish());

  assert.deepEqual(events, [
    {
      sequence: 1,
      type: "tool",
      data: "first\nsecond",
      lastEventId: "customer-42",
      retryMilliseconds: 1_500,
    },
    {
      sequence: 2,
      type: "message",
      data: "ordinary",
      lastEventId: "customer-42",
      retryMilliseconds: 1_500,
    },
    {
      sequence: 3,
      type: "message",
      data: "retained-id",
      lastEventId: "customer-42",
      retryMilliseconds: 1_500,
    },
    {
      sequence: 4,
      type: "message",
      data: "final",
      lastEventId: "customer-42",
      retryMilliseconds: 1_500,
    },
  ]);
  assert.ok(events.every(Object.isFrozen));
  assert.equal(decoder.eventCount, 4);
  assert.equal(decoder.lastEventId, "customer-42");
  assert.equal(decoder.retryMilliseconds, 1_500);
  assert.deepEqual(decoder.finish(), []);
  assert.throws(() => decoder.push("data: late\n\n"), /already finished/u);
});

test("applies field whitespace and persistent ID/retry semantics", () => {
  const decoder = createServerEventDecoder();
  assert.deepEqual(
    decoder.push(
      "id\ndata: colon: stays\nretry: -1\nretry: 999999\nretry: 250\nevent: \n\n",
    ),
    [
      {
        sequence: 1,
        type: "message",
        data: "colon: stays",
        lastEventId: "",
        retryMilliseconds: 250,
      },
    ],
  );
  assert.deepEqual(decoder.push("data\n\n"), [
    {
      sequence: 2,
      type: "message",
      data: "",
      lastEventId: "",
      retryMilliseconds: 250,
    },
  ]);
});

test("bounds decoder lines, data, line count, event count, and options", () => {
  assert.throws(
    () => createServerEventDecoder({ maxLineCharacters: 0 }),
    /maxLineCharacters/u,
  );
  assert.throws(
    () => createServerEventDecoder({ maxEvents: 100_001 }),
    /maxEvents/u,
  );

  const longLine = createServerEventDecoder({ maxLineCharacters: 4 });
  assert.throws(() => longLine.push("data:"), /line exceeded/u);

  const largeData = createServerEventDecoder({ maxDataCharacters: 3 });
  assert.throws(() => largeData.push("data: four\n"), /data characters/u);

  const manyLines = createServerEventDecoder({ maxLines: 1 });
  assert.throws(() => manyLines.push("data: one\ndata: two\n"), /data lines/u);

  const manyEvents = createServerEventDecoder({ maxEvents: 1 });
  assert.equal(manyEvents.push("data: one\n\n").length, 1);
  assert.throws(() => manyEvents.push("data: two\n\n"), /exceeded 1 events/u);
  assert.throws(
    () => createServerEventDecoder().push(null),
    /must be strings/u,
  );
});

test("requests one event stream over the bounded native text transport", async () => {
  const adapter = memoryAdapter();
  const service = createNetworkService(adapter);
  const responses = [];
  const events = [];
  const results = [];
  const handle = requestServerEvents(
    service,
    {
      url: "https://api.example.test/assistant",
      headers: { Accept: "text/event-stream" },
    },
    {
      onResponse: (response) => responses.push(response),
      onEvent: (event) => events.push(event),
      onResult: (result) => results.push(result),
    },
  );
  await Promise.resolve();
  adapter.emit(0, {
    kind: "response",
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    url: null,
  });
  adapter.emit(0, {
    kind: "chunk",
    text: 'id: 7\nevent: tool\ndata: {"name":"lookup"}\n\n',
    loaded: 47,
    total: -1,
  });
  adapter.emit(0, {
    kind: "chunk",
    text: "data: final",
    loaded: 58,
    total: -1,
  });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });

  const result = await handle.result;
  assert.deepEqual(result, {
    response: responses[0],
    chunkCount: 2,
    receivedCharacters: 54,
    eventCount: 2,
    lastEventId: "7",
  });
  assert.deepEqual(results, [result]);
  assert.deepEqual(events, [
    {
      sequence: 1,
      type: "tool",
      data: '{"name":"lookup"}',
      lastEventId: "7",
    },
    {
      sequence: 2,
      type: "message",
      data: "final",
      lastEventId: "7",
    },
  ]);
  assert.ok(Object.isFrozen(await handle.result));
  handle.cancel();
  assert.deepEqual(adapter.cancellations, []);
});

test("rejects wrong status or media type and aborts native work", async () => {
  for (const response of [
    { status: 202, headers: { "Content-Type": "text/event-stream" } },
    { status: 200, headers: { "content-type": "application/json" } },
    { status: 200, headers: {} },
  ]) {
    const adapter = memoryAdapter();
    const service = createNetworkService(adapter);
    const handle = requestServerEvents(service, {
      url: "https://api.example.test/events",
    });
    await Promise.resolve();
    adapter.emit(0, { kind: "response", ...response, url: null });
    await assert.rejects(handle.result, ServerEventProtocolError);
    assert.deepEqual(adapter.cancellations, [0]);
  }
});

test("can explicitly accept a nonstandard event-stream media type", async () => {
  const adapter = memoryAdapter();
  const service = createNetworkService(adapter);
  const handle = requestServerEvents(
    service,
    { url: "https://api.example.test/events" },
    {},
    { requireEventStreamContentType: false },
  );
  await Promise.resolve();
  adapter.emit(0, {
    kind: "response",
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
    url: null,
  });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });
  assert.equal((await handle.result).eventCount, 0);
});

test("snapshots observers and rejects asynchronous event delivery", async () => {
  const adapter = memoryAdapter();
  const service = createNetworkService(adapter);
  const calls = [];
  const observer = { onEvent: (event) => calls.push(event.data) };
  const first = requestServerEvents(
    service,
    { url: "https://api.example.test/events" },
    observer,
  );
  observer.onEvent = () => calls.push("mutated");
  await Promise.resolve();
  adapter.emit(0, {
    kind: "response",
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    url: null,
  });
  adapter.emit(0, {
    kind: "chunk",
    text: "data: original\n\n",
    loaded: 16,
    total: -1,
  });
  adapter.emit(0, { kind: "complete", error: null, timedOut: false });
  await first.result;
  assert.deepEqual(calls, ["original"]);

  const second = requestServerEvents(
    service,
    { url: "https://api.example.test/events" },
    { async onEvent() {} },
  );
  await Promise.resolve();
  adapter.emit(1, {
    kind: "response",
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    url: null,
  });
  adapter.emit(1, {
    kind: "chunk",
    text: "data: async\n\n",
    loaded: 13,
    total: -1,
  });
  await assert.rejects(second.result, /must complete synchronously/u);
  assert.deepEqual(adapter.cancellations, [1]);

  const third = requestServerEvents(
    service,
    { url: "https://api.example.test/events" },
    { async onResult() {} },
  );
  await Promise.resolve();
  adapter.emit(2, {
    kind: "response",
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    url: null,
  });
  adapter.emit(2, { kind: "complete", error: null, timedOut: false });
  await assert.rejects(third.result, /must complete synchronously/u);
});

test("validates requester, observer, options, and returned handles", () => {
  assert.throws(
    () => requestServerEvents(null, { url: "https://api.example.test/" }),
    /requester/u,
  );
  assert.throws(
    () =>
      requestServerEvents(
        { requestText() {} },
        { url: "https://api.example.test/" },
        { onEvent: true },
      ),
    /onEvent/u,
  );
  assert.throws(
    () =>
      requestServerEvents(
        { requestText() {} },
        { url: "https://api.example.test/" },
        {},
        { requireEventStreamContentType: "yes" },
      ),
    /must be a boolean/u,
  );
  assert.throws(
    () =>
      requestServerEvents(
        { requestText: () => ({ result: true, cancel() {} }) },
        { url: "https://api.example.test/" },
      ),
    /invalid request handle/u,
  );
});
