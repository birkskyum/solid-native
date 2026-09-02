import assert from "node:assert/strict";
import test from "node:test";

import {
  CAUSAL_DEBUG_SNAPSHOT_KIND,
  CAUSAL_DEBUG_SNAPSHOT_MAX_CAUSES,
  CAUSAL_DEBUG_SNAPSHOT_SCHEMA_VERSION,
  OBSERVABILITY_PROTOCOL_VERSION,
  SOLID_DIAGNOSTICS_DEBUG_KIND,
  SOLID_DIAGNOSTICS_DEBUG_MAX_NAME_LENGTH,
  SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
  createCausalDebugSnapshot,
  createCausalTelemetryFanout,
  createCausalTimeline,
  createCausalTelemetry,
  createOpenTelemetryCausalExporter,
  createSampledCausalTelemetry,
  createSentryCausalExporter,
  createSolidDiagnosticsDebugEnvelope,
  explainCausalTimelineSnapshot,
  groupCausalTimelineSnapshot,
  parseCausalDebugSnapshot,
  parseSolidDiagnosticsDebugEnvelope,
  serializeSolidDiagnosticsDebugEnvelope,
  telemetryErrorAttributes,
} from "@solid-native/observability";

function fakeSentry() {
  const spans = [];
  return {
    spans,
    startInactiveSpan(options) {
      const attributes = { ...options.attributes };
      const span = {
        options,
        attributes,
        status: undefined,
        endedAt: undefined,
        setAttribute(name, value) {
          attributes[name] = value;
        },
        setStatus(status) {
          span.status = status;
        },
        end(timestamp) {
          span.endedAt = timestamp;
        },
      };
      spans.push(span);
      return span;
    },
  };
}

function fakeOpenTelemetry() {
  const spans = [];
  return {
    spans,
    startSpan(name, options) {
      const attributes = { ...options.attributes };
      const span = {
        name,
        options,
        attributes,
        status: undefined,
        endedAt: undefined,
        setAttribute(attributeName, value) {
          attributes[attributeName] = value;
        },
        setStatus(status) {
          span.status = status;
        },
        end(timestamp) {
          span.endedAt = timestamp;
        },
      };
      spans.push(span);
      return span;
    },
  };
}

test("creates a bounded value-free Solid diagnostics debug envelope", () => {
  const privateCanary = "private-value-canary";
  const envelope = createSolidDiagnosticsDebugEnvelope({
    capturedAt: "2026-08-27T12:34:56.789Z",
    durationMilliseconds: 12.5,
    droppedDiagnostics: 2,
    diagnostics: [
      {
        sequence: 1,
        code: "STRICT_READ_UNTRACKED",
        kind: "strict-read",
        severity: "warn",
        message: privateCanary,
        data: { value: privateCanary },
        ownerId: privateCanary,
        ownerName: "counter.owner",
        nodeName: "counter.output",
      },
    ],
    reruns: [
      {
        run: 2,
        nodeRuns: 1,
        nodeKind: "effect",
        nodeName: "counter.output",
        node: { privateCanary },
        causes: [
          {
            seq: 1,
            kind: "write",
            name: "counter",
            prev: privateCanary,
            value: privateCanary,
            stack: [privateCanary],
          },
        ],
        depCount: 1,
        depsAdded: ["counter"],
        depsRemoved: [],
        selfMs: 0.25,
        totalMs: 0.5,
        changed: true,
        phase: "plain",
        held: false,
      },
    ],
    costs: {
      scopes: [
        {
          name: "counter.output",
          kind: "effect",
          runs: 1,
          selfMs: 0.25,
          wastedMs: 0,
          overlayMs: 0,
        },
      ],
      writes: [{ name: "counter", runs: 1, downstreamMs: 0.25 }],
    },
  });

  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(envelope.kind, SOLID_DIAGNOSTICS_DEBUG_KIND);
  assert.equal(envelope.truncated, true);
  assert.equal(envelope.droppedDiagnostics, 2);
  assert.deepEqual(envelope.diagnostics, [
    {
      sequence: 1,
      code: "STRICT_READ_UNTRACKED",
      kind: "strict-read",
      severity: "warn",
      ownerName: "counter.owner",
      nodeName: "counter.output",
    },
  ]);
  assert.deepEqual(envelope.reruns[0].causes, [
    { sequence: 1, kind: "write", name: "counter" },
  ]);
  const serialized = serializeSolidDiagnosticsDebugEnvelope(envelope);
  assert.equal(serialized.includes(privateCanary), false);
  assert.equal(serialized.includes("message"), false);
  assert.equal(serialized.includes("stack"), false);
  assert.equal(serialized.includes("value"), false);
  const parsed = parseSolidDiagnosticsDebugEnvelope(JSON.parse(serialized));
  assert.deepEqual(parsed, envelope);
  assert.equal(Object.isFrozen(parsed.reruns[0].causes), true);
});

