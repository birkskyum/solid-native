import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertNetworkingServerEvidence,
  createNetworkingProofServer,
  summarizeNetworkingServerEvidence,
} from "./native-networking-proof-server.mjs";

const directory = new URL("../", import.meta.url);

async function abortStreamingResponse(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body?.getReader();
  assert.ok(reader, "The held response did not expose a body reader.");
  const first = await reader.read();
  assert.equal(first.done, false);
  controller.abort();
  await assert.rejects(reader.read(), /abort|operation|cancel/iu);
}

test("the local networking proof server exercises every bounded protocol path", async (t) => {
  const proof = await createNetworkingProofServer({
    pathPrefix: "/physical_run-42",
  });
  t.after(() => proof.close());
  const origin =
    `http://127.0.0.1:${String(proof.hostPort)}` + proof.pathPrefix;

  const events = await fetch(`${origin}/events`, {
    headers: { Accept: "text/event-stream" },
  });
  assert.equal(events.status, 200);
  assert.equal(events.headers.get("x-solid-native-proof"), "event-stream");
  const eventText = await events.text();
  assert.match(eventText, /event: token\r\ndata: hello\r\n\r\n/u);
  assert.match(eventText, /id: native-2\ndata: world$/u);

  const json = await fetch(`${origin}/json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Solid-Native-Proof": "network-header-secret-91ef",
    },
    body: '{"request":"network-body-secret-4b7a"}',
  });
  assert.equal(json.status, 201);
  assert.deepEqual(await json.json(), { phase: "native", count: 2 });
  const progress = summarizeNetworkingServerEvidence(proof.state);
  assert.deepEqual(progress, {
    requests: { "/events": 1, "/json": 1 },
    streamedServerEvents: true,
    structuredJSONRequest: true,
    transportFailure: false,
    abortedResponses: [],
    unauthorizedRequestCount: 0,
    serverErrorCount: 0,
  });
  assert.doesNotMatch(
    JSON.stringify(progress),
    /network-header-secret|network-body-secret/u,
  );

  await assert.rejects(async () => {
    const failure = await fetch(`${origin}/failure`);
    await failure.text();
  });
  await abortStreamingResponse(`${origin}/cancel`);
  await abortStreamingResponse(`${origin}/dispose`);

  const deadline = Date.now() + 2_000;
  let evidence;
  while (evidence === undefined) {
    try {
      evidence = assertNetworkingServerEvidence(proof.state);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.deepEqual(evidence, {
    requestCount: 5,
    streamedServerEvents: true,
    structuredJSONRequest: true,
    transportFailure: true,
    transportFailureAttempts: 1,
    explicitCancellation: true,
    ownerCancellation: true,
  });
});

test("the shared proof server rejects traffic outside a run-scoped path", async (t) => {
  const proof = await createNetworkingProofServer({
    pathPrefix: "/run_secret",
  });
  t.after(() => proof.close());
  const response = await fetch(
    `http://127.0.0.1:${String(proof.hostPort)}/events`,
  );
  assert.equal(response.status, 404);
  assert.equal(proof.state.unauthorizedRequestCount, 1);
  assert.throws(
    () => assertNetworkingServerEvidence(proof.state),
    /outside its run-scoped path/u,
  );
  await assert.rejects(
    createNetworkingProofServer({ pathPrefix: "/nested/path" }),
    /one bounded URL path segment/u,
  );
});

test("physical Android networking proof keeps app, runner, and instrumentation aligned", async () => {
  const [
    application,
    instrumentation,
    runner,
    manifest,
    packageManifest,
    mapVerifier,
  ] = await Promise.all([
    readFile(new URL("networking.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeNetworkingPhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/android-networking-proof.mjs", directory),
      "utf8",
    ),
    readFile(
      new URL("android/app/src/main/AndroidManifest.xml", directory),
      "utf8",
    ),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
    readFile(
      new URL("scripts/verify-networking-sourcemap.mjs", directory),
      "utf8",
    ),
  ]);

  for (const value of [
    "Solid Native networking ready",
    "Run native networking protocol proof",
    "Networking proof complete (2 SSE events, JSON 2, failure, cancellation)",
    "Start owner-disposal network request",
    "Owner-disposal request active",
    "Dispose active networking owner",
  ]) {
    assert.ok(application.includes(value), `Application is missing ${value}.`);
    assert.ok(
      instrumentation.includes(value),
      `Instrumentation is missing ${value}.`,
    );
  }
  assert.match(application, /http:\/\/127\.0\.0\.1:38473/u);
  assert.match(
    application,
    /createReactNativeNetworkService\(\)[\s\S]*createNetworkController\(service\)/u,
  );
  assert.match(
    application,
    /createServerEventStream\([\s\S]*stream\.restart\([\s\S]*requestJSON\([\s\S]*NetworkTransportError[\s\S]*NetworkRequestCancelledError/u,
  );
  assert.match(
    application,
    /platform\.network\.response[\s\S]*platform\.network\.chunk[\s\S]*platform\.network\.complete/u,
  );
  assert.match(
    application,
    /solid-native\.commit[\s\S]*solid-native\.mount[\s\S]*solid-native\.frame/u,
  );
  assert.match(
    instrumentation,
    /tapControl\(RUN_LABEL\)[\s\S]*COMPLETE_TEXT[\s\S]*tapControl\(START_DISPOSAL_LABEL\)[\s\S]*DISPOSAL_ACTIVE_TEXT[\s\S]*tapControl\(DISPOSE_LABEL\)/u,
  );
  assert.match(
    instrumentation,
    /waitForTeardownAcknowledgement\(\)[\s\S]*logcat -d -v brief -s ReactNativeJS:I[\s\S]*SOLID_NATIVE_NETWORKING_OWNER_CANCELLATION_SUCCEEDED[\s\S]*SOLID_NATIVE_NETWORKING_TEARDOWN_SUCCEEDED/u,
  );
  assert.match(runner, /getprop", "ro\.kernel\.qemu/u);
  assert.match(
    runner,
    /reverse[\s\S]*DEVICE_PORT[\s\S]*proofServer\.hostPort/u,
  );
  assert.match(runner, /ENTRY_FILE: "networking\.tsx"/u);
  assert.match(runner, /assembleSolidReleaseAndroidTest/u);
  assert.match(runner, /assertNetworkingServerEvidence/u);
  assert.match(runner, /SOLID_NATIVE_NETWORKING_TEARDOWN_SUCCEEDED/u);
  assert.match(manifest, /android\.permission\.INTERNET/u);
  assert.match(manifest, /android:usesCleartextTraffic="true"/u);
  assert.match(mapVerifier, /dist\\\/json\\\.js/u);
  assert.equal(
    packageManifest.scripts["android:networking:test"],
    "node scripts/android-networking-proof.mjs",
  );
});
