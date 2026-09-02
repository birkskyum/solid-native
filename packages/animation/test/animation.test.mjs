import assert from "node:assert/strict";
import test from "node:test";
import { createRoot, createSignal, flush } from "solid-js";
import { createElement, mount } from "@solid-native/renderer";
import { createNativeFabricHost } from "@solid-native/fabric-host";

import {
  UI_WORKLET_MAX_EXPRESSION_DEPTH,
  UI_WORKLET_MAX_DECAY_DURATION_MS,
  UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES,
  UI_WORKLET_MAX_SPRING_DURATION_MS,
  UI_WORKLET_MAX_TIMING_DURATION_MS,
  UI_WORKLET_MAX_TIMING_KEYFRAMES,
  UI_WORKLET_PROTOCOL_VERSION,
  createInMemoryUIWorkletHost,
  createUIWorkletGraph,
  createUIWorkletSession,
  evaluateUIWorkletDecay,
  evaluateUIWorkletGraph,
  evaluateUIWorkletSpring,
  evaluateUIWorkletTimingProgress,
  parseUIWorkletGraph,
  parseUIWorkletDecay,
  parseUIWorkletPanGesture,
  parseUIWorkletSpring,
  parseUIWorkletTiming,
} from "../dist/index.js";
import {
  createOwnedUIWorkletSession,
  createSolidUIWorklet,
} from "../dist/solid.js";
import { createNativeBindingUIWorkletHost } from "../dist/react-native.js";
import { createNativeViewAnimation } from "../dist/native.js";

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${String(actual)} to be within ${String(tolerance)} of ${String(expected)}.`,
  );
}

function animationGraph() {
  return {
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    inputs: [
      { name: "progress", initialValue: 0 },
      { name: "translationX", initialValue: 0 },
    ],
    outputs: [
      {
        name: "opacity",
        expression: {
          kind: "interpolate",
          value: { kind: "input", name: "progress" },
          inputRange: [0, 1],
          outputRange: [0.2, 1],
          extrapolate: "clamp",
        },
      },
      {
        name: "translateX",
        expression: {
          kind: "binary",
          operator: "multiply",
          left: { kind: "input", name: "translationX" },
          right: { kind: "constant", value: 2 },
        },
      },
      {
        name: "distance",
        expression: {
          kind: "abs",
          value: { kind: "input", name: "translationX" },
        },
      },
    ],
  };
}

function divisionGraph() {
  return createUIWorkletGraph({
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    inputs: [
      { name: "numerator", initialValue: 10 },
      { name: "denominator", initialValue: 2 },
    ],
    outputs: [
      {
        name: "ratio",
        expression: {
          kind: "binary",
          operator: "divide",
          left: { kind: "input", name: "numerator" },
          right: { kind: "input", name: "denominator" },
        },
      },
    ],
  });
}

test("validates, freezes, and deterministically evaluates numeric worklet graphs", () => {
  const source = animationGraph();
  const graph = parseUIWorkletGraph(source);
  source.inputs[0].initialValue = 99;
  source.outputs[0].expression.outputRange[1] = 100;

  assert.equal(graph.inputs[0].initialValue, 0);
  assert.deepEqual(graph.outputs[0].expression.outputRange, [0.2, 1]);
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.outputs), true);
  assert.equal(Object.isFrozen(graph.outputs[0].expression), true);
  assert.deepEqual(
    evaluateUIWorkletGraph(graph, {
      progress: 1.5,
      translationX: -12,
    }),
    { opacity: 1, translateX: -24, distance: 12 },
  );
  assert.deepEqual(
    evaluateUIWorkletGraph(graph, {
      progress: -1,
      translationX: 4,
    }),
    { opacity: 0.2, translateX: 8, distance: 4 },
  );
});

test("authors named worklet graphs without exposing the transport AST", () => {
  const graph = createUIWorkletGraph(
    { progress: 0, offset: -2 },
    (
      { progress, offset },
      {
        abs,
        add,
        clamp,
        constant,
        divide,
        interpolate,
        max,
        min,
        multiply,
        negate,
        subtract,
      },
    ) => ({
      opacity: interpolate(progress, [0, 1], [0.2, 1]),
      translateX: add(multiply(offset, 2), 4),
      absoluteOffset: abs(offset),
      inverseOffset: negate(offset),
      clampedOffset: clamp(offset, -1, 1),
      difference: subtract(progress, offset),
      ratio: divide(offset, 2),
      lower: min(offset, -3),
      upper: max(offset, -1),
      literal: constant(7),
      numericLiteral: 8,
    }),
  );

  assert.deepEqual(graph.inputs, [
    { name: "progress", initialValue: 0 },
    { name: "offset", initialValue: -2 },
  ]);
  assert.deepEqual(
    evaluateUIWorkletGraph(graph, { progress: 0.5, offset: 3 }),
    {
      opacity: 0.6000000000000001,
      translateX: 10,
      absoluteOffset: 3,
      inverseOffset: -3,
      clampedOffset: 1,
      difference: -2.5,
      ratio: 1.5,
      lower: -3,
      upper: 3,
      literal: 7,
      numericLiteral: 8,
    },
  );
  assert.equal(Object.isFrozen(graph), true);

  assert.throws(
    () => createUIWorkletGraph({ progress: 0 }, () => null),
    /defined outputs must be a plain object/,
  );
  assert.throws(
    () =>
      createUIWorkletGraph({ progress: 0 }, () => ({
        opacity: { kind: "input", name: "missing" },
      })),
    /undeclared worklet input/,
  );
});

test("binds one product animation ref after native mount and owns its lifetime", async () => {
  const calls = [];
  const committedNodes = new Set();
  let activeUIWorkletCount = 0;
  let ready = true;
  let surfaceSequence = 0;
  let workletSequence = 0;
  let timestamp;
  let progress = 0;
  const binding = {
    contractVersion: 1,
    backend: "react-native-fabric",
    backendVersion: "0.87.0",
    platform: "android",
    getSurfaceInfo() {
      return {
        ready,
        surface: ready ? 91 : 0,
        sequence: surfaceSequence,
        retainedNodeCount: committedNodes.size,
        retainedResourceCount: 0,
        activeUIWorkletCount,
        pendingUIWorkletFrameCount: 0,
      };
    },
    setEventHandler() {},
    measure(_node, afterSequence = 0) {
      return {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        pageX: 0,
        pageY: 0,
        observedSequence: afterSequence,
      };
    },
    retainNativeResource() {
      return 1;
    },
    releaseNativeResource() {},
    destroySurface() {
      ready = false;
    },
    commit(transaction) {
      surfaceSequence = transaction.sequence;
      for (const mutation of transaction.mutations) {
        if (
          mutation.type === "create-element" ||
          mutation.type === "create-text"
        ) {
          committedNodes.add(mutation.node);
        } else if (mutation.type === "delete-node") {
          committedNodes.delete(mutation.node);
        }
      }
      return {
        surface: transaction.surface,
        sequence: transaction.sequence,
        mounted: true,
      };
    },
    installUIWorklet(target, graph) {
      assert.equal(committedNodes.has(target), true);
      calls.push(["install", target, graph]);
      activeUIWorkletCount += 1;
      workletSequence = 1;
      progress = graph.inputs[0].initialValue;
      return 51;
    },
    updateUIWorkletInputs(handle, inputs, nextTimestamp) {
      calls.push(["update", handle, [...inputs], nextTimestamp]);
      progress = inputs[0];
      timestamp = nextTimestamp;
      workletSequence += 1;
    },
    destroyUIWorklet(handle) {
      calls.push(["destroy", handle]);
      activeUIWorkletCount -= 1;
    },
    getUIWorkletInfo(handle) {
      return {
        handle,
        target: calls[0][1],
        sequence: workletSequence,
        appliedSequence: workletSequence,
        applied: true,
        frameTimeNanoseconds: 1,
        ...(timestamp === undefined ? {} : { timestamp }),
        timingActive: false,
        timingProgress: 0,
        outputs: { opacity: progress },
      };
    },
  };
  const host = createNativeFabricHost({
    binding,
    descriptors: [
      {
        name: "RootView",
        acceptsRawText: false,
        bubblingEvents: [],
        directEvents: [],
        commands: {},
      },
      {
        name: "View",
        acceptsRawText: false,
        bubblingEvents: [],
        directEvents: [],
        commands: {},
      },
    ],
  });
  const graph = createUIWorkletGraph({ progress: 0 }, ({ progress }) => ({
    opacity: progress,
  }));
  let animation;
  let setProgress;
  const app = mount(
    () => {
      const [solidProgress, writeProgress] = createSignal(0.25);
      setProgress = writeProgress;
      animation = createNativeViewAnimation(graph, {
        clock: () => 10,
        inputs: () => ({ progress: solidProgress() }),
        reduceMotion: () => true,
      });
      const view = createElement("View");
      animation.ref(view);
      return view;
    },
    host,
    { surface: { name: "product-animation" }, autoCommit: false },
  );

  assert.equal(animation.state, "mounting");
  assert.throws(() => animation.update({ progress: 1 }), /not ready/);
  assert.equal(await animation.ready, true);
  assert.equal(animation.state, "ready");
  assert.equal(animation.handle, 51);
  assert.deepEqual(
    calls.slice(0, 2).map((call) => call[0]),
    ["install", "update"],
  );
  assert.deepEqual(animation.inspect().outputs, { opacity: 0.25 });

  setProgress(0.5);
  flush();
  assert.deepEqual(animation.inputs, { progress: 0.5 });
  assert.deepEqual(animation.inspect().outputs, { opacity: 0.5 });
  animation.update({ progress: 0.75 }, 11);
  assert.deepEqual(animation.inspect().outputs, { opacity: 0.75 });
  animation.animate(
    { progress: 0.9 },
    { durationMilliseconds: 250, easing: "ease-in-out" },
    12,
  );
  assert.deepEqual(calls.at(-1), ["update", 51, [0.9], 12]);
  assert.deepEqual(animation.inspect().outputs, { opacity: 0.9 });

  await app.dispose();
  assert.equal(animation.state, "disposed");
  assert.equal(activeUIWorkletCount, 0);
  assert.deepEqual(calls.at(-1), ["destroy", 51]);

  assert.throws(
    () => createNativeViewAnimation(graph),
    /requires an active Solid owner/,
  );

  let unboundAnimation;
  let disposeOwner;
  createRoot((dispose) => {
    disposeOwner = dispose;
    unboundAnimation = createNativeViewAnimation(graph);
  });
  disposeOwner();
  assert.equal(await unboundAnimation.ready, false);
  assert.equal(unboundAnimation.state, "disposed");

  ready = true;
  surfaceSequence = 0;
  committedNodes.clear();
  const setupFailure = new Error("native setup failed");
  binding.installUIWorklet = () => {
    throw setupFailure;
  };
  const failedHost = createNativeFabricHost({
    binding,
    descriptors: [
      {
        name: "RootView",
        acceptsRawText: false,
        bubblingEvents: [],
        directEvents: [],
        commands: {},
      },
      {
        name: "View",
        acceptsRawText: false,
        bubblingEvents: [],
        directEvents: [],
        commands: {},
      },
    ],
  });
  let failedAnimation;
  const failedApp = mount(
    () => {
      failedAnimation = createNativeViewAnimation(graph);
      const view = createElement("View");
      failedAnimation.ref(view);
      return view;
    },
    failedHost,
    { surface: { name: "failed-product-animation" }, autoCommit: false },
  );
  await assert.rejects(failedAnimation.ready, /native setup failed/u);
  assert.equal(failedAnimation.state, "failed");
  assert.equal(failedAnimation.error, setupFailure);
  await failedApp.dispose();
});

test("rejects malformed, unsupported, and resource-exhausting worklet graphs", () => {
  assert.throws(
    () => parseUIWorkletGraph({ ...animationGraph(), protocolVersion: 1 }),
    /Unsupported UI worklet protocol version/,
  );
  assert.throws(
    () =>
      parseUIWorkletGraph({
        ...animationGraph(),
        inputs: [
          { name: "progress", initialValue: 0 },
          { name: "progress", initialValue: 1 },
        ],
      }),
    /Duplicate UI worklet input/,
  );
  const undeclared = animationGraph();
  undeclared.outputs[0].expression.value.name = "missing";
  assert.throws(
    () => parseUIWorkletGraph(undeclared),
    /undeclared worklet input/,
  );
  assert.throws(
    () =>
      parseUIWorkletGraph({
        ...animationGraph(),
        unexpected: true,
      }),
    /unsupported field unexpected/,
  );
  assert.throws(
    () => parseUIWorkletGraph({ ...animationGraph(), outputs: [] }),
    /non-empty array/,
  );
  assert.throws(
    () =>
      parseUIWorkletGraph({
        ...animationGraph(),
        inputs: [{ name: "progress", initialValue: Number.NaN }],
      }),
    /finite number/,
  );
  const invalidRange = animationGraph();
  invalidRange.outputs[0].expression.inputRange = [1, 1];
  assert.throws(() => parseUIWorkletGraph(invalidRange), /strictly ascending/);

  let tooDeep = { kind: "input", name: "progress" };
  for (let index = 0; index <= UI_WORKLET_MAX_EXPRESSION_DEPTH; index++) {
    tooDeep = { kind: "negate", value: tooDeep };
  }
  assert.throws(
    () =>
      parseUIWorkletGraph({
        protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
        inputs: [{ name: "progress", initialValue: 0 }],
        outputs: [{ name: "deep", expression: tooDeep }],
      }),
    /maximum worklet expression depth/,
  );

  const sevenNodeExpression = {
    kind: "binary",
    operator: "add",
    left: {
      kind: "binary",
      operator: "add",
      left: { kind: "constant", value: 1 },
      right: { kind: "constant", value: 2 },
    },
    right: {
      kind: "binary",
      operator: "add",
      left: { kind: "constant", value: 3 },
      right: { kind: "constant", value: 4 },
    },
  };
  const broadExpression = {
    kind: "binary",
    operator: "add",
    left: sevenNodeExpression,
    right: { kind: "constant", value: 5 },
  };
  assert.throws(
    () =>
      parseUIWorkletGraph({
        protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
        inputs: [],
        outputs: Array.from({ length: 64 }, (_, index) => ({
          name: `output${String(index)}`,
          expression: broadExpression,
        })),
      }),
    /exceeds 512 expression nodes/,
  );
});

test("updates installed graphs atomically and cancels sessions exactly once", () => {
  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, divisionGraph());
  assert.equal(host.activeGraphCount, 1);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 0,
    inputs: { numerator: 10, denominator: 2 },
    outputs: { ratio: 5 },
    timingActive: false,
    timingProgress: 0,
  });

  session.update({ numerator: 20 }, 10);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 1,
    timestamp: 10,
    inputs: { numerator: 20, denominator: 2 },
    outputs: { ratio: 10 },
    timingActive: false,
    timingProgress: 0,
  });
  assert.deepEqual(session.inputs, { numerator: 20, denominator: 2 });
  assert.equal(Object.isFrozen(session.inputs), true);

  assert.throws(
    () => session.update({ missing: 1 }, 11),
    /Unknown UI worklet input/,
  );
  assert.throws(
    () => session.update({ denominator: 0 }, 11),
    /division by zero/,
  );
  assert.throws(() => session.update({ numerator: 21 }, 9), /monotonic/);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 1,
    timestamp: 10,
    inputs: { numerator: 20, denominator: 2 },
    outputs: { ratio: 10 },
    timingActive: false,
    timingProgress: 0,
  });
  assert.deepEqual(session.inputs, { numerator: 20, denominator: 2 });

  session.dispose();
  session.dispose();
  assert.equal(session.disposed, true);
  assert.equal(host.activeGraphCount, 0);
  assert.throws(() => session.update({ numerator: 30 }, 12), /disposed/);
  assert.throws(
    () => host.snapshot(session.handle),
    /Unknown UI worklet graph/,
  );
});

test("applies a pull-based reduced-motion policy to native drivers", () => {
  let reduceMotion = true;
  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, animationGraph(), {
    reduceMotion: () => reduceMotion,
  });

  session.animate(
    { progress: 0.5 },
    { durationMilliseconds: 100, easing: "linear" },
    1,
  );
  assert.equal(host.snapshot(session.handle).timingActive, false);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    progress: 0.5,
    translationX: 0,
  });

  session.animateKeyframes(
    [
      {
        inputs: { progress: 0.75, translationX: 2 },
        timing: { durationMilliseconds: 100, easing: "ease-out" },
      },
      {
        inputs: { progress: 1 },
        timing: { durationMilliseconds: 100, easing: "ease-in-out" },
      },
    ],
    2,
  );
  assert.equal(host.snapshot(session.handle).timingActive, false);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    progress: 1,
    translationX: 2,
  });

  session.spring(
    { translationX: 4 },
    {
      mass: 1,
      stiffness: 100,
      damping: 10,
      initialVelocity: 0,
      restSpeedThreshold: 0.01,
      restDisplacementThreshold: 0.001,
      maximumDurationMilliseconds: 5_000,
    },
    3,
  );
  assert.notEqual(host.snapshot(session.handle).springActive, true);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    progress: 1,
    translationX: 4,
  });

  session.decay(
    { translationX: 1_000 },
    {
      deceleration: 2,
      velocityThreshold: 1,
      maximumDurationMilliseconds: 5_000,
    },
    4,
  );
  assert.notEqual(host.snapshot(session.handle).decayActive, true);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    progress: 1,
    translationX: 4,
  });

  session.attachPanGesture({
    xInput: "translationX",
    yInput: "progress",
    minX: -20,
    maxX: 20,
    minY: 0,
    maxY: 1,
    releaseDecay: {
      deceleration: 2,
      velocityThreshold: 1,
      maximumDurationMilliseconds: 500,
    },
  });
  host.dispatchPanGesture(session.handle, "begin", 0, 0, 10);
  host.dispatchPanGesture(session.handle, "end", 2, -0.5, 11, 100, 100);
  assert.equal(host.snapshot(session.handle).decayActive, undefined);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    progress: 0.5,
    translationX: 6,
  });
  session.detachPanGesture(12);

  reduceMotion = false;
  session.animate(
    { progress: 1 },
    { durationMilliseconds: 100, easing: "linear" },
    13,
  );
  assert.equal(host.snapshot(session.handle).timingActive, true);
  session.dispose();

  const invalidHost = createInMemoryUIWorkletHost();
  assert.throws(
    () =>
      createUIWorkletSession(invalidHost, animationGraph(), {
        reduceMotion: true,
      }),
    /must be a function/u,
  );
  assert.equal(invalidHost.activeGraphCount, 0);

  const invalidSession = createUIWorkletSession(invalidHost, animationGraph(), {
    reduceMotion: () => "yes",
  });
  assert.throws(
    () =>
      invalidSession.animate(
        { progress: 1 },
        { durationMilliseconds: 100, easing: "linear" },
        1,
      ),
    /must return a boolean or undefined/u,
  );
  assert.equal(invalidHost.snapshot(invalidSession.handle).sequence, 0);
  invalidSession.dispose();
});

test("advances bounded timings deterministically and interrupts from the latest frame", () => {
  const timing = parseUIWorkletTiming({
    durationMilliseconds: 100,
    easing: "linear",
  });
  assert.equal(Object.isFrozen(timing), true);
  assert.equal(evaluateUIWorkletTimingProgress(timing, 50), 0.5);
  assert.equal(
    evaluateUIWorkletTimingProgress(
      { durationMilliseconds: 100, easing: "ease-in" },
      50,
    ),
    0.25,
  );
  assert.equal(
    evaluateUIWorkletTimingProgress(
      { durationMilliseconds: 100, easing: "ease-out" },
      50,
    ),
    0.75,
  );
  assert.equal(
    evaluateUIWorkletTimingProgress(
      { durationMilliseconds: 100, easing: "ease-in-out" },
      50,
    ),
    0.5,
  );
  assert.equal(evaluateUIWorkletTimingProgress(timing, 200), 1);
  assert.throws(
    () =>
      parseUIWorkletTiming({
        durationMilliseconds: 0,
        easing: "linear",
      }),
    /greater than zero/,
  );
  assert.throws(
    () =>
      parseUIWorkletTiming({
        durationMilliseconds: UI_WORKLET_MAX_TIMING_DURATION_MS + 1,
        easing: "linear",
      }),
    /at most/,
  );
  assert.throws(
    () =>
      parseUIWorkletTiming({
        durationMilliseconds: 100,
        easing: "spring",
      }),
    /unsupported/,
  );

  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, divisionGraph());
  session.animate({ numerator: 30 }, timing, 10);
  assert.deepEqual(session.inputs, { numerator: 30, denominator: 2 });
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 0,
    timestamp: 10,
    inputs: { numerator: 10, denominator: 2 },
    outputs: { ratio: 5 },
    timingActive: true,
    timingProgress: 0,
  });

  host.advanceFrame(1_000);
  host.advanceFrame(1_050);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 2,
    timestamp: 10,
    inputs: { numerator: 20, denominator: 2 },
    outputs: { ratio: 10 },
    timingActive: true,
    timingProgress: 0.5,
    timingFrameStatistics: {
      frameCount: 2,
      intervalCount: 1,
      sampledIntervalCount: 1,
      droppedIntervalSampleCount: 0,
      firstFrameTimeMilliseconds: 1_000,
      lastFrameTimeMilliseconds: 1_050,
      minimumFrameIntervalMilliseconds: 50,
      maximumFrameIntervalMilliseconds: 50,
      meanFrameIntervalMilliseconds: 50,
      p50FrameIntervalMilliseconds: 50,
      p95FrameIntervalMilliseconds: 50,
      p99FrameIntervalMilliseconds: 50,
    },
  });

  session.animate(
    { numerator: 40 },
    { durationMilliseconds: 100, easing: "ease-out" },
    11,
  );
  host.advanceFrame(1_060);
  host.advanceFrame(1_110);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 4,
    timestamp: 11,
    inputs: { numerator: 35, denominator: 2 },
    outputs: { ratio: 17.5 },
    timingActive: true,
    timingProgress: 0.75,
    timingFrameStatistics: {
      frameCount: 2,
      intervalCount: 1,
      sampledIntervalCount: 1,
      droppedIntervalSampleCount: 0,
      firstFrameTimeMilliseconds: 1_060,
      lastFrameTimeMilliseconds: 1_110,
      minimumFrameIntervalMilliseconds: 50,
      maximumFrameIntervalMilliseconds: 50,
      meanFrameIntervalMilliseconds: 50,
      p50FrameIntervalMilliseconds: 50,
      p95FrameIntervalMilliseconds: 50,
      p99FrameIntervalMilliseconds: 50,
    },
  });

  session.update({ numerator: 24 }, 12);
  host.advanceFrame(1_200);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 5,
    timestamp: 12,
    inputs: { numerator: 24, denominator: 2 },
    outputs: { ratio: 12 },
    timingActive: false,
    timingProgress: 0,
  });
  assert.throws(() => host.advanceFrame(1_199), /monotonic/);

  session.dispose();

  const singularHost = createInMemoryUIWorkletHost();
  const singularSession = createUIWorkletSession(singularHost, divisionGraph());
  singularSession.animate(
    { denominator: -2 },
    { durationMilliseconds: 100, easing: "linear" },
    1,
  );
  singularHost.advanceFrame(0);
  assert.throws(() => singularHost.advanceFrame(50), /division by zero/);
  assert.deepEqual(singularHost.snapshot(singularSession.handle), {
    handle: singularSession.handle,
    sequence: 1,
    timestamp: 1,
    inputs: { numerator: 10, denominator: 2 },
    outputs: { ratio: 5 },
    timingActive: false,
    timingProgress: 0,
    timingFrameStatistics: {
      frameCount: 1,
      intervalCount: 0,
      sampledIntervalCount: 0,
      droppedIntervalSampleCount: 0,
      firstFrameTimeMilliseconds: 0,
      lastFrameTimeMilliseconds: 0,
      minimumFrameIntervalMilliseconds: 0,
      maximumFrameIntervalMilliseconds: 0,
      meanFrameIntervalMilliseconds: 0,
      p50FrameIntervalMilliseconds: 0,
      p95FrameIntervalMilliseconds: 0,
      p99FrameIntervalMilliseconds: 0,
    },
  });
  singularSession.dispose();
});

test("runs bounded native keyframes without JavaScript stage handoffs", () => {
  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, divisionGraph());
  session.animateKeyframes(
    [
      {
        inputs: { numerator: 30 },
        timing: { durationMilliseconds: 100, easing: "linear" },
      },
      {
        inputs: { denominator: 4 },
        timing: { durationMilliseconds: 100, easing: "ease-in" },
      },
    ],
    1,
  );
  assert.deepEqual(session.inputs, { numerator: 30, denominator: 4 });

  host.advanceFrame(0);
  host.advanceFrame(50);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    numerator: 20,
    denominator: 2,
  });
  assert.equal(host.snapshot(session.handle).timingProgress, 0.25);

  host.advanceFrame(100);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    numerator: 30,
    denominator: 2,
  });
  assert.equal(host.snapshot(session.handle).timingProgress, 0.5);

  host.advanceFrame(150);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    numerator: 30,
    denominator: 2.5,
  });
  assert.equal(host.snapshot(session.handle).outputs.ratio, 12);
  assert.equal(host.snapshot(session.handle).timingProgress, 0.625);

  host.advanceFrame(200);
  const settled = host.snapshot(session.handle);
  assert.deepEqual(settled.inputs, { numerator: 30, denominator: 4 });
  assert.equal(settled.outputs.ratio, 7.5);
  assert.equal(settled.timingActive, false);
  assert.equal(settled.timingProgress, 1);
  assert.deepEqual(settled.timingFrameStatistics, {
    frameCount: 5,
    intervalCount: 4,
    sampledIntervalCount: 4,
    droppedIntervalSampleCount: 0,
    firstFrameTimeMilliseconds: 0,
    lastFrameTimeMilliseconds: 200,
    minimumFrameIntervalMilliseconds: 50,
    maximumFrameIntervalMilliseconds: 50,
    meanFrameIntervalMilliseconds: 50,
    p50FrameIntervalMilliseconds: 50,
    p95FrameIntervalMilliseconds: 50,
    p99FrameIntervalMilliseconds: 50,
  });

  session.animate(
    { numerator: 40 },
    { durationMilliseconds: 100, easing: "linear" },
    2,
  );
  assert.throws(
    () =>
      session.animateKeyframes(
        [
          {
            inputs: { numerator: 50 },
            timing: { durationMilliseconds: 50, easing: "linear" },
          },
          {
            inputs: { denominator: 0 },
            timing: { durationMilliseconds: 50, easing: "linear" },
          },
        ],
        3,
      ),
    /division by zero/,
  );
  assert.equal(host.snapshot(session.handle).timestamp, 2);
  assert.equal(host.snapshot(session.handle).timingActive, true);
  assert.throws(() => session.animateKeyframes([], 3), /between 1 and/);
  assert.throws(
    () =>
      session.animateKeyframes(
        Array.from({ length: UI_WORKLET_MAX_TIMING_KEYFRAMES + 1 }, () => ({
          inputs: {},
          timing: { durationMilliseconds: 1, easing: "linear" },
        })),
        3,
      ),
    /between 1 and/,
  );
  assert.throws(
    () =>
      session.animateKeyframes(
        [
          {
            inputs: {},
            timing: {
              durationMilliseconds: UI_WORKLET_MAX_TIMING_DURATION_MS,
              easing: "linear",
            },
          },
          {
            inputs: {},
            timing: { durationMilliseconds: 1, easing: "linear" },
          },
        ],
        3,
      ),
    /in total/,
  );
  session.dispose();
});

test("cancels native motion at its exact frame and resumes from synchronized inputs", () => {
  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, divisionGraph());
  session.animate(
    { numerator: 30 },
    { durationMilliseconds: 100, easing: "linear" },
    1,
  );
  host.advanceFrame(1_000);
  host.advanceFrame(1_050);
  const moving = host.snapshot(session.handle);
  assert.deepEqual(moving.inputs, { numerator: 20, denominator: 2 });
  assert.equal(moving.timingActive, true);

  session.cancel(2);
  const cancelled = host.snapshot(session.handle);
  assert.deepEqual(session.inputs, { numerator: 20, denominator: 2 });
  assert.equal(cancelled.sequence, moving.sequence);
  assert.equal(cancelled.timestamp, 2);
  assert.equal(cancelled.timingActive, false);
  assert.equal(cancelled.timingProgress, 0.5);
  assert.deepEqual(
    cancelled.timingFrameStatistics,
    moving.timingFrameStatistics,
  );
  host.advanceFrame(1_100);
  assert.equal(host.snapshot(session.handle).sequence, moving.sequence);

  session.animate(
    { denominator: 4 },
    { durationMilliseconds: 100, easing: "linear" },
    3,
  );
  assert.deepEqual(session.inputs, { numerator: 20, denominator: 4 });
  host.advanceFrame(1_150);
  host.advanceFrame(1_200);
  assert.deepEqual(host.snapshot(session.handle).inputs, {
    numerator: 20,
    denominator: 3,
  });

  session.spring(
    { numerator: 40 },
    {
      mass: 1,
      stiffness: 100,
      damping: 10,
      initialVelocity: 0,
      restSpeedThreshold: 0.01,
      restDisplacementThreshold: 0.001,
      maximumDurationMilliseconds: 5_000,
    },
    4,
  );
  host.advanceFrame(1_250);
  host.advanceFrame(1_300);
  const movingSpring = host.snapshot(session.handle);
  assert.equal(movingSpring.springActive, true);
  assert.notEqual(movingSpring.springVelocity, 0);
  session.cancel(5);
  const cancelledSpring = host.snapshot(session.handle);
  assert.deepEqual(session.inputs, cancelledSpring.inputs);
  assert.equal(cancelledSpring.springActive, false);
  assert.equal(cancelledSpring.springVelocity, 0);
  assert.deepEqual(
    cancelledSpring.springFrameStatistics,
    movingSpring.springFrameStatistics,
  );

  session.decay(
    { numerator: 20 },
    {
      deceleration: 2,
      velocityThreshold: 2,
      maximumDurationMilliseconds: 5_000,
    },
    6,
  );
  host.advanceFrame(1_350);
  host.advanceFrame(1_400);
  const movingDecay = host.snapshot(session.handle);
  assert.equal(movingDecay.decayActive, true);
  assert.ok(movingDecay.decaySpeed > 0);
  session.cancel(7);
  const cancelledDecay = host.snapshot(session.handle);
  assert.deepEqual(session.inputs, cancelledDecay.inputs);
  assert.equal(cancelledDecay.decayActive, false);
  assert.equal(cancelledDecay.decaySpeed, 0);
  assert.deepEqual(
    cancelledDecay.decayFrameStatistics,
    movingDecay.decayFrameStatistics,
  );
  session.dispose();
});

test("fails native cancellation closed on missing or malformed host results", () => {
  let cancellationResult = [10];
  const host = {
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    installGraph: () => 1,
    updateGraphInputs: () => {},
    animateGraphInputs: () => {},
    cancelGraphAnimation: () => cancellationResult,
    destroyGraph: () => {},
  };
  const session = createUIWorkletSession(host, divisionGraph());
  session.animate(
    { numerator: 30 },
    { durationMilliseconds: 100, easing: "linear" },
    1,
  );
  assert.throws(() => session.cancel(2), /complete frozen input vector/);
  assert.deepEqual(session.inputs, { numerator: 30, denominator: 2 });
  cancellationResult = [Number.NaN, 2];
  assert.throws(() => session.cancel(2), /must be a finite number/);
  assert.deepEqual(session.inputs, { numerator: 30, denominator: 2 });
  cancellationResult = [15, 3];
  assert.doesNotThrow(() => session.cancel(1));
  assert.deepEqual(session.inputs, { numerator: 15, denominator: 3 });

  const unsupported = createUIWorkletSession(
    {
      protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
      installGraph: () => 1,
      updateGraphInputs: () => {},
      destroyGraph: () => {},
    },
    divisionGraph(),
  );
  assert.throws(() => unsupported.cancel(1), /does not support/);
  unsupported.dispose();

  const irreversible = createUIWorkletSession(
    {
      protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
      installGraph: () => 1,
      updateGraphInputs: () => {},
      attachPanGesture: () => {},
      destroyGraph: () => {},
    },
    createUIWorkletGraph(animationGraph()),
  );
  irreversible.attachPanGesture({
    xInput: "translationX",
    yInput: "progress",
    minX: -1,
    maxX: 1,
    minY: 0,
    maxY: 1,
  });
  assert.throws(() => irreversible.detachPanGesture(1), /does not support/);
  assert.equal(irreversible.nativeInputsOwned, true);
  irreversible.dispose();
  session.dispose();
});

test("evaluates bounded analytical springs across damping regimes", () => {
  const underdamped = parseUIWorkletSpring({
    mass: 1,
    stiffness: 100,
    damping: 10,
    initialVelocity: 0,
    restSpeedThreshold: 0.01,
    restDisplacementThreshold: 0.001,
    maximumDurationMilliseconds: 5_000,
  });
  assert.equal(Object.isFrozen(underdamped), true);
  assert.deepEqual(evaluateUIWorkletSpring(underdamped, 0), {
    position: 0,
    velocity: 0,
    settled: false,
  });
  const overshoot = evaluateUIWorkletSpring(underdamped, 300);
  assertClose(overshoot.position, 1.1243547674084118);
  assertClose(overshoot.velocity, 1.332426440180412);
  assert.equal(overshoot.settled, false);
  assert.deepEqual(evaluateUIWorkletSpring(underdamped, 2_000), {
    position: 1,
    velocity: 0,
    settled: true,
  });

  const critical = evaluateUIWorkletSpring(
    { ...underdamped, damping: 20 },
    100,
  );
  assertClose(critical.position, 0.26424111765711533);
  assertClose(critical.velocity, 3.6787944117144233);
  const overdamped = evaluateUIWorkletSpring(
    { ...underdamped, damping: 30 },
    100,
  );
  assertClose(overdamped.position, 0.2133544006966317);
  assertClose(overdamped.velocity, 2.7260893766252905);

  assert.deepEqual(
    evaluateUIWorkletSpring(
      {
        ...underdamped,
        damping: 0,
        maximumDurationMilliseconds: 250,
      },
      250,
    ),
    { position: 1, velocity: 0, settled: true },
  );
  assert.throws(() => evaluateUIWorkletSpring(underdamped, -1), /non-negative/);
  for (const spring of [
    { ...underdamped, mass: 0 },
    { ...underdamped, stiffness: 100_001 },
    { ...underdamped, damping: -1 },
    { ...underdamped, initialVelocity: 101 },
    { ...underdamped, restSpeedThreshold: 0 },
    { ...underdamped, restDisplacementThreshold: 1 },
    {
      ...underdamped,
      maximumDurationMilliseconds: UI_WORKLET_MAX_SPRING_DURATION_MS + 1,
    },
    { ...underdamped, unsupported: true },
  ]) {
    assert.throws(() => parseUIWorkletSpring(spring), /UI worklet spring/);
  }
});

test("advances and interrupts analytical springs from the latest native frame", () => {
  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, divisionGraph());
  const underdamped = {
    mass: 1,
    stiffness: 100,
    damping: 10,
    initialVelocity: 0,
    restSpeedThreshold: 0.01,
    restDisplacementThreshold: 0.001,
    maximumDurationMilliseconds: 5_000,
  };
  session.spring({ numerator: 30 }, underdamped, 1);
  assert.deepEqual(session.inputs, { numerator: 30, denominator: 2 });
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 0,
    timestamp: 1,
    inputs: { numerator: 10, denominator: 2 },
    outputs: { ratio: 5 },
    timingActive: false,
    timingProgress: 0,
    springActive: true,
    springPosition: 0,
    springVelocity: 0,
  });

  host.advanceFrame(0);
  host.advanceFrame(300);
  const overshoot = host.snapshot(session.handle);
  assert.equal(overshoot.sequence, 2);
  assert.equal(overshoot.springActive, true);
  assertClose(overshoot.springPosition, 1.1243547674084118);
  assertClose(overshoot.springVelocity, 1.332426440180412);
  assertClose(overshoot.inputs.numerator, 32.48709534816824);
  assertClose(overshoot.outputs.ratio, 16.24354767408412);
  assert.deepEqual(overshoot.springFrameStatistics, {
    frameCount: 2,
    intervalCount: 1,
    sampledIntervalCount: 1,
    droppedIntervalSampleCount: 0,
    firstFrameTimeMilliseconds: 0,
    lastFrameTimeMilliseconds: 300,
    minimumFrameIntervalMilliseconds: 300,
    maximumFrameIntervalMilliseconds: 300,
    meanFrameIntervalMilliseconds: 300,
    p50FrameIntervalMilliseconds: 300,
    p95FrameIntervalMilliseconds: 300,
    p99FrameIntervalMilliseconds: 300,
  });

  session.spring({ numerator: 20 }, { ...underdamped, damping: 20 }, 2);
  host.advanceFrame(300);
  host.advanceFrame(400);
  const interrupted = host.snapshot(session.handle);
  assert.equal(interrupted.sequence, 4);
  assert.equal(interrupted.springActive, true);
  assertClose(interrupted.springPosition, 0.26424111765711533);
  assertClose(interrupted.inputs.numerator, 29.187491317077292);
  assert.deepEqual(interrupted.springFrameStatistics, {
    frameCount: 2,
    intervalCount: 1,
    sampledIntervalCount: 1,
    droppedIntervalSampleCount: 0,
    firstFrameTimeMilliseconds: 300,
    lastFrameTimeMilliseconds: 400,
    minimumFrameIntervalMilliseconds: 100,
    maximumFrameIntervalMilliseconds: 100,
    meanFrameIntervalMilliseconds: 100,
    p50FrameIntervalMilliseconds: 100,
    p95FrameIntervalMilliseconds: 100,
    p99FrameIntervalMilliseconds: 100,
  });

  session.update({ numerator: 24 }, 3);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 5,
    timestamp: 3,
    inputs: { numerator: 24, denominator: 2 },
    outputs: { ratio: 12 },
    timingActive: false,
    timingProgress: 0,
  });
  session.dispose();
});

test("switches timing and spring drivers atomically and rejects invalid targets", () => {
  const spring = {
    mass: 1,
    stiffness: 100,
    damping: 10,
    initialVelocity: 0,
    restSpeedThreshold: 0.01,
    restDisplacementThreshold: 0.001,
    maximumDurationMilliseconds: 5_000,
  };
  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, divisionGraph());
  session.spring({ numerator: 30 }, spring, 1);
  host.advanceFrame(0);
  host.advanceFrame(100);
  const springInputs = host.snapshot(session.handle).inputs;

  session.animate(
    { numerator: 40 },
    { durationMilliseconds: 100, easing: "linear" },
    2,
  );
  const timingReplacement = host.snapshot(session.handle);
  assert.equal(timingReplacement.timingActive, true);
  assert.equal(timingReplacement.timingProgress, 0);
  assert.equal(timingReplacement.springActive, undefined);
  assert.deepEqual(timingReplacement.inputs, springInputs);
  host.advanceFrame(100);
  host.advanceFrame(150);
  const timingInputs = host.snapshot(session.handle).inputs;

  session.spring({ numerator: 20 }, spring, 3);
  const springReplacement = host.snapshot(session.handle);
  assert.equal(springReplacement.timingActive, false);
  assert.equal(springReplacement.timingProgress, 0);
  assert.equal(springReplacement.springActive, true);
  assert.equal(springReplacement.springPosition, 0);
  assert.equal(springReplacement.springVelocity, 0);
  assert.deepEqual(springReplacement.inputs, timingInputs);

  session.update({ numerator: 24 }, 4);
  assert.equal(host.snapshot(session.handle).springActive, undefined);
  session.dispose();

  const singularHost = createInMemoryUIWorkletHost();
  const singularSession = createUIWorkletSession(singularHost, divisionGraph());
  const beforeRejection = singularHost.snapshot(singularSession.handle);
  assert.throws(
    () => singularSession.spring({ denominator: 0 }, spring, 1),
    /division by zero/,
  );
  assert.deepEqual(
    singularHost.snapshot(singularSession.handle),
    beforeRejection,
  );
  assert.deepEqual(singularSession.inputs, {
    numerator: 10,
    denominator: 2,
  });
  singularSession.dispose();
});

test("evaluates bounded velocity decay independently of display cadence", () => {
  const decay = parseUIWorkletDecay({
    deceleration: 2,
    velocityThreshold: 10,
    maximumDurationMilliseconds: 5_000,
  });
  assert.equal(Object.isFrozen(decay), true);
  assert.deepEqual(evaluateUIWorkletDecay(decay, 100, 0), {
    displacementFactorSeconds: 0,
    velocityFactor: 1,
    speed: 100,
    settled: false,
  });
  const halfway = evaluateUIWorkletDecay(decay, 100, 500);
  assertClose(halfway.displacementFactorSeconds, 0.31606027941427883);
  assertClose(halfway.velocityFactor, Math.exp(-1));
  assertClose(halfway.speed, 100 * Math.exp(-1));
  assert.equal(halfway.settled, false);
  const settled = evaluateUIWorkletDecay(decay, 100, 2_000);
  assertClose(settled.displacementFactorSeconds, 0.45);
  assert.equal(settled.velocityFactor, 0);
  assert.equal(settled.speed, 0);
  assert.equal(settled.settled, true);
  assert.deepEqual(evaluateUIWorkletDecay(decay, 10, 0), {
    displacementFactorSeconds: 0,
    velocityFactor: 0,
    speed: 0,
    settled: true,
  });
  const durationCapped = evaluateUIWorkletDecay(
    { ...decay, velocityThreshold: 0.001, maximumDurationMilliseconds: 250 },
    100,
    1_000,
  );
  assertClose(
    durationCapped.displacementFactorSeconds,
    (1 - Math.exp(-0.5)) / 2,
  );
  assert.equal(durationCapped.settled, true);

  for (const definition of [
    { ...decay, deceleration: 0 },
    { ...decay, velocityThreshold: 0 },
    {
      ...decay,
      maximumDurationMilliseconds: UI_WORKLET_MAX_DECAY_DURATION_MS + 1,
    },
    { ...decay, unsupported: true },
  ]) {
    assert.throws(() => parseUIWorkletDecay(definition), /UI worklet decay/);
  }
  assert.throws(() => evaluateUIWorkletDecay(decay, -1, 0), /initial speed/);
  assert.throws(() => evaluateUIWorkletDecay(decay, 100, -1), /elapsed time/);
});

test("advances and interrupts complete velocity vectors analytically", () => {
  const decay = {
    deceleration: 2,
    velocityThreshold: 10,
    maximumDurationMilliseconds: 5_000,
  };
  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, divisionGraph());
  session.decay({ numerator: 100 }, decay, 1);
  assert.deepEqual(session.inputs, { numerator: 10, denominator: 2 });
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 0,
    timestamp: 1,
    inputs: { numerator: 10, denominator: 2 },
    outputs: { ratio: 5 },
    timingActive: false,
    timingProgress: 0,
    decayActive: true,
    decayElapsedMilliseconds: 0,
    decaySpeed: 100,
  });

  host.advanceFrame(0);
  host.advanceFrame(500);
  const advanced = host.snapshot(session.handle);
  assert.equal(advanced.sequence, 2);
  assert.equal(advanced.decayActive, true);
  assert.equal(advanced.decayElapsedMilliseconds, 500);
  assertClose(advanced.decaySpeed, 100 * Math.exp(-1));
  assertClose(advanced.inputs.numerator, 41.60602794142788);
  assertClose(advanced.outputs.ratio, 20.80301397071394);
  assert.deepEqual(advanced.decayFrameStatistics, {
    frameCount: 2,
    intervalCount: 1,
    sampledIntervalCount: 1,
    droppedIntervalSampleCount: 0,
    firstFrameTimeMilliseconds: 0,
    lastFrameTimeMilliseconds: 500,
    minimumFrameIntervalMilliseconds: 500,
    maximumFrameIntervalMilliseconds: 500,
    meanFrameIntervalMilliseconds: 500,
    p50FrameIntervalMilliseconds: 500,
    p95FrameIntervalMilliseconds: 500,
    p99FrameIntervalMilliseconds: 500,
  });

  session.decay({ numerator: -100, denominator: 1 }, decay, 2);
  assert.equal(host.snapshot(session.handle).decayElapsedMilliseconds, 0);
  assert.equal(host.snapshot(session.handle).decaySpeed, 100);
  host.advanceFrame(500);
  host.advanceFrame(1_000);
  const interrupted = host.snapshot(session.handle);
  assert.equal(interrupted.decayActive, true);
  assertClose(
    interrupted.inputs.numerator,
    advanced.inputs.numerator - 100 * 0.31606027941427883,
  );
  assertClose(
    interrupted.inputs.denominator,
    advanced.inputs.denominator + 0.31606027941427883,
  );

  host.advanceFrame(2_000);
  const settled = host.snapshot(session.handle);
  assert.equal(settled.decayActive, false);
  assert.equal(settled.decaySpeed, 0);
  assertClose(settled.inputs.numerator, advanced.inputs.numerator - 45);
  assertClose(settled.inputs.denominator, advanced.inputs.denominator + 0.45);

  session.update({ numerator: 24 }, 3);
  assert.equal(host.snapshot(session.handle).decayActive, undefined);
  session.dispose();
});

test("bounds sustained timing interval samples without losing aggregate cadence", () => {
  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, divisionGraph());
  session.animate(
    { numerator: 30 },
    { durationMilliseconds: 60_000, easing: "linear" },
    1,
  );

  for (
    let frame = 0;
    frame <= UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES + 1;
    frame++
  ) {
    host.advanceFrame(frame);
  }

  assert.deepEqual(host.snapshot(session.handle).timingFrameStatistics, {
    frameCount: UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES + 2,
    intervalCount: UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES + 1,
    sampledIntervalCount: UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES,
    droppedIntervalSampleCount: 1,
    firstFrameTimeMilliseconds: 0,
    lastFrameTimeMilliseconds: UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES + 1,
    minimumFrameIntervalMilliseconds: 1,
    maximumFrameIntervalMilliseconds: 1,
    meanFrameIntervalMilliseconds: 1,
    p50FrameIntervalMilliseconds: 1,
    p95FrameIntervalMilliseconds: 1,
    p99FrameIntervalMilliseconds: 1,
  });
  session.dispose();
});

test("transfers bounded pan input ownership to the host atomically", () => {
  const graph = createUIWorkletGraph(animationGraph());
  const gesture = parseUIWorkletPanGesture(
    {
      xInput: "translationX",
      yInput: "progress",
      minX: -20,
      maxX: 20,
      minY: 0,
      maxY: 1,
      releaseDecay: {
        deceleration: 2,
        velocityThreshold: 1,
        maximumDurationMilliseconds: 500,
      },
    },
    graph,
  );
  assert.equal(Object.isFrozen(gesture), true);
  assert.equal(Object.isFrozen(gesture.releaseDecay), true);
  assert.throws(
    () => parseUIWorkletPanGesture({ ...gesture, xInput: "missing" }, graph),
    /Unknown UI worklet pan input/,
  );
  assert.throws(
    () =>
      parseUIWorkletPanGesture({ ...gesture, yInput: "translationX" }, graph),
    /must be distinct/,
  );
  assert.throws(
    () => parseUIWorkletPanGesture({ ...gesture, minX: 21 }, graph),
    /bounds must be ascending/,
  );
  assert.throws(
    () => parseUIWorkletPanGesture({ ...gesture, unexpected: true }, graph),
    /unsupported field unexpected/,
  );

  const host = createInMemoryUIWorkletHost();
  const session = createUIWorkletSession(host, graph);
  session.update({ progress: 0.25, translationX: 4 }, 10);
  session.animate(
    { progress: 1 },
    { durationMilliseconds: 100, easing: "linear" },
    11,
  );
  session.attachPanGesture(gesture);
  assert.equal(session.nativeInputsOwned, true);
  assert.throws(
    () => session.update({ progress: 0.5 }, 12),
    /owned by its native pan gesture/,
  );
  assert.throws(
    () =>
      session.animate(
        { progress: 0.5 },
        { durationMilliseconds: 100, easing: "linear" },
        12,
      ),
    /owned by its native pan gesture/,
  );
  assert.throws(
    () =>
      session.spring(
        { progress: 0.5 },
        {
          mass: 1,
          stiffness: 100,
          damping: 10,
          initialVelocity: 0,
          restSpeedThreshold: 0.01,
          restDisplacementThreshold: 0.001,
          maximumDurationMilliseconds: 5_000,
        },
        12,
      ),
    /owned by its native pan gesture/,
  );
  assert.throws(
    () =>
      session.decay(
        { translationX: 100 },
        {
          deceleration: 2,
          velocityThreshold: 1,
          maximumDurationMilliseconds: 5_000,
        },
        12,
      ),
    /owned by its native pan gesture/,
  );
  assert.throws(() => session.attachPanGesture(gesture), /already owns/);

  host.dispatchPanGesture(session.handle, "begin", 0, 0, 100);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 1,
    timestamp: 11,
    inputs: { progress: 0.25, translationX: 4 },
    outputs: { opacity: 0.4, translateX: 8, distance: 4 },
    timingActive: false,
    timingProgress: 0,
    gestureAttached: true,
    gestureActive: true,
    gestureSequence: 0,
    gestureTimestamp: 100,
  });

  host.dispatchPanGesture(session.handle, "change", 100, 0.5, 101);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 2,
    timestamp: 11,
    inputs: { progress: 0.75, translationX: 20 },
    outputs: { opacity: 0.8, translateX: 40, distance: 20 },
    timingActive: false,
    timingProgress: 0,
    gestureAttached: true,
    gestureActive: true,
    gestureSequence: 1,
    gestureTimestamp: 101,
  });
  assert.throws(
    () => host.dispatchPanGesture(session.handle, "change", 0, 0, 99),
    /timestamps must be monotonic/,
  );

  host.dispatchPanGesture(session.handle, "end", -100, -100, 102, 20, 0);
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 3,
    timestamp: 11,
    inputs: { progress: 0, translationX: -20 },
    outputs: { opacity: 0.2, translateX: -40, distance: 20 },
    timingActive: false,
    timingProgress: 0,
    decayActive: true,
    decayElapsedMilliseconds: 0,
    decaySpeed: 20,
    gestureAttached: true,
    gestureActive: false,
    gestureSequence: 2,
    gestureTimestamp: 102,
  });
  assert.deepEqual(session.inputs, { progress: 1, translationX: 4 });

  host.advanceFrame(102);
  host.advanceFrame(602);
  const released = host.snapshot(session.handle);
  assert.equal(released.decayActive, false);
  assert.equal(released.decaySpeed, 0);
  assertClose(released.inputs.translationX, -20 + 20 * 0.31606027941427883);
  assert.deepEqual(released.decayFrameStatistics, {
    frameCount: 2,
    intervalCount: 1,
    sampledIntervalCount: 1,
    droppedIntervalSampleCount: 0,
    firstFrameTimeMilliseconds: 102,
    lastFrameTimeMilliseconds: 602,
    minimumFrameIntervalMilliseconds: 500,
    maximumFrameIntervalMilliseconds: 500,
    meanFrameIntervalMilliseconds: 500,
    p50FrameIntervalMilliseconds: 500,
    p95FrameIntervalMilliseconds: 500,
    p99FrameIntervalMilliseconds: 500,
  });

  host.dispatchPanGesture(session.handle, "begin", 0, 0, 103);
  host.dispatchPanGesture(session.handle, "end", 0, 0, 104, 20, 0);
  host.advanceFrame(603);
  host.advanceFrame(703);
  const movingRelease = host.snapshot(session.handle);
  assert.equal(movingRelease.decayActive, true);
  assert.equal(movingRelease.gestureAttached, true);
  const releaseSequence = movingRelease.sequence;
  session.detachPanGesture(12);
  const detached = host.snapshot(session.handle);
  assert.equal(session.nativeInputsOwned, false);
  assert.deepEqual(session.inputs, movingRelease.inputs);
  assert.equal(detached.sequence, releaseSequence);
  assert.equal(detached.timestamp, 12);
  assert.equal(detached.gestureAttached, undefined);
  assert.equal(detached.decayActive, false);
  assert.equal(detached.decaySpeed, 0);
  assert.deepEqual(
    detached.decayFrameStatistics,
    movingRelease.decayFrameStatistics,
  );
  host.advanceFrame(1_203);
  assert.equal(host.snapshot(session.handle).sequence, releaseSequence);
  session.update({ progress: 0.5 }, 13);
  assert.equal(
    host.snapshot(session.handle).inputs.translationX,
    detached.inputs.translationX,
  );
  assert.equal(host.snapshot(session.handle).inputs.progress, 0.5);
  assert.throws(() => session.detachPanGesture(14), /does not own/);
  session.dispose();

  const singularHost = createInMemoryUIWorkletHost();
  const singularSession = createUIWorkletSession(singularHost, divisionGraph());
  singularSession.attachPanGesture({
    xInput: "numerator",
    yInput: "denominator",
    minX: 0,
    maxX: 20,
    minY: -2,
    maxY: 2,
    releaseDecay: {
      deceleration: 1,
      velocityThreshold: 0.1,
      maximumDurationMilliseconds: 1_000,
    },
  });
  singularHost.dispatchPanGesture(singularSession.handle, "begin", 0, 0, 1);
  assert.throws(
    () =>
      singularHost.dispatchPanGesture(
        singularSession.handle,
        "change",
        0,
        -2,
        2,
      ),
    /division by zero/,
  );
  assert.deepEqual(singularHost.snapshot(singularSession.handle), {
    handle: singularSession.handle,
    sequence: 0,
    inputs: { numerator: 10, denominator: 2 },
    outputs: { ratio: 5 },
    timingActive: false,
    timingProgress: 0,
    gestureAttached: true,
    gestureActive: false,
    gestureSequence: 0,
    gestureTimestamp: 1,
  });

  singularHost.dispatchPanGesture(singularSession.handle, "begin", 0, 0, 3);
  const terminalFactor = 1 - Math.exp(-1);
  assert.throws(
    () =>
      singularHost.dispatchPanGesture(
        singularSession.handle,
        "end",
        0,
        0,
        4,
        0,
        -2 / terminalFactor,
      ),
    /division by zero/,
  );
  assert.equal(singularHost.snapshot(singularSession.handle).sequence, 0);
  assert.equal(
    singularHost.snapshot(singularSession.handle).decayActive,
    undefined,
  );
  singularSession.dispose();
});

test("binds coarse Solid input state and graph cancellation to one owner", async () => {
  const host = createInMemoryUIWorkletHost();
  const graph = createUIWorkletGraph(animationGraph());
  let disposeOwner;
  let setInputs;
  let session;
  createRoot((dispose) => {
    disposeOwner = dispose;
    const [inputs, set] = createSignal({
      progress: 0,
      translationX: 0,
    });
    setInputs = set;
    session = createSolidUIWorklet(host, graph, inputs, {
      clock: (() => {
        let now = 0;
        return () => ++now;
      })(),
    });
  });

  await flush();
  assert.deepEqual(host.snapshot(session.handle).outputs, {
    opacity: 0.2,
    translateX: 0,
    distance: 0,
  });
  setInputs({ progress: 0.5, translationX: -8 });
  await flush();
  assert.deepEqual(host.snapshot(session.handle), {
    handle: session.handle,
    sequence: 2,
    timestamp: 2,
    inputs: { progress: 0.5, translationX: -8 },
    outputs: { opacity: 0.6000000000000001, translateX: -16, distance: 8 },
    timingActive: false,
    timingProgress: 0,
  });

  disposeOwner();
  assert.equal(session.disposed, true);
  assert.equal(host.activeGraphCount, 0);
});

test("rejects an owned session without a Solid owner before installation", () => {
  const host = createInMemoryUIWorkletHost();
  const graph = createUIWorkletGraph(animationGraph());

  assert.throws(
    () => createOwnedUIWorkletSession(host, graph),
    /requires an active Solid owner/,
  );
  assert.equal(host.activeGraphCount, 0);
});

test("fails a Solid bridge closed and isolates its diagnostic hook", async () => {
  const host = createInMemoryUIWorkletHost();
  const errors = [];
  let diagnosticRejectionHandled = false;
  let disposeOwner;
  let setInputs;
  let session;
  createRoot((dispose) => {
    disposeOwner = dispose;
    const [inputs, set] = createSignal({ numerator: 10, denominator: 2 });
    setInputs = set;
    session = createSolidUIWorklet(host, divisionGraph(), inputs, {
      onError(error) {
        errors.push(error);
        return {
          then(_resolve, reject) {
            diagnosticRejectionHandled = true;
            reject(new Error("diagnostic failure"));
          },
        };
      },
    });
  });
  await flush();
  setInputs({ numerator: 10, denominator: 0 });
  await flush();

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /division by zero/);
  assert.equal(session.disposed, true);
  assert.equal(host.activeGraphCount, 0);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(diagnosticRejectionHandled, true);
  disposeOwner();
});

test("isolates owned worklet cleanup and asynchronous diagnostic failures", async () => {
  const cleanupFailure = new Error("native worklet cleanup failed");
  const errors = [];
  let destroyCalls = 0;
  let diagnosticRejectionHandled = false;
  const host = {
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    installGraph() {
      return 1;
    },
    updateGraphInputs() {},
    destroyGraph() {
      destroyCalls++;
      throw cleanupFailure;
    },
  };
  let disposeOwner;
  let session;
  createRoot((dispose) => {
    disposeOwner = dispose;
    session = createOwnedUIWorkletSession(
      host,
      createUIWorkletGraph(animationGraph()),
      {
        onError(error) {
          errors.push(error);
          return {
            then(_resolve, reject) {
              diagnosticRejectionHandled = true;
              reject(new Error("diagnostic failure"));
            },
          };
        },
      },
    );
  });

  disposeOwner();
  assert.equal(session.disposed, true);
  assert.equal(destroyCalls, 1);
  assert.deepEqual(errors, [cleanupFailure]);
  session.dispose();
  assert.equal(destroyCalls, 1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(diagnosticRejectionHandled, true);
});

test("adapts a complete React Native binding to one native node", () => {
  const calls = [];
  const binding = {
    installUIWorklet(target, graph) {
      calls.push(["install", target, graph]);
      return 17;
    },
    updateUIWorkletInputs(handle, inputs, timestamp) {
      calls.push(["update", handle, [...inputs], timestamp]);
    },
    animateUIWorkletInputs(handle, inputs, timestamp, timing) {
      calls.push(["animate", handle, [...inputs], timestamp, timing]);
    },
    animateUIWorkletKeyframes(handle, keyframes, timestamp) {
      calls.push(["keyframes", handle, keyframes, timestamp]);
    },
    springUIWorkletInputs(handle, inputs, timestamp, spring) {
      calls.push(["spring", handle, [...inputs], timestamp, spring]);
    },
    decayUIWorkletInputs(handle, velocities, timestamp, decay) {
      calls.push(["decay", handle, [...velocities], timestamp, decay]);
    },
    cancelUIWorkletAnimation(handle, timestamp) {
      calls.push(["cancel", handle, timestamp]);
      return [0.4, -0.2];
    },
    detachUIWorkletPanGesture(handle, timestamp) {
      calls.push(["detach-pan", handle, timestamp]);
      return [0.2, 0.3];
    },
    attachUIWorkletPanGesture(handle, gesture) {
      calls.push(["attach-pan", handle, gesture]);
    },
    destroyUIWorklet(handle) {
      calls.push(["destroy", handle]);
    },
    getUIWorkletInfo(handle) {
      calls.push(["inspect", handle]);
      return {
        handle,
        target: 41,
        sequence: 2,
        appliedSequence: 2,
        applied: true,
        frameTimeNanoseconds: 123_456,
        timestamp: 20,
        timingActive: false,
        timingProgress: 1,
        timingFrameStatistics: {
          frameCount: 3,
          intervalCount: 2,
          sampledIntervalCount: 2,
          droppedIntervalSampleCount: 0,
          firstFrameTimeMilliseconds: 100,
          lastFrameTimeMilliseconds: 116.7,
          minimumFrameIntervalMilliseconds: 8,
          maximumFrameIntervalMilliseconds: 8.7,
          meanFrameIntervalMilliseconds: 8.35,
          p50FrameIntervalMilliseconds: 8,
          p95FrameIntervalMilliseconds: 8.7,
          p99FrameIntervalMilliseconds: 8.7,
        },
        springActive: false,
        springPosition: 1,
        springVelocity: 0,
        springFrameStatistics: {
          frameCount: 4,
          intervalCount: 3,
          sampledIntervalCount: 3,
          droppedIntervalSampleCount: 0,
          firstFrameTimeMilliseconds: 200,
          lastFrameTimeMilliseconds: 225,
          minimumFrameIntervalMilliseconds: 8,
          maximumFrameIntervalMilliseconds: 8.5,
          meanFrameIntervalMilliseconds: 25 / 3,
          p50FrameIntervalMilliseconds: 8.3,
          p95FrameIntervalMilliseconds: 8.5,
          p99FrameIntervalMilliseconds: 8.5,
        },
        decayActive: false,
        decayElapsedMilliseconds: 1_150,
        decaySpeed: 0,
        decayFrameStatistics: {
          frameCount: 5,
          intervalCount: 4,
          sampledIntervalCount: 4,
          droppedIntervalSampleCount: 0,
          firstFrameTimeMilliseconds: 300,
          lastFrameTimeMilliseconds: 333.4,
          minimumFrameIntervalMilliseconds: 8,
          maximumFrameIntervalMilliseconds: 8.9,
          meanFrameIntervalMilliseconds: 8.35,
          p50FrameIntervalMilliseconds: 8.3,
          p95FrameIntervalMilliseconds: 8.9,
          p99FrameIntervalMilliseconds: 8.9,
        },
        gestureAttached: true,
        gestureActive: false,
        gestureSequence: 3,
        gestureTimestamp: 456,
        outputs: { opacity: 0.6 },
      };
    },
  };
  const host = createNativeBindingUIWorkletHost(binding, 41);
  const graph = createUIWorkletGraph({
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    inputs: [
      { name: "progress", initialValue: 0 },
      { name: "secondary", initialValue: 0 },
    ],
    outputs: [
      {
        name: "opacity",
        expression: { kind: "input", name: "progress" },
      },
    ],
  });
  const session = createUIWorkletSession(host, graph, { clock: () => 20 });
  session.update({ progress: 0.6 });
  session.animate(
    { progress: 1 },
    { durationMilliseconds: 250, easing: "ease-in-out" },
  );
  session.animateKeyframes([
    {
      inputs: { progress: 0.5 },
      timing: { durationMilliseconds: 100, easing: "linear" },
    },
    {
      inputs: { progress: 1 },
      timing: { durationMilliseconds: 200, easing: "ease-out" },
    },
  ]);
  session.spring(
    { secondary: 1 },
    {
      mass: 1,
      stiffness: 100,
      damping: 10,
      initialVelocity: 0,
      restSpeedThreshold: 0.01,
      restDisplacementThreshold: 0.001,
      maximumDurationMilliseconds: 5_000,
    },
  );
  session.decay(
    { secondary: -20 },
    {
      deceleration: 2,
      velocityThreshold: 2,
      maximumDurationMilliseconds: 5_000,
    },
  );
  session.cancel();
  assert.deepEqual(session.inputs, { progress: 0.4, secondary: -0.2 });
  session.attachPanGesture({
    xInput: "progress",
    yInput: "secondary",
    minX: 0,
    maxX: 1,
    minY: -1,
    maxY: 1,
    releaseDecay: {
      deceleration: 3,
      velocityThreshold: 2,
      maximumDurationMilliseconds: 1_000,
    },
  });
  session.detachPanGesture();
  assert.equal(session.nativeInputsOwned, false);
  assert.deepEqual(session.inputs, { progress: 0.2, secondary: 0.3 });
  const snapshot = host.inspectGraph(session.handle);

  assert.equal(session.handle, 17);
  assert.equal(host.target, 41);
  assert.equal(calls[0][0], "install");
  assert.equal(calls[0][1], 41);
  assert.notEqual(calls[0][2], graph);
  assert.deepEqual(calls[1], ["update", 17, [0.6, 0], 20]);
  assert.deepEqual(calls[2], [
    "animate",
    17,
    [1, 0],
    20,
    { durationMilliseconds: 250, easing: "ease-in-out" },
  ]);
  assert.deepEqual(calls[3], [
    "keyframes",
    17,
    [
      {
        inputs: [0.5, 0],
        timing: { durationMilliseconds: 100, easing: "linear" },
      },
      {
        inputs: [1, 0],
        timing: { durationMilliseconds: 200, easing: "ease-out" },
      },
    ],
    20,
  ]);
  assert.deepEqual(calls[4], [
    "spring",
    17,
    [1, 1],
    20,
    {
      mass: 1,
      stiffness: 100,
      damping: 10,
      initialVelocity: 0,
      restSpeedThreshold: 0.01,
      restDisplacementThreshold: 0.001,
      maximumDurationMilliseconds: 5_000,
    },
  ]);
  assert.deepEqual(calls[5], [
    "decay",
    17,
    [0, -20],
    20,
    {
      deceleration: 2,
      velocityThreshold: 2,
      maximumDurationMilliseconds: 5_000,
    },
  ]);
  assert.deepEqual(calls[6], ["cancel", 17, 20]);
  assert.deepEqual(calls[7], [
    "attach-pan",
    17,
    {
      xInput: "progress",
      yInput: "secondary",
      minX: 0,
      maxX: 1,
      minY: -1,
      maxY: 1,
      releaseDecay: {
        deceleration: 3,
        velocityThreshold: 2,
        maximumDurationMilliseconds: 1_000,
      },
    },
  ]);
  assert.deepEqual(calls[8], ["detach-pan", 17, 20]);
  assert.deepEqual(snapshot, {
    handle: 17,
    target: 41,
    sequence: 2,
    appliedSequence: 2,
    applied: true,
    frameTimeNanoseconds: 123_456,
    timestamp: 20,
    timingActive: false,
    timingProgress: 1,
    timingFrameStatistics: {
      frameCount: 3,
      intervalCount: 2,
      sampledIntervalCount: 2,
      droppedIntervalSampleCount: 0,
      firstFrameTimeMilliseconds: 100,
      lastFrameTimeMilliseconds: 116.7,
      minimumFrameIntervalMilliseconds: 8,
      maximumFrameIntervalMilliseconds: 8.7,
      meanFrameIntervalMilliseconds: 8.35,
      p50FrameIntervalMilliseconds: 8,
      p95FrameIntervalMilliseconds: 8.7,
      p99FrameIntervalMilliseconds: 8.7,
    },
    springActive: false,
    springPosition: 1,
    springVelocity: 0,
    springFrameStatistics: {
      frameCount: 4,
      intervalCount: 3,
      sampledIntervalCount: 3,
      droppedIntervalSampleCount: 0,
      firstFrameTimeMilliseconds: 200,
      lastFrameTimeMilliseconds: 225,
      minimumFrameIntervalMilliseconds: 8,
      maximumFrameIntervalMilliseconds: 8.5,
      meanFrameIntervalMilliseconds: 25 / 3,
      p50FrameIntervalMilliseconds: 8.3,
      p95FrameIntervalMilliseconds: 8.5,
      p99FrameIntervalMilliseconds: 8.5,
    },
    decayActive: false,
    decayElapsedMilliseconds: 1_150,
    decaySpeed: 0,
    decayFrameStatistics: {
      frameCount: 5,
      intervalCount: 4,
      sampledIntervalCount: 4,
      droppedIntervalSampleCount: 0,
      firstFrameTimeMilliseconds: 300,
      lastFrameTimeMilliseconds: 333.4,
      minimumFrameIntervalMilliseconds: 8,
      maximumFrameIntervalMilliseconds: 8.9,
      meanFrameIntervalMilliseconds: 8.35,
      p50FrameIntervalMilliseconds: 8.3,
      p95FrameIntervalMilliseconds: 8.9,
      p99FrameIntervalMilliseconds: 8.9,
    },
    gestureAttached: true,
    gestureActive: false,
    gestureSequence: 3,
    gestureTimestamp: 456,
    outputs: { opacity: 0.6 },
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.outputs), true);
  assert.equal(Object.isFrozen(snapshot.timingFrameStatistics), true);
  assert.equal(Object.isFrozen(snapshot.springFrameStatistics), true);
  assert.equal(Object.isFrozen(snapshot.decayFrameStatistics), true);
  session.dispose();
  assert.deepEqual(calls.at(-1), ["destroy", 17]);
});

test("rejects partial or malformed native UI worklet bindings", () => {
  assert.throws(
    () =>
      createNativeBindingUIWorkletHost(
        {
          installUIWorklet() {
            return 1;
          },
        },
        1,
      ),
    /complete native UI worklet protocol/,
  );
  assert.throws(
    () => createNativeBindingUIWorkletHost({}, 0),
    /positive safe integer/,
  );
});

test("rejects incomplete or inconsistent native timing frame statistics", () => {
  const validStatistics = {
    frameCount: 3,
    intervalCount: 2,
    sampledIntervalCount: 2,
    droppedIntervalSampleCount: 0,
    firstFrameTimeMilliseconds: 100,
    lastFrameTimeMilliseconds: 116.7,
    minimumFrameIntervalMilliseconds: 8,
    maximumFrameIntervalMilliseconds: 8.7,
    meanFrameIntervalMilliseconds: 8.35,
    p50FrameIntervalMilliseconds: 8,
    p95FrameIntervalMilliseconds: 8.7,
    p99FrameIntervalMilliseconds: 8.7,
  };
  const statisticsCases = [
    { ...validStatistics, intervalCount: 3 },
    { ...validStatistics, sampledIntervalCount: 1 },
    { ...validStatistics, p95FrameIntervalMilliseconds: 7 },
    { ...validStatistics, frameCount: Number.MAX_SAFE_INTEGER + 1 },
    Object.fromEntries(
      Object.entries(validStatistics).filter(
        ([key]) => key !== "p99FrameIntervalMilliseconds",
      ),
    ),
    { ...validStatistics, extra: true },
  ];

  for (const timingFrameStatistics of statisticsCases) {
    const host = createNativeBindingUIWorkletHost(
      {
        installUIWorklet() {
          return 1;
        },
        updateUIWorkletInputs() {},
        destroyUIWorklet() {},
        getUIWorkletInfo() {
          return {
            handle: 1,
            target: 2,
            sequence: 1,
            appliedSequence: 1,
            applied: true,
            frameTimeNanoseconds: 1,
            timingActive: false,
            timingProgress: 1,
            timingFrameStatistics,
            outputs: { opacity: 1 },
          };
        },
      },
      2,
    );
    assert.throws(() => host.inspectGraph(1), /timing frame/);
  }
});

test("rejects partial or conflicting native spring snapshots", () => {
  const springCases = [
    { springActive: true },
    {
      springActive: true,
      springPosition: Number.POSITIVE_INFINITY,
      springVelocity: 0,
    },
    {
      springActive: true,
      springPosition: 0.5,
      springVelocity: 1,
      timingActive: true,
    },
    {
      springActive: false,
      springPosition: 1,
      springVelocity: 0,
      springFrameStatistics: { frameCount: 1 },
    },
  ];

  for (const spring of springCases) {
    const host = createNativeBindingUIWorkletHost(
      {
        installUIWorklet() {
          return 1;
        },
        updateUIWorkletInputs() {},
        destroyUIWorklet() {},
        getUIWorkletInfo() {
          return {
            handle: 1,
            target: 2,
            sequence: 1,
            appliedSequence: 1,
            applied: true,
            frameTimeNanoseconds: 1,
            timingActive: false,
            timingProgress: 0,
            outputs: { opacity: 1 },
            ...spring,
          };
        },
      },
      2,
    );
    assert.throws(() => host.inspectGraph(1), /spring|timing frame/);
  }
});

test("rejects partial or conflicting native decay snapshots", () => {
  const decayCases = [
    { decayActive: true },
    {
      decayActive: true,
      decayElapsedMilliseconds: -1,
      decaySpeed: 10,
    },
    {
      decayActive: true,
      decayElapsedMilliseconds: 100,
      decaySpeed: Number.POSITIVE_INFINITY,
    },
    {
      decayActive: true,
      decayElapsedMilliseconds: 100,
      decaySpeed: 10,
      timingActive: true,
    },
    {
      decayActive: true,
      decayElapsedMilliseconds: 100,
      decaySpeed: 10,
      springActive: true,
      springPosition: 0.5,
      springVelocity: 1,
    },
    {
      decayActive: false,
      decayElapsedMilliseconds: 1_000,
      decaySpeed: 0,
      decayFrameStatistics: { frameCount: 1 },
    },
  ];

  for (const decay of decayCases) {
    const host = createNativeBindingUIWorkletHost(
      {
        installUIWorklet() {
          return 1;
        },
        updateUIWorkletInputs() {},
        destroyUIWorklet() {},
        getUIWorkletInfo() {
          return {
            handle: 1,
            target: 2,
            sequence: 1,
            appliedSequence: 1,
            applied: true,
            frameTimeNanoseconds: 1,
            timingActive: false,
            timingProgress: 0,
            outputs: { opacity: 1 },
            ...decay,
          };
        },
      },
      2,
    );
    assert.throws(() => host.inspectGraph(1), /decay|spring|timing frame/);
  }
});