test("clips and rejects hostile Solid diagnostics debug inputs", () => {
  const diagnostic = {
    sequence: 1,
    code: "X".repeat(SOLID_DIAGNOSTICS_DEBUG_MAX_NAME_LENGTH + 1),
    kind: "perf",
    severity: "warn",
  };
  const envelope = createSolidDiagnosticsDebugEnvelope({
    capturedAt: "2026-08-27T00:00:00.000Z",
    durationMilliseconds: 1,
    diagnostics: Array.from(
      { length: SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS + 1 },
      () => diagnostic,
    ),
    reruns: [],
    costs: { scopes: [], writes: [] },
  });
  assert.equal(
    envelope.diagnostics.length,
    SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
  );
  assert.equal(
    envelope.diagnostics[0].code.length,
    SOLID_DIAGNOSTICS_DEBUG_MAX_NAME_LENGTH,
  );
  assert.equal(envelope.truncated, true);
  assert.throws(
    () =>
      createSolidDiagnosticsDebugEnvelope({
        capturedAt: "invalid",
        durationMilliseconds: 0,
        diagnostics: [],
        reruns: [],
        costs: { scopes: [], writes: [] },
      }),
    /canonical UTC/u,
  );
  assert.throws(
    () =>
      createSolidDiagnosticsDebugEnvelope({
        capturedAt: "2026-08-27T00:00:00.000Z",
        durationMilliseconds: 0,
        diagnostics: [{ ...diagnostic, severity: "info" }],
        reruns: [],
        costs: { scopes: [], writes: [] },
      }),
    /severity is invalid/u,
  );
  assert.throws(
    () =>
      createSolidDiagnosticsDebugEnvelope({
        capturedAt: "9999-99-99T99:99:99.999Z",
        durationMilliseconds: 0,
        diagnostics: [],
        reruns: [],
        costs: { scopes: [], writes: [] },
      }),
    /canonical UTC/u,
  );
  assert.throws(
    () =>
      parseSolidDiagnosticsDebugEnvelope({
        ...envelope,
        privateValue: "must-not-cross-boundary",
      }),
    /unknown property/u,
  );
  assert.throws(
    () =>
      parseSolidDiagnosticsDebugEnvelope({
        ...envelope,
        diagnostics: [
          {
            sequence: 1,
            code: "X",
            kind: "perf",
            severity: "warn",
            message: "must-not-cross-boundary",
          },
        ],
      }),
    /unknown property/u,
  );
  assert.throws(
    () => serializeSolidDiagnosticsDebugEnvelope({ ...envelope, secret: 1 }),
    /unknown property/u,
  );
  assert.throws(
    () =>
      parseSolidDiagnosticsDebugEnvelope({
        ...envelope,
        truncated: false,
        droppedDiagnostics: 1,
      }),
    /truncation state is inconsistent/u,
  );
  const envelopeWithCause = createSolidDiagnosticsDebugEnvelope({
    capturedAt: "2026-08-27T00:00:00.000Z",
    durationMilliseconds: 1,
    diagnostics: [],
    reruns: [
      {
        run: 1,
        nodeRuns: 1,
        nodeKind: "effect",
        nodeName: "counter.output",
        causes: [{ seq: 1, kind: "write", name: "counter" }],
        depCount: 1,
        depsAdded: ["counter"],
        depsRemoved: [],
        selfMs: 0.1,
        totalMs: 0.1,
        changed: true,
        phase: "plain",
        held: false,
      },
    ],
    costs: { scopes: [], writes: [] },
  });
  assert.throws(
    () =>
      parseSolidDiagnosticsDebugEnvelope({
        ...envelopeWithCause,
        reruns: [
          {
            ...envelopeWithCause.reruns[0],
            causes: [{ ...envelopeWithCause.reruns[0].causes[0], causes: [] }],
          },
        ],
      }),
    /causes must be omitted when empty/u,
  );
});

test("emits deterministic causal operation records", () => {
  const records = [];
  const times = [10, 11, 15, 20];
  let nextId = 0;
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    clock: () => times.shift(),
    createOperationId: () => `test-${++nextId}`,
  });

  const event = telemetry.startOperation("solid-native.event", {
    attributes: { "event.name": "press" },
  });
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [event, event],
    attributes: { "commit.sequence": 2 },
  });
  telemetry.finishOperation(commit);
  telemetry.finishOperation(commit);
  telemetry.finishOperation(event, { status: "cancelled" });

  assert.equal(records.length, 4);
  assert.ok(
    records.every(
      (record) => record.protocolVersion === OBSERVABILITY_PROTOCOL_VERSION,
    ),
  );
  assert.deepEqual(records[1].causes, [event.id]);
  assert.equal(records[2].operationId, commit.id);
  assert.equal(records[2].duration, 4);
  assert.equal(records[3].status, "cancelled");
  assert.equal(records[3].duration, 10);
});

test("attaches immutable runtime and delivery identity to every record", () => {
  const records = [];
  const releaseFingerprint = `sha256:${"a".repeat(64)}`;
  const bundleFingerprint = `sha256:${"b".repeat(64)}`;
  const nativeCompatibilityFingerprint = `sha256:${"c".repeat(64)}`;
  const resource = {
    runtimeName: "react-native-fabric",
    runtimeVersion: "0.87.0",
    hostContractVersion: 1,
    platform: "android",
    buildFingerprint: "ci/482:aarch64",
    release: "com.example.app@2.4.0+482",
    updateFingerprint: "sha256:0123abcd",
    releaseChannel: "production",
    sourceRevision: "0123456789abcdef0123456789abcdef01234567",
    releaseFingerprint,
    bundleFingerprint,
    nativeCompatibilityFingerprint,
    releaseSignerKeyId: "production-2026-08",
    releaseInputsVerified: true,
  };
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    resource,
  });

  resource.runtimeVersion = "spoofed-after-creation";
  resource.releaseFingerprint = `sha256:${"d".repeat(64)}`;
  resource.releaseInputsVerified = false;
  const event = telemetry.startOperation("solid-native.event", {
    attributes: {
      "resource.runtime.version": "spoofed-by-operation",
      "resource.release.fingerprint": "spoofed-by-operation",
      "resource.release.inputs_verified": false,
    },
  });
  telemetry.finishOperation(event, {
    attributes: { "resource.release": "spoofed-by-finish" },
  });

  const expected = {
    "resource.runtime.name": "react-native-fabric",
    "resource.runtime.version": "0.87.0",
    "resource.runtime.host_contract_version": 1,
    "resource.platform": "android",
    "resource.build.fingerprint": "ci/482:aarch64",
    "resource.release": "com.example.app@2.4.0+482",
    "resource.update.fingerprint": "sha256:0123abcd",
    "resource.release.channel": "production",
    "resource.source.revision": "0123456789abcdef0123456789abcdef01234567",
    "resource.release.fingerprint": releaseFingerprint,
    "resource.bundle.fingerprint": bundleFingerprint,
    "resource.native.compatibility_fingerprint": nativeCompatibilityFingerprint,
    "resource.release.signing_key_id": "production-2026-08",
    "resource.release.inputs_verified": true,
  };
  assert.deepEqual(records[0].attributes, expected);
  assert.deepEqual(records[1].attributes, expected);
});

