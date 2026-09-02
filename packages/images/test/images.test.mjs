import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_MAX_CACHE_QUERY_URIS,
  IMAGE_MAX_DIMENSION,
  IMAGE_MAX_HEADER_COUNT,
  IMAGE_MAX_HEADER_VALUE_LENGTH,
  IMAGE_MAX_URI_LENGTH,
  ImagePrefetchCancelledError,
  createImageService,
} from "../dist/index.js";

function memoryAdapter() {
  return {
    platform: "android",
    dimensionResult: { width: 1200, height: 800 },
    prefetchResult: true,
    cacheResult: {},
    requests: [],
    cancellations: [],
    cacheQueries: [],
    async getDimensions(request) {
      this.requests.push(request);
      return this.dimensionResult;
    },
    async prefetchImage(uri, requestId) {
      this.requests.push({ uri, requestId });
      return this.prefetchResult;
    },
    cancelPrefetch(requestId) {
      this.cancellations.push(requestId);
    },
    async queryCache(uris) {
      this.cacheQueries.push(uris);
      return this.cacheResult;
    },
  };
}

test("normalizes requests and validates frozen native image dimensions", async () => {
  const adapter = memoryAdapter();
  const images = createImageService(adapter);
  const result = await images.getDimensions({
    uri: "https://images.example/hero.png",
    headers: {
      Authorization: "Bearer private",
      "X-Solid": "native",
    },
  });

  assert.equal(images.platform, "android");
  assert.deepEqual(adapter.requests[0], {
    uri: "https://images.example/hero.png",
    headers: {
      Authorization: "Bearer private",
      "X-Solid": "native",
    },
  });
  assert.deepEqual(result, { width: 1200, height: 800 });
  assert.ok(Object.isFrozen(adapter.requests[0]));
  assert.ok(Object.isFrozen(adapter.requests[0].headers));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(images));
});

test("prefetches through unique signed Android request identifiers", async () => {
  const adapter = memoryAdapter();
  const images = createImageService(adapter);
  const first = images.prefetch("https://images.example/first.png");
  const second = images.prefetch("file:///tmp/second.png");

  assert.ok(Object.isFrozen(first));
  await Promise.all([first.result, second.result]);
  assert.deepEqual(adapter.requests, [
    { uri: "https://images.example/first.png", requestId: 1 },
    { uri: "file:///tmp/second.png", requestId: 2 },
  ]);
  first.cancel();
  assert.deepEqual(adapter.cancellations, []);
});

test("cancels an active prefetch exactly once and ignores its late result", async () => {
  let settle;
  const adapter = memoryAdapter();
  adapter.prefetchImage = (_uri, requestId) => {
    adapter.requests.push({ requestId });
    return new Promise((resolve) => {
      settle = resolve;
    });
  };
  const images = createImageService(adapter);
  const handle = images.prefetch("https://images.example/slow.png");
  await Promise.resolve();

  handle.cancel();
  handle.cancel();
  await assert.rejects(handle.result, ImagePrefetchCancelledError);
  assert.deepEqual(adapter.cancellations, [1]);
  settle(true);
  await Promise.resolve();
});

test("does not start native work when a prefetch is cancelled immediately", async () => {
  const adapter = memoryAdapter();
  const images = createImageService(adapter);
  const handle = images.prefetch("https://images.example/not-started.png");
  handle.cancel();

  await assert.rejects(handle.result, ImagePrefetchCancelledError);
  await Promise.resolve();
  assert.deepEqual(adapter.requests, []);
  assert.deepEqual(adapter.cancellations, []);
});

test("rejects false or malformed native prefetch settlements", async () => {
  const adapter = memoryAdapter();
  const images = createImageService(adapter);
  adapter.prefetchResult = false;
  await assert.rejects(
    images.prefetch("https://images.example/not-cached.png").result,
    /boolean true/u,
  );
  adapter.prefetchResult = "yes";
  await assert.rejects(
    images.prefetch("https://images.example/invalid.png").result,
    /boolean true/u,
  );
});

