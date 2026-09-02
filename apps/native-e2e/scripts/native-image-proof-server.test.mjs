import assert from "node:assert/strict";
import test from "node:test";

import {
  assertImageServerEvidence,
  createImageProofServer,
} from "./native-image-proof-server.mjs";

function completeState() {
  return {
    abortedResponses: new Set(["/cancel.png", "/dispose.png"]),
    dimensionsHeader: "private-image-header-37bd",
    methods: new Map(
      ["/dimensions.png", "/prefetch.png", "/cancel.png", "/dispose.png"].map(
        (pathName) => [pathName, "GET"],
      ),
    ),
    requests: new Map(
      ["/dimensions.png", "/prefetch.png", "/cancel.png", "/dispose.png"].map(
        (pathName) => [pathName, 1],
      ),
    ),
    serverErrors: [],
  };
}

test("serves a cacheable PNG and captures the private dimension header", async () => {
  const server = await createImageProofServer();
  try {
    const dimensions = await fetch(
      `http://127.0.0.1:${String(server.hostPort)}/dimensions.png`,
      {
        headers: { "X-Solid-Native-Image-Proof": "private-image-header-37bd" },
      },
    );
    assert.equal(dimensions.status, 200);
    assert.equal(dimensions.headers.get("content-type"), "image/png");
    assert.match(dimensions.headers.get("cache-control") ?? "", /immutable/u);
    const bytes = new Uint8Array(await dimensions.arrayBuffer());
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(server.state.dimensionsHeader, "private-image-header-37bd");
    const missing = await fetch(
      `http://127.0.0.1:${String(server.hostPort)}/missing.png`,
    );
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test("requires exact fetch, header, offline cache, and abort evidence", () => {
  const state = completeState();
  assert.deepEqual(assertImageServerEvidence(state), {
    authenticatedDimensions: true,
    prefetchFetched: true,
    cacheInspectionStayedOffline: true,
    explicitCancellationAbortedTransport: true,
    ownerDisposalAbortedTransport: true,
  });

  state.requests.set("/missing.png", 1);
  assert.throws(
    () => assertImageServerEvidence(state),
    /Cache inspection fetched/u,
  );
  state.requests.delete("/missing.png");
  state.abortedResponses.delete("/dispose.png");
  assert.throws(() => assertImageServerEvidence(state), /did not abort both/u);
});