test("binds one input-verified release identity to every record", () => {
  const records = [];
  const authorizedRelease = {
    schemaVersion: 0,
    projectName: "solid-native-app",
    platform: "ios",
    release: "2.4.0+482",
    channel: "production",
    sourceRevision: "0123456789abcdef0123456789abcdef01234567",
    releaseFingerprint: `sha256:${"a".repeat(64)}`,
    bundleFingerprint: `sha256:${"b".repeat(64)}`,
    nativeCompatibilityFingerprint: `sha256:${"c".repeat(64)}`,
    artifactSha256: "d".repeat(64),
    authenticatedKeyId: "production-2026-08",
    inputsVerified: true,
    trustPolicyFingerprint: `sha256:${"e".repeat(64)}`,
    trustPolicySequence: 7,
  };
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    resource: {
      runtimeName: "react-native-fabric",
      runtimeVersion: "0.87.0",
      hostContractVersion: 1,
      platform: "ios",
      buildFingerprint: "ci/482:arm64",
      updateFingerprint: "sha256:0123abcd",
    },
    authorizedRelease,
  });

  authorizedRelease.release = "spoofed-after-creation";
  authorizedRelease.artifactSha256 = "f".repeat(64);
  authorizedRelease.inputsVerified = false;
  const event = telemetry.startOperation("solid-native.event", {
    attributes: {
      "resource.release": "spoofed-by-operation",
      "resource.release.artifact_sha256": "f".repeat(64),
      "resource.release.inputs_verified": false,
    },
  });
  telemetry.finishOperation(event, {
    attributes: {
      "resource.release.trust_policy_sequence": 99,
    },
  });

  const expected = {
    "resource.runtime.name": "react-native-fabric",
    "resource.runtime.version": "0.87.0",
    "resource.runtime.host_contract_version": 1,
    "resource.platform": "ios",
    "resource.build.fingerprint": "ci/482:arm64",
    "resource.update.fingerprint": "sha256:0123abcd",
    "resource.release.project_name": "solid-native-app",
    "resource.release": "2.4.0+482",
    "resource.release.channel": "production",
    "resource.source.revision": "0123456789abcdef0123456789abcdef01234567",
    "resource.release.fingerprint": `sha256:${"a".repeat(64)}`,
    "resource.bundle.fingerprint": `sha256:${"b".repeat(64)}`,
    "resource.native.compatibility_fingerprint": `sha256:${"c".repeat(64)}`,
    "resource.release.artifact_sha256": "d".repeat(64),
    "resource.release.signing_key_id": "production-2026-08",
    "resource.release.inputs_verified": true,
    "resource.release.trust_policy_fingerprint": `sha256:${"e".repeat(64)}`,
    "resource.release.trust_policy_sequence": 7,
  };
  assert.deepEqual(records[0].attributes, expected);
  assert.deepEqual(records[1].attributes, expected);
});

test("fails closed for incomplete or ambiguous authorized release identity", () => {
  const authorizedRelease = {
    schemaVersion: 0,
    projectName: "solid-native-app",
    platform: "android",
    release: "2.4.0+482",
    channel: "production",
    sourceRevision: "0123456789abcdef0123456789abcdef01234567",
    releaseFingerprint: `sha256:${"a".repeat(64)}`,
    bundleFingerprint: `sha256:${"b".repeat(64)}`,
    nativeCompatibilityFingerprint: `sha256:${"c".repeat(64)}`,
    artifactSha256: "d".repeat(64),
    authenticatedKeyId: "production-2026-08",
    inputsVerified: true,
  };

  assert.throws(
    () =>
      createCausalTelemetry({
        sink() {},
        authorizedRelease: { ...authorizedRelease, inputsVerified: false },
      }),
    /verified bundle and native artifact inputs/u,
  );
  assert.throws(
    () =>
      createCausalTelemetry({
        sink() {},
        authorizedRelease: { ...authorizedRelease, unexpected: true },
      }),
    /exact verifier output schema/u,
  );
  const missingRelease = { ...authorizedRelease };
  delete missingRelease.release;
  assert.throws(
    () =>
      createCausalTelemetry({
        sink() {},
        authorizedRelease: missingRelease,
      }),
    /exact verifier output schema/u,
  );
  for (const [field, value] of [
    ["schemaVersion", 1],
    ["projectName", "unsafe\nproject"],
    ["platform", "web"],
    ["release", "release with spaces"],
    ["channel", "production channel"],
    ["sourceRevision", "ABCDEF0"],
    ["releaseFingerprint", "sha256:0123abcd"],
    ["bundleFingerprint", `sha256:${"g".repeat(64)}`],
    ["nativeCompatibilityFingerprint", `sha256:${"c".repeat(63)}`],
    ["artifactSha256", "d".repeat(63)],
    ["authenticatedKeyId", "unsafe key id"],
  ]) {
    assert.throws(
      () =>
        createCausalTelemetry({
          sink() {},
          authorizedRelease: { ...authorizedRelease, [field]: value },
        }),
      /Telemetry authorizedRelease/u,
    );
  }
  assert.throws(
    () =>
      createCausalTelemetry({
        sink() {},
        authorizedRelease: {
          ...authorizedRelease,
          trustPolicyFingerprint: `sha256:${"e".repeat(64)}`,
        },
      }),
    /fingerprint and sequence must be supplied together/u,
  );
  assert.throws(
    () =>
      createCausalTelemetry({
        sink() {},
        authorizedRelease: {
          ...authorizedRelease,
          trustPolicyFingerprint: `sha256:${"e".repeat(64)}`,
          trustPolicySequence: 0,
        },
      }),
    /trustPolicySequence must be a positive safe integer/u,
  );
  assert.throws(
    () =>
      createCausalTelemetry({
        sink() {},
        resource: { release: authorizedRelease.release },
        authorizedRelease,
      }),
    /release cannot be supplied with authorizedRelease/u,
  );
  assert.throws(
    () =>
      createCausalTelemetry({
        sink() {},
        resource: { platform: "ios" },
        authorizedRelease,
      }),
    /platform must match authorizedRelease platform/u,
  );
});

