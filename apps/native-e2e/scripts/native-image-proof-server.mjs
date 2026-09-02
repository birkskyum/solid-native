import { createServer } from "node:http";

const IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==",
  "base64",
);
const EXPECTED_HEADER = "private-image-header-37bd";
const COMPLETE_PATHS = new Set(["/dimensions.png", "/prefetch.png"]);
const HELD_PATHS = new Set(["/cancel.png", "/dispose.png"]);

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function responseHeaders() {
  return {
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Length": String(IMAGE_BYTES.byteLength),
    "Content-Type": "image/png",
    ETag: '"solid-native-image-proof-v1"',
  };
}

export async function createImageProofServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (typeof host !== "string" || host.length === 0 || host.length > 253) {
    throw new TypeError("Image proof server host must be a bounded string.");
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("Image proof server port must be 0-65535.");
  }
  const state = {
    abortedResponses: new Set(),
    dimensionsHeader: undefined,
    methods: new Map(),
    requests: new Map(),
    serverErrors: [],
  };
  const server = createServer((request, response) => {
    const pathName = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    increment(state.requests, pathName);
    state.methods.set(pathName, request.method);
    if (pathName === "/dimensions.png") {
      state.dimensionsHeader = request.headers["x-solid-native-image-proof"];
    }
    if (COMPLETE_PATHS.has(pathName)) {
      response.writeHead(200, responseHeaders());
      response.end(IMAGE_BYTES);
      return;
    }
    if (HELD_PATHS.has(pathName)) {
      response.writeHead(200, responseHeaders());
      response.flushHeaders();
      response.write(IMAGE_BYTES.subarray(0, 1));
      response.once("close", () => {
        if (!response.writableEnded) state.abortedResponses.add(pathName);
      });
      return;
    }
    response.writeHead(404, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("not found");
  });
  server.on("clientError", (error, socket) => {
    state.serverErrors.push(error.message);
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The image proof server did not bind a TCP port.");
  }
  return Object.freeze({
    hostPort: address.port,
    state,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      });
    },
  });
}

export function assertImageServerEvidence(state) {
  if (state.serverErrors.length > 0) {
    throw new Error(
      `The image proof server reported errors: ${JSON.stringify(state.serverErrors)}.`,
    );
  }
  for (const pathName of [
    "/dimensions.png",
    "/prefetch.png",
    "/cancel.png",
    "/dispose.png",
  ]) {
    if (state.requests.get(pathName) !== 1) {
      throw new Error(
        `Expected one ${pathName} image request, observed ${String(state.requests.get(pathName) ?? 0)}.`,
      );
    }
    if (state.methods.get(pathName) !== "GET") {
      throw new Error(`The ${pathName} image request was not a GET.`);
    }
  }
  if ((state.requests.get("/missing.png") ?? 0) !== 0) {
    throw new Error("Cache inspection fetched the deliberately missing image.");
  }
  if (state.dimensionsHeader !== EXPECTED_HEADER) {
    throw new Error("The native dimension request omitted its private header.");
  }
  if (
    !state.abortedResponses.has("/cancel.png") ||
    !state.abortedResponses.has("/dispose.png")
  ) {
    throw new Error(
      "The native image loader did not abort both held responses.",
    );
  }
  return Object.freeze({
    authenticatedDimensions: true,
    prefetchFetched: true,
    cacheInspectionStayedOffline: true,
    explicitCancellationAbortedTransport: true,
    ownerDisposalAbortedTransport: true,
  });
}
