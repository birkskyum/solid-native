import { createServer } from "node:http";

const MAX_REQUEST_BODY_BYTES = 4_096;
const VALID_PATH_PREFIX = /^\/[A-Za-z0-9_-]{1,128}$/u;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

async function readBoundedBody(request) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    byteLength += bytes.byteLength;
    if (byteLength > MAX_REQUEST_BODY_BYTES) {
      throw new RangeError(
        `The networking proof request body exceeded ${String(MAX_REQUEST_BODY_BYTES)} bytes.`,
      );
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

function holdResponse(response, pathName, state) {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Solid-Native-Proof": pathName.slice(1),
  });
  response.flushHeaders();
  response.write(`${pathName.slice(1)}-ready\n`);
  response.once("close", () => {
    if (!response.writableEnded) state.abortedResponses.add(pathName);
  });
}

function proofServerOptions(options) {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError("Networking proof server options must be an object.");
  }
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const pathPrefix = options.pathPrefix ?? "";
  if (typeof host !== "string" || host.length === 0 || host.length > 253) {
    throw new TypeError(
      "Networking proof server host must be a bounded string.",
    );
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("Networking proof server port must be 0-65535.");
  }
  if (pathPrefix !== "" && !VALID_PATH_PREFIX.test(pathPrefix)) {
    throw new TypeError(
      "Networking proof server pathPrefix must be one bounded URL path segment.",
    );
  }
  return Object.freeze({ host, port, pathPrefix });
}

export async function createNetworkingProofServer(options = {}) {
  const { host, port, pathPrefix } = proofServerOptions(options);
  const state = {
    abortedResponses: new Set(),
    failureDestroyed: false,
    jsonBody: undefined,
    jsonHeader: undefined,
    jsonMethod: undefined,
    requests: new Map(),
    serverErrors: [],
    streamCompleted: false,
    unauthorizedRequestCount: 0,
  };
  const server = createServer(async (request, response) => {
    const incomingPath = new URL(request.url ?? "/", "http://127.0.0.1")
      .pathname;
    if (
      pathPrefix !== "" &&
      incomingPath !== pathPrefix &&
      !incomingPath.startsWith(`${pathPrefix}/`)
    ) {
      state.unauthorizedRequestCount++;
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const pathName =
      pathPrefix === "" ? incomingPath : incomingPath.slice(pathPrefix.length);
    increment(state.requests, pathName);
    try {
      if (pathName === "/events") {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Solid-Native-Proof": "event-stream",
        });
        response.flushHeaders();
        // Keep response, first-event, and EOF commits in separate physical
        // frames even on a thermally constrained development device.
        await delay(750);
        response.write(": physical\r");
        await delay(40);
        response.write(
          "\nretry: 1500\r\nid: native-1\r\nevent: token\r\ndata: hel",
        );
        await delay(40);
        response.write("lo\r\n\r\n");
        await delay(750);
        response.end("id: native-2\ndata: world");
        state.streamCompleted = true;
        return;
      }
      if (pathName === "/json") {
        state.jsonMethod = request.method;
        state.jsonHeader = request.headers["x-solid-native-proof"];
        state.jsonBody = await readBoundedBody(request);
        response.writeHead(201, {
          "Cache-Control": "no-store",
          "Content-Type": "application/vnd.solid-native+json; charset=utf-8",
        });
        response.write('{"phase":"native",');
        await delay(100);
        response.end('"count":2}');
        return;
      }
      if (pathName === "/failure") {
        // Close before response metadata so both OkHttp and URLSession must
        // report a transport failure instead of accepting a partial body.
        state.failureDestroyed = true;
        response.destroy();
        return;
      }
      if (pathName === "/cancel" || pathName === "/dispose") {
        holdResponse(response, pathName, state);
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
    } catch (error) {
      state.serverErrors.push(
        error instanceof Error ? error.message : String(error),
      );
      if (!response.headersSent) response.writeHead(500);
      if (!response.destroyed) response.end();
    }
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
    throw new Error("The networking proof server did not bind a TCP port.");
  }
  return Object.freeze({
    hostPort: address.port,
    pathPrefix,
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

export function assertNetworkingServerEvidence(state) {
  if (state.serverErrors.length > 0) {
    throw new Error(
      `The networking proof server reported errors: ${JSON.stringify(state.serverErrors)}.`,
    );
  }
  if (state.unauthorizedRequestCount !== 0) {
    throw new Error(
      `The networking proof server rejected ${String(state.unauthorizedRequestCount)} requests outside its run-scoped path.`,
    );
  }
  for (const pathName of ["/events", "/json", "/cancel", "/dispose"]) {
    if (state.requests.get(pathName) !== 1) {
      throw new Error(
        `Expected one ${pathName} request, observed ${String(state.requests.get(pathName) ?? 0)}.`,
      );
    }
  }
  const transportFailureAttempts = state.requests.get("/failure") ?? 0;
  if (transportFailureAttempts < 1 || transportFailureAttempts > 2) {
    throw new Error(
      `Expected one request plus at most one native transport retry for /failure, observed ${String(transportFailureAttempts)}.`,
    );
  }
  if (
    !state.streamCompleted ||
    state.jsonMethod !== "POST" ||
    state.jsonHeader !== "network-header-secret-91ef" ||
    state.jsonBody !== '{"request":"network-body-secret-4b7a"}' ||
    !state.failureDestroyed ||
    !state.abortedResponses.has("/cancel") ||
    !state.abortedResponses.has("/dispose")
  ) {
    throw new Error("The networking proof server evidence is incomplete.");
  }
  return Object.freeze({
    requestCount: [...state.requests.values()].reduce(
      (sum, count) => sum + count,
      0,
    ),
    streamedServerEvents: state.streamCompleted,
    structuredJSONRequest: true,
    transportFailure: state.failureDestroyed,
    transportFailureAttempts,
    explicitCancellation: state.abortedResponses.has("/cancel"),
    ownerCancellation: state.abortedResponses.has("/dispose"),
  });
}

/** Returns bounded progress metadata without exposing request content. */
export function summarizeNetworkingServerEvidence(state) {
  return Object.freeze({
    requests: Object.freeze(
      Object.fromEntries(
        [...state.requests.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
    streamedServerEvents: state.streamCompleted,
    structuredJSONRequest:
      state.jsonMethod === "POST" &&
      state.jsonHeader === "network-header-secret-91ef" &&
      state.jsonBody === '{"request":"network-body-secret-4b7a"}',
    transportFailure: state.failureDestroyed,
    abortedResponses: Object.freeze([...state.abortedResponses].sort()),
    unauthorizedRequestCount: state.unauthorizedRequestCount,
    serverErrorCount: state.serverErrors.length,
  });
}