test("rejects malformed causal telemetry resource identity", () => {
  for (const [field, value] of [
    ["runtimeName", ""],
    ["runtimeVersion", "contains spaces"],
    ["platform", "android#debug"],
    ["buildFingerprint", "a".repeat(129)],
    ["release", null],
  ]) {
    assert.throws(
      () =>
        createCausalTelemetry({
          sink() {},
          resource: { [field]: value },
        }),
      /static identifier/,
    );
  }
  for (const [field, value] of [
    ["releaseChannel", "production channel"],
    ["sourceRevision", "ABCDEF0"],
    ["releaseFingerprint", "sha256:0123abcd"],
    ["bundleFingerprint", `sha256:${"g".repeat(64)}`],
    ["nativeCompatibilityFingerprint", `sha256:${"a".repeat(63)}`],
    ["releaseSignerKeyId", "unsafe key id"],
  ]) {
    assert.throws(
      () =>
        createCausalTelemetry({
          sink() {},
          resource: { [field]: value },
        }),
      /Telemetry resource/u,
    );
  }
  for (const hostContractVersion of [-1, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        createCausalTelemetry({
          sink() {},
          resource: { hostContractVersion },
        }),
      /non-negative safe integer/,
    );
  }
  for (const releaseInputsVerified of [null, 0, "true"]) {
    assert.throws(
      () =>
        createCausalTelemetry({
          sink() {},
          resource: { releaseInputsVerified },
        }),
      /releaseInputsVerified must be a boolean/u,
    );
  }
});

test("samples complete causal sessions before renderer instrumentation", () => {
  let randomCalls = 0;
  const never = createSampledCausalTelemetry({
    sink() {
      throw new Error("a rejected session must not emit");
    },
    sampleRate: 0,
    random() {
      randomCalls++;
      return 0;
    },
  });
  assert.equal(never, undefined);
  assert.equal(randomCalls, 0);

  const records = [];
  const always = createSampledCausalTelemetry({
    sink: (record) => records.push(record),
    sampleRate: 1,
    random() {
      randomCalls++;
      return 0.999;
    },
  });
  assert.notEqual(always, undefined);
  const operation = always.startOperation("solid-native.surface");
  always.finishOperation(operation);
  assert.equal(records.length, 2);
  assert.equal(randomCalls, 0);

  assert.equal(
    createSampledCausalTelemetry({
      sink() {},
      sampleRate: 0.25,
      random: () => 0.25,
    }),
    undefined,
  );
  assert.notEqual(
    createSampledCausalTelemetry({
      sink() {},
      sampleRate: 0.25,
      random: () => 0.249,
    }),
    undefined,
  );
});

test("rejects invalid causal session sampling configuration", () => {
  for (const sampleRate of [-0.1, 1.1, Number.NaN]) {
    assert.throws(
      () => createSampledCausalTelemetry({ sink() {}, sampleRate }),
      /sampleRate must be between 0 and 1/,
    );
  }
  for (const decision of [-0.1, 1, Number.NaN]) {
    assert.throws(
      () =>
        createSampledCausalTelemetry({
          sink() {},
          sampleRate: 0.5,
          random: () => decision,
        }),
      /random source must return/,
    );
  }
  assert.throws(
    () =>
      createSampledCausalTelemetry({
        sink() {},
        sampleRate: 0,
        resource: { runtimeName: "invalid runtime" },
      }),
    /static identifier/,
  );
});

test("isolates telemetry sink and error-reporter failures", async () => {
  let sinkErrors = 0;
  let diagnosticRejections = 0;
  const telemetry = createCausalTelemetry({
    sink() {
      throw new Error("sink unavailable");
    },
    onSinkError() {
      sinkErrors++;
      if (sinkErrors === 1) throw new Error("error reporter unavailable");
      return {
        then(_resolve, reject) {
          diagnosticRejections++;
          reject(new Error("async error reporter unavailable"));
        },
      };
    },
  });

  const operation = telemetry.startOperation("solid-native.surface");
  telemetry.finishOperation(operation);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sinkErrors, 2);
  assert.equal(diagnosticRejections, 1);
});

test("accepts backend timestamps and monotonic durations", () => {
  const records = [];
  const telemetry = createCausalTelemetry({
    sink: (record) => records.push(record),
    clock: () => {
      throw new Error("backend timing should bypass the session clock");
    },
    createOperationId: () => "mount-operation",
  });

  const mount = telemetry.startOperation("solid-native.mount", {
    timestamp: 1_000,
  });
  telemetry.finishOperation(mount, {
    timestamp: 1_004,
    duration: 3.5,
  });

  assert.equal(records[0].timestamp, 1_000);
  assert.equal(records[1].timestamp, 1_004);
  assert.equal(records[1].duration, 3.5);
});

