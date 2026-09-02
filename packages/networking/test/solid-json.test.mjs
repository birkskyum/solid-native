import assert from "node:assert/strict";
import test from "node:test";

import { createRoot, createSignal } from "solid-js";

import { NetworkRequestCancelledError } from "../dist/index.js";
import { createJSONResource } from "../dist/solid-json.js";

function controlledRequester() {
  const requests = [];
  return {
    requests,
    requestText(request, observer = {}) {
      let resolve;
      let reject;
      let settled = false;
      const result = new Promise((resolveResult, rejectResult) => {
        resolve = resolveResult;
        reject = rejectResult;
      });
      const entry = {
        request,
        observer,
        cancellations: 0,
        respond(value, response = {}) {
          if (settled) return;
          observer.onResponse?.({
            status: 200,
            url: request.url,
            headers: { "Content-Type": "application/json" },
            ...response,
          });
          const text = JSON.stringify(value);
          observer.onChunk?.({
            sequence: 1,
            text,
            loaded: text.length,
          });
          settled = true;
          resolve({
            response: {
              status: 200,
              url: request.url,
              headers: { "Content-Type": "application/json" },
              ...response,
            },
            chunkCount: 1,
            receivedCharacters: text.length,
          });
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

test("projects reactive native JSON into a Solid-style resource", async () => {
  const requester = controlledRequester();
  let dispose;
  let resource;
  let setRequest;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const [request, updateRequest] = createSignal({
      url: "https://api.example.test/profile/first",
    });
    setRequest = updateRequest;
    resource = createJSONResource(requester, request, {
      decode(value) {
        if (
          value === null ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          typeof value.name !== "string"
        ) {
          throw new TypeError("Profile name is required.");
        }
        return value.name;
      },
    });
  });

  await turn();
  assert.equal(requester.requests.length, 1);
  assert.equal(resource.state, "pending");
  assert.equal(resource.loading, true);
  assert.equal(resource(), undefined);

  requester.requests[0].respond({ name: "Ada" });
  await turn();
  assert.equal(resource.state, "ready");
  assert.equal(resource.loading, false);
  assert.equal(resource(), "Ada");
  assert.equal(resource.latest, "Ada");
  assert.equal(resource.response.status, 200);
  assert.equal(resource.result.value.name, "Ada");

  setRequest({ url: "https://api.example.test/profile/second" });
  await turn();
  assert.equal(requester.requests.length, 2);
  assert.equal(resource.state, "refreshing");
  assert.equal(resource(), "Ada");
  assert.equal(resource.response, undefined);

  requester.requests[1].respond({ name: "Grace" });
  await turn();
  assert.equal(resource.state, "ready");
  assert.equal(resource(), "Grace");

  dispose();
});

test("cancels superseded and disposed work while suppressing stale settlement", async () => {
  const requester = controlledRequester();
  let dispose;
  let resource;
  let setRequest;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const [request, updateRequest] = createSignal({
      url: "https://api.example.test/first",
    });
    setRequest = updateRequest;
    resource = createJSONResource(requester, request);
  });

  await turn();
  setRequest({ url: "https://api.example.test/second" });
  await turn();
  assert.equal(requester.requests[0].cancellations, 1);
  assert.equal(resource.state, "pending");
  assert.equal(resource.error, undefined);

  requester.requests[1].respond({ version: 2 });
  await turn();
  assert.deepEqual(resource(), { version: 2 });

  const refetch = resource.refetch();
  await turn();
  assert.equal(resource.state, "refreshing");
  assert.equal(requester.requests.length, 3);
  resource.cancel();
  await assert.rejects(refetch, NetworkRequestCancelledError);
  assert.equal(requester.requests[2].cancellations, 1);
  assert.equal(resource.state, "ready");
  assert.deepEqual(resource(), { version: 2 });

  setRequest({ url: "https://api.example.test/disposed" });
  await turn();
  dispose();
  assert.equal(requester.requests[3].cancellations, 1);
});

test("retains the last good value across failures and supports disabling", async () => {
  const requester = controlledRequester();
  const reported = [];
  let dispose;
  let resource;
  let setRequest;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const [request, updateRequest] = createSignal({
      url: "https://api.example.test/initial",
    });
    setRequest = updateRequest;
    resource = createJSONResource(requester, request, {
      initialValue: { cached: true },
      onError: (error) => reported.push(error),
    });
  });

  await turn();
  assert.equal(resource.state, "refreshing");
  assert.deepEqual(resource(), { cached: true });
  const failure = new Error("offline");
  requester.requests[0].fail(failure);
  await turn();
  assert.equal(resource.state, "errored");
  assert.equal(resource.error, failure);
  assert.deepEqual(resource.latest, { cached: true });
  assert.deepEqual(reported, [failure]);

  setRequest(false);
  await turn();
  assert.equal(resource.state, "unresolved");
  assert.equal(resource.error, undefined);
  assert.deepEqual(resource(), { cached: true });
  assert.equal(await resource.refetch(), undefined);
  dispose();
});

test("rejects invalid construction and asynchronous decoders", async () => {
  const requester = controlledRequester();
  const reported = [];
  assert.throws(
    () => createJSONResource(requester, { url: "https://api.example.test/" }),
    /active Solid owner/u,
  );

  let dispose;
  let resource;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    assert.throws(
      () =>
        createJSONResource(requester, false, {
          unknown: true,
        }),
      /unknown field/u,
    );
    resource = createJSONResource(
      requester,
      { url: "https://api.example.test/async" },
      {
        onError: (error) => reported.push(error),
        async decode(value) {
          return value;
        },
      },
    );
  });
  await turn();
  requester.requests[0].respond({ invalid: "async" });
  await turn();
  assert.equal(resource.state, "errored");
  assert.match(resource.error.message, /complete synchronously/u);
  assert.deepEqual(reported, [resource.error]);
  dispose();
});
