import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createInspectableNetworkService as createDevelopmentService } from "../dist/network-service-development.js";
import { createInspectableNetworkService as createProductionService } from "../dist/network-service.js";

function memoryService() {
  const requests = [];
  return {
    requests,
    service: {
      platform: "android",
      requestText(request) {
        requests.push(request);
        return Object.freeze({
          result: Promise.resolve({
            response: { status: 204, url: request.url, headers: {} },
            chunkCount: 0,
            receivedCharacters: 0,
          }),
          cancel() {},
        });
      },
    },
  };
}

test("keeps the production network helper import-free and preserves service identity", async () => {
  const source = await readFile(
    new URL("../dist/network-service.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /^import\s/mu);
  assert.doesNotMatch(source, /\.\/network\.js/u);

  const native = memoryService();
  const configured = createProductionService(native.service, {
    captureRequestTargets: true,
  });
  assert.equal(configured.service, native.service);
  assert.equal(configured.inspector, undefined);
  assert.ok(Object.isFrozen(configured));
});

test("instruments the same public helper in development", async () => {
  const native = memoryService();
  const configured = createDevelopmentService(native.service, {
    captureRequestTargets: true,
    clock: () => 1,
  });
  assert.notEqual(configured.service, native.service);
  assert.ok(configured.inspector);

  const request = configured.service.requestText({
    url: "https://api.example.test/v1/data?token=private",
  });
  assert.deepEqual(await request.result, {
    response: {
      status: 204,
      url: "https://api.example.test/v1/data?token=private",
      headers: {},
    },
    chunkCount: 0,
    receivedCharacters: 0,
  });
  await Promise.resolve();
  assert.equal(native.requests.length, 1);
  assert.deepEqual(configured.inspector.history(), [
    {
      protocolVersion: 0,
      id: 1,
      platform: "android",
      method: "GET",
      requestTarget: "https://api.example.test/v1/data",
      responseTarget: "https://api.example.test/v1/data",
      state: "completed",
      startedAt: 1,
      updatedAt: 1,
      finishedAt: 1,
      durationMilliseconds: 0,
      responseStatus: 204,
      chunkCount: 0,
      receivedCharacters: 0,
      loadedBytes: 0,
    },
  ]);
});

test("keeps production and development validation aligned", () => {
  for (const createService of [
    createProductionService,
    createDevelopmentService,
  ]) {
    assert.throws(() => createService({}), /Android or iOS NetworkService/u);
    assert.throws(
      () => createService(memoryService().service, { maxHistory: 0 }),
      /maxHistory/u,
    );
    assert.throws(
      () =>
        createService(memoryService().service, {
          captureRequestTargets: "yes",
        }),
      /captureRequestTargets/u,
    );
  }
});