test("retains a bounded and isolated local causal timeline", () => {
  const timeline = createCausalTimeline({ capacity: 2 });
  let nextId = 0;
  const telemetry = createCausalTelemetry({
    sink: timeline.sink,
    clock: (() => {
      let now = 0;
      return () => ++now;
    })(),
    createOperationId: () => `timeline-${++nextId}`,
  });

  const surface = telemetry.startOperation("solid-native.surface");
  telemetry.finishOperation(surface);
  const event = telemetry.startOperation("solid-native.event");
  telemetry.finishOperation(event);
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [event],
    attributes: { "commit.sequence": 2 },
  });
  telemetry.finishOperation(commit);

  const snapshot = timeline.snapshot();
  assert.deepEqual(
    snapshot.operations.map((operation) => operation.operationId),
    [event.id, commit.id],
  );
  assert.deepEqual(snapshot.operations[1].causes, [event.id]);
  assert.equal(snapshot.activeOperationCount, 0);
  assert.equal(snapshot.evictedOperationCount, 1);
  assert.equal(snapshot.discardedRecordCount, 0);

  snapshot.operations[1].startAttributes["mutated.by.consumer"] = true;
  assert.equal(
    timeline.snapshot().operations[1].startAttributes["mutated.by.consumer"],
    undefined,
  );

  timeline.clear();
  assert.deepEqual(timeline.snapshot(), {
    operations: [],
    activeOperationCount: 0,
    evictedOperationCount: 0,
    discardedRecordCount: 0,
  });
  assert.throws(
    () => createCausalTimeline({ capacity: 0 }),
    /positive integer/,
  );
});

test("explains retained causes and consequences for a local debugger", () => {
  const timeline = createCausalTimeline({ capacity: 8 });
  let nextId = 0;
  let now = 100;
  const telemetry = createCausalTelemetry({
    sink: timeline.sink,
    clock: () => ++now,
    createOperationId: () => `explain-${++nextId}`,
  });

  const event = telemetry.startOperation("solid-native.event", {
    causes: [{ id: "server-action-not-retained" }],
    attributes: { "event.name": "submit" },
  });
  const computation = telemetry.startOperation("solid-native.computation", {
    causes: [event],
    attributes: { "computation.name": "profile.output" },
  });
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [event, computation],
    attributes: { "commit.sequence": 4 },
  });
  const mount = telemetry.startOperation("solid-native.mount", {
    causes: [commit, { id: "native-context-not-retained" }],
  });
  const frame = telemetry.startOperation("solid-native.frame", {
    causes: [mount],
  });
  telemetry.finishOperation(frame);
  telemetry.finishOperation(mount);
  telemetry.finishOperation(commit);
  telemetry.finishOperation(computation);
  telemetry.finishOperation(event);

  const explanation = timeline.explain(commit.id);
  assert.equal(explanation.target.operationId, commit.id);
  assert.deepEqual(
    explanation.ancestors.map((operation) => operation.operationId),
    [event.id, computation.id],
  );
  assert.deepEqual(
    explanation.descendants.map((operation) => operation.operationId),
    [mount.id, frame.id],
  );
  assert.deepEqual(explanation.unresolvedCauseIds, [
    "server-action-not-retained",
    "native-context-not-retained",
  ]);

  const eventExplanation = timeline.explain(event.id);
  assert.deepEqual(
    eventExplanation.descendants.map((operation) => operation.operationId),
    [computation.id, commit.id, mount.id, frame.id],
  );
  assert.equal(timeline.explain("unknown-operation"), undefined);

  const detachedExplanation = explainCausalTimelineSnapshot(
    timeline.snapshot(),
    commit.id,
  );
  assert.deepEqual(
    detachedExplanation.ancestors.map((operation) => operation.operationId),
    [event.id, computation.id],
  );
  detachedExplanation.target.startAttributes["mutated.by.detached-debugger"] =
    true;
  assert.equal(
    timeline.snapshot().operations[2].startAttributes[
      "mutated.by.detached-debugger"
    ],
    undefined,
  );

  explanation.target.startAttributes["mutated.by.debugger"] = true;
  assert.equal(
    timeline.explain(commit.id).target.startAttributes["mutated.by.debugger"],
    undefined,
  );
});

test("groups retained causal components without inventing a distributed trace ID", () => {
  const timeline = createCausalTimeline({ capacity: 10 });
  let nextId = 0;
  let now = 100;
  const telemetry = createCausalTelemetry({
    sink: timeline.sink,
    clock: () => ++now,
    createOperationId: () => `group-${++nextId}`,
  });

  const externalCause = { id: "server-action-not-retained" };
  const event = telemetry.startOperation("solid-native.event", {
    causes: [externalCause],
  });
  const computation = telemetry.startOperation("solid-native.computation", {
    causes: [event],
  });
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [event, computation],
  });
  const mount = telemetry.startOperation("solid-native.mount", {
    causes: [commit],
  });
  const task = telemetry.startOperation("solid-native.task", {
    causes: [externalCause],
  });
  telemetry.finishOperation(task);
  telemetry.finishOperation(commit, { status: "error" });
  telemetry.finishOperation(computation);
  telemetry.finishOperation(event);
  const surface = telemetry.startOperation("solid-native.surface");
  telemetry.finishOperation(surface, { status: "cancelled" });

  const groups = groupCausalTimelineSnapshot(timeline.snapshot());
  assert.equal(groups.length, 2);
  assert.equal(groups[0].groupId, event.id);
  assert.deepEqual(
    groups[0].operations.map((operation) => operation.operationId),
    [event.id, computation.id, commit.id, mount.id, task.id],
  );
  assert.deepEqual(groups[0].entryOperationIds, [event.id, task.id]);
  assert.deepEqual(groups[0].terminalOperationIds, [mount.id, task.id]);
  assert.deepEqual(groups[0].unresolvedCauseIds, [externalCause.id]);
  assert.equal(groups[0].activeOperationCount, 1);
  assert.equal(groups[0].errorOperationCount, 1);
  assert.equal(groups[0].cancelledOperationCount, 0);
  assert.equal(groups[0].finishedAt, undefined);
  assert.equal(groups[0].duration, undefined);

  assert.equal(groups[1].groupId, surface.id);
  assert.deepEqual(groups[1].entryOperationIds, [surface.id]);
  assert.deepEqual(groups[1].terminalOperationIds, [surface.id]);
  assert.equal(groups[1].activeOperationCount, 0);
  assert.equal(groups[1].cancelledOperationCount, 1);
  assert.equal(groups[1].duration, 1);

  groups[0].operations[0].startAttributes["mutated.by.group-view"] = true;
  assert.equal(
    timeline.snapshot().operations[0].startAttributes["mutated.by.group-view"],
    undefined,
  );
  timeline.clear();
  assert.deepEqual(groupCausalTimelineSnapshot(timeline.snapshot()), []);
});

