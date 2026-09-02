import assert from "node:assert/strict";
import test from "node:test";

import { createRoot, createSignal } from "solid-js";

import { NetworkRequestCancelledError } from "../dist/index.js";
import { createServerEventStream } from "../dist/solid-server-events.js";

function controlledRequester() {
  const requests = [];
  return {
    requests,
    requestText(request, observer = {}) {
      let resolve;
      let reject;
      let settled = false;
      let response;
      let chunkCount = 0;
      let receivedCharacters = 0;
      const result = new Promise((resolveResult, rejectResult) => {
        resolve = resolveResult;
        reject = rejectResult;
      });
      const entry = {
        request,
        cancellations: 0,
        open(overrides = {}) {
          if (settled) return;
          response = {
            status: 200,
            url: request.url,
            headers: { "Content-Type": "text/event-stream" },
            ...overrides,
          };
          try {
            observer.onResponse?.(response);
          } catch (error) {
            settled = true;
            reject(error);
          }
        },
        chunk(text) {
          if (settled) return;
          chunkCount += 1;
          receivedCharacters += text.length;
          try {
            observer.onChunk?.({
              sequence: chunkCount,
              text,
              loaded: receivedCharacters,
            });
          } catch (error) {
            settled = true;
            reject(error);
          }
        },
        finish() {
          if (settled) return;
          settled = true;
          resolve({ response, chunkCount, receivedCharacters });
        },
        fail(error) {
          if (settled) return;
          settled = true;
          reject(error);
        },
      };
      requests.push(entry);
      return Object.freeze({
        result,
        cancel() {
          if (settled) return;
          entry.cancellations += 1;
          settled = true;
          reject(new NetworkRequestCancelledError());
        },
      });
    },
  };
}

async function turn() {
  await Promise.resolve();
  await Promise.resolve();
}

test("projects one native SSE connection into fine-grained Solid state", async () => {
  const requester = controlledRequester();
  const delivered = [];
  const responses = [];
  let dispose;
  let stream;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    stream = createServerEventStream(
      requester,
      { url: "https://api.example.test/assistant" },
      {
        onResponse: (response) => responses.push(response.url),
        onEvent: (event) => delivered.push(event.data),
      },
    );
  });

  await turn();
  assert.equal(stream.state, "connecting");
  assert.equal(stream.active, true);
  requester.requests[0].open();
  await turn();
  assert.equal(stream.state, "open");
  assert.equal(stream.response.status, 200);
  assert.deepEqual(responses, ["https://api.example.test/assistant"]);

  requester.requests[0].chunk(
    "id: answer-1\nevent: token\ndata: first\nretry: 750\n\n",
  );
  await turn();
  assert.equal(stream().type, "token");
  assert.equal(stream.latest.data, "first");
  assert.equal(stream.eventCount, 1);
  assert.equal(stream.lastEventId, "answer-1");
  assert.equal(stream.retryMilliseconds, 750);
  assert.deepEqual(delivered, ["first"]);

  requester.requests[0].chunk("data: final");
  requester.requests[0].finish();
  await turn();
  assert.equal(stream.state, "closed");
  assert.equal(stream.active, false);
  assert.equal(stream().data, "final");
  assert.equal(stream.eventCount, 2);
  assert.equal(stream.result.eventCount, 2);
  assert.deepEqual(delivered, ["first", "final"]);
  dispose();
});

test("cancels replaced, restarted, and owner-disposed streams", async () => {
  const requester = controlledRequester();
  let dispose;
  let stream;
  let setRequest;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const [request, updateRequest] = createSignal({
      url: "https://api.example.test/first",
    });
    setRequest = updateRequest;
    stream = createServerEventStream(requester, request);
  });

  await turn();
  setRequest({ url: "https://api.example.test/second" });
  await turn();
  assert.equal(requester.requests[0].cancellations, 1);
  assert.equal(stream.state, "connecting");
  assert.equal(stream.error, undefined);

  requester.requests[1].open();
  requester.requests[1].chunk("id: 2\ndata: current\n\n");
  await turn();
  assert.equal(stream().data, "current");

  const restarted = stream.restart({
    url: "https://api.example.test/explicit-restart",
  });
  await turn();
  assert.equal(requester.requests[1].cancellations, 1);
  assert.equal(requester.requests.length, 3);
  assert.equal(
    requester.requests[2].request.url,
    "https://api.example.test/explicit-restart",
  );
  assert.throws(() => stream.restart(null), /restart request/u);
  stream.cancel();
  await assert.rejects(restarted, NetworkRequestCancelledError);
  assert.equal(requester.requests[2].cancellations, 1);
  assert.equal(stream.state, "closed");

  setRequest({ url: "https://api.example.test/disposed" });
  await turn();
  dispose();
  assert.equal(requester.requests[3].cancellations, 1);
});

test("reports active failures once and clears state when disabled", async () => {
  const requester = controlledRequester();
  const reported = [];
  let dispose;
  let stream;
  let setRequest;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const [request, updateRequest] = createSignal({
      url: "https://api.example.test/failure",
    });
    setRequest = updateRequest;
    stream = createServerEventStream(requester, request, {
      onError: (error) => reported.push(error),
    });
  });

  await turn();
  const failure = new Error("offline");
  requester.requests[0].fail(failure);
  await turn();
  assert.equal(stream.state, "errored");
  assert.equal(stream.error, failure);
  assert.deepEqual(reported, [failure]);

  setRequest(false);
  await turn();
  assert.equal(stream.state, "unresolved");
  assert.equal(stream.error, undefined);
  assert.equal(stream(), undefined);
  assert.equal(stream.response, undefined);
  assert.equal(await stream.restart(), undefined);
  dispose();
});

test("rejects invalid construction and asynchronous event observers", async () => {
  const requester = controlledRequester();
  assert.throws(
    () =>
      createServerEventStream(requester, {
        url: "https://api.example.test/events",
      }),
    /active Solid owner/u,
  );

  const reported = [];
  let dispose;
  let stream;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    assert.throws(
      () => createServerEventStream(requester, false, { unknown: true }),
      /unknown field/u,
    );
    stream = createServerEventStream(
      requester,
      { url: "https://api.example.test/async" },
      {
        onError: (error) => reported.push(error),
        async onEvent() {},
      },
    );
  });
  await turn();
  requester.requests[0].open();
  requester.requests[0].chunk("data: invalid\n\n");
  await turn();
  assert.equal(stream.state, "errored");
  assert.match(stream.error.message, /complete synchronously/u);
  assert.deepEqual(reported, [stream.error]);
  dispose();
});