test("returns ordered explicit cache states while deduplicating native work", async () => {
  const adapter = memoryAdapter();
  adapter.cacheResult = {
    "https://images.example/a.png": "memory",
    "https://images.example/b.png": "disk/memory",
  };
  const images = createImageService(adapter);
  const entries = await images.queryCache([
    "https://images.example/a.png",
    "https://images.example/missing.png",
    "https://images.example/b.png",
    "https://images.example/a.png",
  ]);

  assert.deepEqual(adapter.cacheQueries, [
    [
      "https://images.example/a.png",
      "https://images.example/missing.png",
      "https://images.example/b.png",
    ],
  ]);
  assert.deepEqual(entries, [
    { uri: "https://images.example/a.png", location: "memory" },
    { uri: "https://images.example/missing.png", location: "none" },
    { uri: "https://images.example/b.png", location: "disk/memory" },
    { uri: "https://images.example/a.png", location: "memory" },
  ]);
  assert.ok(Object.isFrozen(entries));
  assert.ok(entries.every(Object.isFrozen));
  assert.ok(Object.isFrozen(adapter.cacheQueries[0]));
});

test("rejects malformed application URIs and headers before native work", async () => {
  const adapter = memoryAdapter();
  const images = createImageService(adapter);
  for (const uri of [
    "",
    "relative/image.png",
    "https://images.example/line\nbreak",
    `https://images.example/${"x".repeat(IMAGE_MAX_URI_LENGTH)}`,
  ]) {
    await assert.rejects(images.getDimensions(uri), /absolute URI/u);
  }
  await assert.rejects(
    images.getDimensions({
      uri: "https://images.example/a.png",
      headers: { "Bad Header": "x" },
    }),
    /HTTP tokens/u,
  );
  await assert.rejects(
    images.getDimensions({
      uri: "https://images.example/a.png",
      headers: { Authorization: "one\r\nInjected: yes" },
    }),
    /line breaks/u,
  );
  await assert.rejects(
    images.getDimensions({
      uri: "https://images.example/a.png",
      headers: { Authorization: "x".repeat(IMAGE_MAX_HEADER_VALUE_LENGTH + 1) },
    }),
    /at most 8192/u,
  );
  await assert.rejects(
    images.getDimensions({
      uri: "https://images.example/a.png",
      headers: Object.fromEntries(
        Array.from({ length: IMAGE_MAX_HEADER_COUNT + 1 }, (_, index) => [
          `X-${index}`,
          "x",
        ]),
      ),
    }),
    /at most 128/u,
  );
  assert.deepEqual(adapter.requests, []);
});

test("rejects malformed native dimensions and cache states", async () => {
  const adapter = memoryAdapter();
  const images = createImageService(adapter);
  for (const dimensionResult of [
    null,
    { width: 0, height: 1 },
    { width: Number.NaN, height: 1 },
    { width: IMAGE_MAX_DIMENSION + 1, height: 1 },
    { width: 1, height: "2" },
  ]) {
    adapter.dimensionResult = dimensionResult;
    await assert.rejects(
      images.getDimensions("data:image/png;base64,eA=="),
      /Native image/u,
    );
  }

  adapter.cacheResult = {
    "https://images.example/a.png": "remote",
  };
  await assert.rejects(
    images.queryCache(["https://images.example/a.png"]),
    /invalid state/u,
  );
  adapter.cacheResult = {
    "https://images.example/injected.png": "memory",
  };
  await assert.rejects(
    images.queryCache(["https://images.example/a.png"]),
    /unrequested URI/u,
  );
});

test("bounds cache work and validates adapters", async () => {
  const images = createImageService(memoryAdapter());
  await assert.rejects(images.queryCache(null), /must be arrays/u);
  await assert.rejects(
    images.queryCache(
      Array.from(
        { length: IMAGE_MAX_CACHE_QUERY_URIS + 1 },
        (_, index) => `https://images.example/${index}.png`,
      ),
    ),
    /at most 256/u,
  );
  assert.throws(() => createImageService(null), /plain object/u);
  assert.throws(
    () =>
      createImageService({
        platform: "web",
        getDimensions() {},
        prefetchImage() {},
        cancelPrefetch() {},
        queryCache() {},
      }),
    /android or ios/u,
  );
  assert.throws(
    () =>
      createImageService({
        platform: "ios",
        getDimensions() {},
        prefetchImage: true,
        cancelPrefetch() {},
        queryCache() {},
      }),
    /must provide/u,
  );
});