test("hands a bounded causal snapshot from a native runtime to a debugger", () => {
  const timeline = createCausalTimeline({ capacity: 4 });
  let nextId = 0;
  const telemetry = createCausalTelemetry({
    sink: timeline.sink,
    clock: (() => {
      let now = 200;
      return () => ++now;
    })(),
    createOperationId: () => `handoff-${++nextId}`,
  });

  const event = telemetry.startOperation("solid-native.event", {
    attributes: { "event.name": "press" },
  });
  telemetry.finishOperation(event);
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [event],
    attributes: { "commit.sequence": 7 },
  });

  const source = timeline.snapshot();
  const handoff = createCausalDebugSnapshot(source, { capturedAt: 500 });
  assert.equal(handoff.kind, CAUSAL_DEBUG_SNAPSHOT_KIND);
  assert.equal(handoff.schemaVersion, CAUSAL_DEBUG_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(handoff.capturedAt, 500);
  assert.equal(handoff.activeOperationCount, 1);
  assert.ok(Object.isFrozen(handoff));
  assert.ok(Object.isFrozen(handoff.operations));
  assert.ok(Object.isFrozen(handoff.operations[0]));
  assert.ok(Object.isFrozen(handoff.operations[0].causes));
  assert.ok(Object.isFrozen(handoff.operations[0].startAttributes));
  assert.ok(Object.isFrozen(handoff.operations[0].finishAttributes));

  source.operations[0].startAttributes["mutated.after.handoff"] = true;
  assert.equal(
    handoff.operations[0].startAttributes["mutated.after.handoff"],
    undefined,
  );

  const received = parseCausalDebugSnapshot(
    JSON.parse(JSON.stringify(handoff)),
  );
  assert.deepEqual(received, handoff);
  const explanation = explainCausalTimelineSnapshot(received, commit.id);
  assert.deepEqual(
    explanation.ancestors.map((operation) => operation.operationId),
    [event.id],
  );

  const json = () => JSON.parse(JSON.stringify(handoff));
  assert.throws(
    () => parseCausalDebugSnapshot({ ...json(), unexpected: true }),
    /unknown field/,
  );

  const duplicateId = json();
  duplicateId.operations[1].operationId = duplicateId.operations[0].operationId;
  assert.throws(
    () => parseCausalDebugSnapshot(duplicateId),
    /duplicate operation IDs/,
  );

  const wrongActiveCount = json();
  wrongActiveCount.activeOperationCount = 0;
  assert.throws(
    () => parseCausalDebugSnapshot(wrongActiveCount),
    /activeOperationCount does not match/,
  );

  const partialFinish = json();
  delete partialFinish.operations[0].finishAttributes;
  assert.throws(
    () => parseCausalDebugSnapshot(partialFinish),
    /missing field "finishAttributes"/,
  );

  const unknownOperation = json();
  unknownOperation.operations[0].name = "solid-native.future";
  assert.throws(
    () => parseCausalDebugSnapshot(unknownOperation),
    /not a supported causal operation name/,
  );

  const invalidAttribute = json();
  invalidAttribute.operations[0].startAttributes.value = Number.NaN;
  assert.throws(
    () => parseCausalDebugSnapshot(invalidAttribute),
    /must be a finite number/,
  );

  const duplicateCauses = json();
  duplicateCauses.operations[1].causes = [event.id, event.id];
  assert.throws(
    () => parseCausalDebugSnapshot(duplicateCauses),
    /must not contain duplicate cause IDs/,
  );

  const excessiveCauses = json();
  excessiveCauses.operations[1].causes = Array.from(
    { length: CAUSAL_DEBUG_SNAPSHOT_MAX_CAUSES + 1 },
    (_, index) => `external-${index}`,
  );
  assert.throws(
    () => parseCausalDebugSnapshot(excessiveCauses),
    /exceeds .* cause IDs/,
  );
});

test("fans telemetry out even when one exporter fails", async () => {
  const delivered = [];
  const failures = [];
  let diagnosticRejections = 0;
  const fanout = createCausalTelemetryFanout({
    sinks: [
      () => {
        throw new Error("first exporter failed");
      },
      (record) => delivered.push(record),
    ],
    onSinkError(failure) {
      failures.push(failure);
      return {
        then(_resolve, reject) {
          diagnosticRejections++;
          reject(new Error("fanout diagnostic failed"));
        },
      };
    },
  });
  const telemetry = createCausalTelemetry({ sink: fanout });

  const operation = telemetry.startOperation("solid-native.surface");
  telemetry.finishOperation(operation);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered.length, 2);
  assert.equal(failures.length, 2);
  assert.equal(diagnosticRejections, 2);
  assert.ok(failures.every((failure) => failure.sinkIndex === 0));
});

test("bounds error classification cardinality without recording messages", () => {
  const error = new Error("secret account data");
  error.name = "Tenant 42 failed";
  assert.deepEqual(telemetryErrorAttributes(error), { "error.type": "Error" });
  assert.equal(
    JSON.stringify(telemetryErrorAttributes(error)).includes(error.message),
    false,
  );
  assert.deepEqual(telemetryErrorAttributes(new TypeError("ignored")), {
    "error.type": "TypeError",
  });
});

test("exports causal operations through the dependency-free OpenTelemetry boundary", () => {
  const tracer = fakeOpenTelemetry();
  const exporter = createOpenTelemetryCausalExporter({
    tracer,
    maxCauseIds: 1,
  });
  let nextId = 0;
  const telemetry = createCausalTelemetry({
    sink: exporter.sink,
    clock: (() => {
      let time = 2_000;
      return () => (time += 5);
    })(),
    createOperationId: () => `otel-${++nextId}`,
  });

  const event = telemetry.startOperation("solid-native.event", {
    attributes: { "event.name": "press" },
  });
  const command = telemetry.startOperation("solid-native.command");
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [event, command],
    attributes: { "commit.sequence": 8, operation_id: "spoofed" },
  });
  telemetry.finishOperation(commit, {
    status: "error",
    attributes: { "error.type": "InvariantError" },
    timestamp: 2_025,
    duration: 3.5,
  });

  assert.equal(tracer.spans.length, 3);
  assert.deepEqual(tracer.spans[2].options, {
    startTime: 2_015,
    attributes: {
      "solid_native.protocol_version": 0,
      "solid_native.operation_id": commit.id,
      "solid_native.commit.sequence": 8,
      "solid_native.cause_count": 2,
      "solid_native.cause_ids": JSON.stringify([event.id]),
      "solid_native.cause_ids_truncated": 1,
    },
  });
  assert.equal(tracer.spans[2].attributes["solid_native.duration_ms"], 3.5);
  assert.equal(
    tracer.spans[2].attributes["solid_native.error.type"],
    "InvariantError",
  );
  assert.equal(tracer.spans[2].attributes["solid_native.outcome"], "error");
  assert.deepEqual(tracer.spans[2].status, { code: 2, message: "error" });
  assert.equal(tracer.spans[2].endedAt, 2_025);
  assert.deepEqual(exporter.snapshot(), {
    activeSpanCount: 2,
    startedSpanCount: 3,
    finishedSpanCount: 1,
    droppedStartCount: 0,
    duplicateStartCount: 0,
    orphanedFinishCount: 0,
    truncatedCauseCount: 1,
  });

  exporter.close(2_030);
  assert.equal(exporter.snapshot().activeSpanCount, 0);
  assert.equal(exporter.snapshot().finishedSpanCount, 3);
  assert.ok(
    tracer.spans
      .slice(0, 2)
      .every(
        (span) =>
          span.endedAt === 2_030 &&
          span.status === undefined &&
          span.attributes["solid_native.exporter_closed"] === true &&
          span.attributes["solid_native.outcome"] === "cancelled",
      ),
  );
});

test("bounds OpenTelemetry spans and reports malformed record flow", () => {
  const tracer = fakeOpenTelemetry();
  const exporter = createOpenTelemetryCausalExporter({
    tracer,
    maxActiveSpans: 1,
  });
  const started = {
    protocolVersion: 0,
    type: "operation-started",
    operationId: "one",
    name: "solid-native.surface",
    timestamp: 10,
    causes: [],
    attributes: {},
  };
  exporter.sink(started);
  exporter.sink(started);
  exporter.sink({ ...started, operationId: "two" });
  exporter.sink({
    protocolVersion: 0,
    type: "operation-finished",
    operationId: "missing",
    name: "solid-native.surface",
    timestamp: 12,
    duration: 2,
    status: "ok",
    attributes: {},
  });

  assert.deepEqual(exporter.snapshot(), {
    activeSpanCount: 1,
    startedSpanCount: 1,
    finishedSpanCount: 0,
    droppedStartCount: 1,
    duplicateStartCount: 1,
    orphanedFinishCount: 1,
    truncatedCauseCount: 0,
  });
  assert.throws(
    () => createOpenTelemetryCausalExporter({ tracer, maxActiveSpans: 0 }),
    /positive integer/u,
  );
  assert.throws(
    () => createOpenTelemetryCausalExporter({ tracer, maxCauseIds: -1 }),
    /non-negative integer/u,
  );
  assert.throws(
    () =>
      createOpenTelemetryCausalExporter({
        tracer,
        attributePrefix: "bad prefix",
      }),
    /attributePrefix/u,
  );
  assert.throws(() => exporter.close(Number.NaN), /must be finite/u);
});

test("exports causal operations through the dependency-free Sentry span boundary", () => {
  const sentry = fakeSentry();
  const exporter = createSentryCausalExporter({ sentry, maxCauseIds: 1 });
  const records = [];
  let nextId = 0;
  const telemetry = createCausalTelemetry({
    sink(record) {
      records.push(record);
      exporter.sink(record);
    },
    clock: (() => {
      let time = 1_000;
      return () => (time += 5);
    })(),
    createOperationId: () => `sentry-${++nextId}`,
  });

  const event = telemetry.startOperation("solid-native.event", {
    attributes: { "event.name": "press" },
  });
  const command = telemetry.startOperation("solid-native.command");
  const commit = telemetry.startOperation("solid-native.commit", {
    causes: [event, command],
    attributes: { "commit.sequence": 7, operation_id: "spoofed" },
  });
  telemetry.finishOperation(commit, {
    status: "error",
    attributes: { "error.type": "InvariantError" },
    timestamp: 1_025,
    duration: 2.5,
  });

  assert.equal(records.length, 4);
  assert.equal(sentry.spans.length, 3);
  assert.deepEqual(sentry.spans[2].options, {
    name: "solid-native.commit",
    op: "ui.render",
    startTime: 1.015,
    attributes: {
      "sentry.origin": "auto.solid_native",
      "solid_native.protocol_version": 0,
      "solid_native.operation_id": commit.id,
      "solid_native.commit.sequence": 7,
      "solid_native.cause_count": 2,
      "solid_native.cause_ids": JSON.stringify([event.id]),
      "solid_native.cause_ids_truncated": 1,
    },
  });
  assert.equal(sentry.spans[2].attributes["solid_native.duration_ms"], 2.5);
  assert.equal(
    sentry.spans[2].attributes["solid_native.error.type"],
    "InvariantError",
  );
  assert.equal(sentry.spans[2].attributes["solid_native.outcome"], "error");
  assert.deepEqual(sentry.spans[2].status, { code: 2, message: "error" });
  assert.equal(sentry.spans[2].endedAt, 1.025);
  assert.deepEqual(exporter.snapshot(), {
    activeSpanCount: 2,
    startedSpanCount: 3,
    finishedSpanCount: 1,
    droppedStartCount: 0,
    duplicateStartCount: 0,
    orphanedFinishCount: 0,
    truncatedCauseCount: 1,
  });

  exporter.close(1_030);
  assert.equal(exporter.snapshot().activeSpanCount, 0);
  assert.equal(exporter.snapshot().finishedSpanCount, 3);
  assert.ok(
    sentry.spans
      .slice(0, 2)
      .every(
        (span) =>
          span.endedAt === 1.03 &&
          span.attributes["solid_native.exporter_closed"] === true &&
          span.attributes["solid_native.outcome"] === "cancelled",
      ),
  );
});

test("maps explicit background tasks to Sentry task spans", () => {
  const sentry = fakeSentry();
  const exporter = createSentryCausalExporter({ sentry });
  const telemetry = createCausalTelemetry({ sink: exporter.sink });
  const task = telemetry.startOperation("solid-native.task", {
    attributes: { "task.name": "profile.refresh" },
  });
  telemetry.finishOperation(task);

  assert.equal(sentry.spans.length, 1);
  assert.equal(sentry.spans[0].options.op, "task");
  assert.equal(
    sentry.spans[0].options.attributes["solid_native.task.name"],
    "profile.refresh",
  );
  assert.equal(sentry.spans[0].attributes["solid_native.outcome"], "ok");
});

test("maps selected Solid owners to Sentry component spans", () => {
  const sentry = fakeSentry();
  const exporter = createSentryCausalExporter({ sentry });
  const telemetry = createCausalTelemetry({ sink: exporter.sink });
  const owner = telemetry.startOperation("solid-native.owner", {
    attributes: { "owner.name": "profile.screen" },
  });
  telemetry.finishOperation(owner);

  assert.equal(sentry.spans.length, 1);
  assert.equal(sentry.spans[0].options.op, "ui.component");
  assert.equal(
    sentry.spans[0].options.attributes["solid_native.owner.name"],
    "profile.screen",
  );
});

test("maps selected Solid computations to Sentry computation spans", () => {
  const sentry = fakeSentry();
  const exporter = createSentryCausalExporter({ sentry });
  const telemetry = createCausalTelemetry({ sink: exporter.sink });
  const computation = telemetry.startOperation("solid-native.computation", {
    attributes: {
      "computation.kind": "native-output",
      "computation.name": "profile.status",
    },
  });
  telemetry.finishOperation(computation);

  assert.equal(sentry.spans.length, 1);
  assert.equal(sentry.spans[0].options.op, "ui.computation");
  assert.equal(
    sentry.spans[0].options.attributes["solid_native.computation.name"],
    "profile.status",
  );
});

test("bounds active Sentry spans and reports malformed record flow", () => {
  const sentry = fakeSentry();
  const exporter = createSentryCausalExporter({
    sentry,
    maxActiveSpans: 1,
  });
  const started = {
    protocolVersion: 0,
    type: "operation-started",
    operationId: "one",
    name: "solid-native.surface",
    timestamp: 10,
    causes: [],
    attributes: {},
  };
  exporter.sink(started);
  exporter.sink(started);
  exporter.sink({ ...started, operationId: "two" });
  exporter.sink({
    protocolVersion: 0,
    type: "operation-finished",
    operationId: "missing",
    name: "solid-native.surface",
    timestamp: 12,
    duration: 2,
    status: "ok",
    attributes: {},
  });

  assert.deepEqual(exporter.snapshot(), {
    activeSpanCount: 1,
    startedSpanCount: 1,
    finishedSpanCount: 0,
    droppedStartCount: 1,
    duplicateStartCount: 1,
    orphanedFinishCount: 1,
    truncatedCauseCount: 0,
  });
  assert.throws(
    () => createSentryCausalExporter({ sentry, maxActiveSpans: 0 }),
    /positive integer/u,
  );
  assert.throws(
    () => createSentryCausalExporter({ sentry, maxCauseIds: -1 }),
    /non-negative integer/u,
  );
  assert.throws(
    () => createSentryCausalExporter({ sentry, attributePrefix: "bad prefix" }),
    /attributePrefix/u,
  );
  assert.throws(() => exporter.close(Number.NaN), /must be finite/u);
});
