/** @jsxImportSource @solid-native/core */
import "react-native/setup-env";

import {
  UI_WORKLET_PROTOCOL_VERSION,
  createUIWorkletGraph,
  type UIWorkletSession,
} from "@solid-native/animation";
import {
  createNativeViewUIWorkletHost,
  type NativeViewUIWorkletHost,
  type NativeViewUIWorkletSnapshot,
} from "@solid-native/animation/react-native";
import {
  createNativeViewAnimation,
  type NativeViewAnimation,
} from "@solid-native/animation/native";
import { createOwnedUIWorkletSession } from "@solid-native/animation/solid";
import {
  CORE_COMPONENT_DESCRIPTORS,
  Pressable,
  Text,
  View,
  type NativeNode,
} from "@solid-native/core";
import { createSignal, type NativeApplication } from "@solid-native/renderer";
import {
  createNativeFabricHost,
  getNativeHostBinding,
  startApplication,
} from "@solid-native/runtime";
import { getOwner, runWithOwner, type Owner } from "solid-js";

const READY_TEXT = "Native UI worklet ready for installation";
const INITIAL_TEXT = "Native UI worklet initial frame applied";
const UPDATED_TEXT = "Native UI worklet update frame applied";
const TIMING_TEXT = "Native UI worklet timing completed";
const STABILITY_TEXT = "Native UI worklet stability completed";
const KEYFRAMES_TEXT = "Native UI worklet keyframes completed";
const SPRING_TEXT = "Native UI worklet spring completed";
const DECAY_TEXT = "Native UI worklet decay completed";
const GESTURE_READY_TEXT = "Native UI worklet pan ready";
const GESTURE_TEXT = "Native UI worklet pan completed";
const TARGET_LABEL = "Solid Native UI worklet target";
const INSTALL_LABEL = "Install native UI worklet";
const UPDATE_LABEL = "Update native UI worklet";
const TIMING_LABEL = "Animate native UI worklet";
const STABILITY_LABEL = "Measure native UI worklet stability";
const KEYFRAMES_LABEL = "Keyframe native UI worklet";
const SPRING_LABEL = "Spring native UI worklet";
const DECAY_LABEL = "Decay native UI worklet";
const GESTURE_LABEL = "Bind native UI worklet pan";
const DISPOSE_LABEL = "Dispose native UI worklet proof";
const STABILITY_DURATION_MS = 5_000;
const PROOF_TIMEOUT_MS = 10_000;

const graph = createUIWorkletGraph(
  { progress: 0, offset: 0, offsetY: 0 },
  ({ progress, offset, offsetY }, { interpolate, multiply }) => ({
    opacity: interpolate(progress, [0, 1], [0.25, 1]),
    translateX: offset,
    translateY: offsetY,
    scaleX: interpolate(progress, [0, 1], [1, 1.2]),
    scaleY: interpolate(progress, [0, 1], [1, 1.2]),
    rotation: multiply(progress, 8),
  }),
);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSurface(): Promise<
  ReturnType<typeof getNativeHostBinding>
> {
  const binding = getNativeHostBinding();
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (!binding.getSurfaceInfo().ready) {
    if (Date.now() >= deadline) {
      throw new Error("The native Fabric surface did not become ready.");
    }
    await delay(10);
  }
  return binding;
}

function assertIdleNativeWorkletScheduler(
  binding: ReturnType<typeof getNativeHostBinding>,
  context: string,
): void {
  const info = binding.getSurfaceInfo();
  if (info.pendingUIWorkletFrameCount !== 0) {
    throw new Error(
      `${context} left ${String(info.pendingUIWorkletFrameCount)} native UI worklet frames pending.`,
    );
  }
}

async function waitForAppliedFrame(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<NativeViewUIWorkletSnapshot> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      snapshot.frameTimeNanoseconds > 0
    ) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error("The native UI worklet frame was not applied in time.");
    }
    await delay(10);
  }
}

async function waitForProductAnimationFrame(
  animation: NativeViewAnimation,
  afterSequence: number,
): Promise<NativeViewUIWorkletSnapshot> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (true) {
    const snapshot = animation.inspect();
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      snapshot.frameTimeNanoseconds > 0
    ) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error("The product animation frame did not apply in time.");
    }
    await delay(10);
  }
}

async function waitForActiveTimingFrame(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<NativeViewUIWorkletSnapshot> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      snapshot.timingActive &&
      snapshot.timingProgress > 0 &&
      snapshot.timingProgress < 1
    ) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error("The native UI worklet timing did not advance in time.");
    }
    await delay(10);
  }
}

async function waitForCompletedTiming(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<NativeViewUIWorkletSnapshot> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      !snapshot.timingActive &&
      snapshot.timingProgress === 1
    ) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error("The native UI worklet timing did not complete in time.");
    }
    await delay(10);
  }
}

async function waitForCompletedKeyframes(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<{
  readonly maximumTranslateX: number;
  readonly minimumTranslateX: number;
  readonly snapshot: NativeViewUIWorkletSnapshot;
}> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  let maximumTranslateX = Number.NEGATIVE_INFINITY;
  let minimumTranslateX = Number.POSITIVE_INFINITY;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    const translateX = snapshot.outputs.translateX;
    if (translateX !== undefined && snapshot.sequence > afterSequence) {
      maximumTranslateX = Math.max(maximumTranslateX, translateX);
      minimumTranslateX = Math.min(minimumTranslateX, translateX);
    }
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      !snapshot.timingActive &&
      snapshot.timingProgress === 1
    ) {
      return { maximumTranslateX, minimumTranslateX, snapshot };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "The native UI worklet keyframes did not complete in time.",
      );
    }
    await delay(10);
  }
}

async function waitForCompletedSpring(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<{
  readonly maximumPosition: number;
  readonly minimumTranslateX: number;
  readonly snapshot: NativeViewUIWorkletSnapshot;
}> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  let maximumPosition = 0;
  let minimumTranslateX = Number.POSITIVE_INFINITY;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    if (snapshot.springPosition !== undefined) {
      maximumPosition = Math.max(maximumPosition, snapshot.springPosition);
    }
    if (snapshot.outputs.translateX !== undefined) {
      minimumTranslateX = Math.min(
        minimumTranslateX,
        snapshot.outputs.translateX,
      );
    }
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      snapshot.springActive === false &&
      snapshot.springPosition === 1 &&
      snapshot.springVelocity === 0
    ) {
      return { maximumPosition, minimumTranslateX, snapshot };
    }
    if (Date.now() >= deadline) {
      throw new Error("The native UI worklet spring did not settle in time.");
    }
    await delay(10);
  }
}

async function waitForActiveSpringFrame(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<NativeViewUIWorkletSnapshot> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      snapshot.springActive === true &&
      snapshot.springPosition !== undefined &&
      snapshot.springPosition > 0 &&
      snapshot.springPosition < 1
    ) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error("The native UI worklet spring did not advance in time.");
    }
    await delay(10);
  }
}

async function waitForActiveDecayFrame(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<NativeViewUIWorkletSnapshot> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      snapshot.decayActive === true &&
      (snapshot.decayElapsedMilliseconds ?? 0) > 0 &&
      (snapshot.decaySpeed ?? 0) > 0
    ) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error("The native UI worklet decay did not advance in time.");
    }
    await delay(10);
  }
}

async function waitForCompletedDecay(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<NativeViewUIWorkletSnapshot> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      snapshot.decayActive === false &&
      snapshot.decaySpeed === 0
    ) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error("The native UI worklet decay did not settle in time.");
    }
    await delay(10);
  }
}

async function waitForCompletedPan(
  host: NativeViewUIWorkletHost,
  handle: number,
  afterSequence: number,
): Promise<NativeViewUIWorkletSnapshot> {
  const deadline = Date.now() + PROOF_TIMEOUT_MS;
  while (true) {
    const snapshot = host.inspectGraph(handle);
    if (
      snapshot.applied &&
      snapshot.sequence > afterSequence &&
      snapshot.appliedSequence === snapshot.sequence &&
      snapshot.gestureAttached === true &&
      snapshot.gestureActive === false &&
      (snapshot.gestureSequence ?? 0) > 0 &&
      (snapshot.gestureTimestamp ?? 0) > 0
    ) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error("The native UI worklet pan did not complete in time.");
    }
    await delay(10);
  }
}

function reportFatal(error: unknown): void {
  console.error("SOLID_NATIVE_UI_WORKLET_FAILED", error);
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
}

function WorkletOwnerCapture(props: {
  readonly capture: (owner: Owner) => void;
}): null {
  const owner = getOwner();
  if (owner === null) {
    throw new Error("The native UI worklet proof did not create an owner.");
  }
  props.capture(owner);
  return null;
}

function ProductAnimationTarget(props: {
  readonly capture: (animation: NativeViewAnimation) => void;
  readonly onTarget: (node: NativeNode) => void;
}) {
  const animation = createNativeViewAnimation(graph, {
    onError: reportFatal,
    reduceMotion: () => true,
  });
  props.capture(animation);
  return (
    <View
      accessible
      accessibilityLabel={TARGET_LABEL}
      ref={(node) => {
        props.onTarget(node);
        animation.ref(node);
      }}
      style={{
        backgroundColor: "#2563eb",
        borderRadius: 12,
        height: 96,
        marginBottom: 24,
        width: 160,
      }}
    />
  );
}

async function run(): Promise<void> {
  const binding = await waitForSurface();
  const host = createNativeFabricHost({
    binding,
    descriptors: CORE_COMPONENT_DESCRIPTORS,
  });
  if (!host.capabilities.uiWorklets) {
    throw new Error("The native Fabric host did not publish UI worklets.");
  }

  let application: NativeApplication;
  let target: NativeNode | undefined;
  let productAnimation: NativeViewAnimation | undefined;
  let workletHost: NativeViewUIWorkletHost | undefined;
  let session: UIWorkletSession | undefined;
  let workletOwner: Owner | null = null;
  const [status, setStatus] = createSignal(READY_TEXT);

  const install = (): void => {
    if (session !== undefined || target === undefined) return;
    try {
      const owner = workletOwner;
      if (owner === null) {
        throw new Error("The native UI worklet proof has no Solid owner.");
      }
      const nextWorkletHost = createNativeViewUIWorkletHost(target);
      const nextSession = runWithOwner(owner, () =>
        createOwnedUIWorkletSession(nextWorkletHost, graph, {
          onError: reportFatal,
        }),
      );
      workletHost = nextWorkletHost;
      session = nextSession;
      const installedHost = nextWorkletHost;
      const installedSession = nextSession;
      void waitForAppliedFrame(installedHost, installedSession.handle, 0)
        .then(async (snapshot) => {
          if (
            snapshot.outputs.opacity !== 0.25 ||
            snapshot.outputs.translateX !== 0 ||
            snapshot.outputs.translateY !== 0 ||
            snapshot.outputs.scaleX !== 1 ||
            snapshot.outputs.scaleY !== 1 ||
            snapshot.outputs.rotation !== 0
          ) {
            throw new Error("The native initial worklet outputs were wrong.");
          }
          assertIdleNativeWorkletScheduler(binding, "The initial frame");
          setStatus(INITIAL_TEXT);
          await application.root.flush();
          console.log(
            "SOLID_NATIVE_UI_WORKLET_INITIAL_SUCCEEDED",
            JSON.stringify(snapshot),
          );
        })
        .catch(reportFatal);
    } catch (error) {
      reportFatal(error);
    }
  };

  const update = (): void => {
    if (session === undefined || workletHost === undefined) return;
    try {
      const previousSequence = workletHost.inspectGraph(
        session.handle,
      ).sequence;
      session.update({ progress: 1, offset: 12 }, 1);
      const updatedHost = workletHost;
      const updatedSession = session;
      void waitForAppliedFrame(
        updatedHost,
        updatedSession.handle,
        previousSequence,
      )
        .then(async (snapshot) => {
          if (
            snapshot.timestamp !== 1 ||
            snapshot.outputs.opacity !== 1 ||
            snapshot.outputs.translateX !== 12 ||
            snapshot.outputs.translateY !== 0 ||
            snapshot.outputs.scaleX !== 1.2 ||
            snapshot.outputs.scaleY !== 1.2 ||
            snapshot.outputs.rotation !== 8
          ) {
            throw new Error("The native updated worklet outputs were wrong.");
          }
          assertIdleNativeWorkletScheduler(binding, "The updated frame");
          setStatus(UPDATED_TEXT);
          await application.root.flush();
          console.log(
            "SOLID_NATIVE_UI_WORKLET_UPDATE_SUCCEEDED",
            JSON.stringify(snapshot),
          );
        })
        .catch(reportFatal);
    } catch (error) {
      reportFatal(error);
    }
  };

  const animate = (): void => {
    if (session === undefined || workletHost === undefined) return;
    try {
      const previousSequence = workletHost.inspectGraph(
        session.handle,
      ).sequence;
      session.animate(
        { progress: 0, offset: -12 },
        { durationMilliseconds: 1_000, easing: "linear" },
        2,
      );
      const animatedHost = workletHost;
      const animatedSession = session;
      void waitForActiveTimingFrame(
        animatedHost,
        animatedSession.handle,
        previousSequence,
      )
        .then(async (interruptedSnapshot) => {
          animatedSession.cancel(3);
          const cancelled = animatedHost.inspectGraph(animatedSession.handle);
          const frozenInputs = animatedSession.inputs;
          const expectedProgress =
            (interruptedSnapshot.outputs.opacity! - 0.25) / 0.75;
          if (
            cancelled.timestamp !== 3 ||
            cancelled.sequence !== interruptedSnapshot.sequence ||
            cancelled.timingActive ||
            cancelled.timingProgress !== interruptedSnapshot.timingProgress ||
            cancelled.outputs.opacity !== interruptedSnapshot.outputs.opacity ||
            cancelled.outputs.translateX !==
              interruptedSnapshot.outputs.translateX ||
            cancelled.outputs.translateY !==
              interruptedSnapshot.outputs.translateY ||
            Math.abs(frozenInputs.progress! - expectedProgress) > 1e-9 ||
            frozenInputs.offset !== interruptedSnapshot.outputs.translateX ||
            frozenInputs.offsetY !== interruptedSnapshot.outputs.translateY
          ) {
            throw new Error(
              "The native timing cancellation did not freeze and synchronize atomically.",
            );
          }
          await delay(50);
          const held = animatedHost.inspectGraph(animatedSession.handle);
          if (
            held.sequence !== cancelled.sequence ||
            held.outputs.opacity !== cancelled.outputs.opacity ||
            held.outputs.translateX !== cancelled.outputs.translateX ||
            held.outputs.translateY !== cancelled.outputs.translateY
          ) {
            throw new Error("The cancelled native timing continued to move.");
          }
          assertIdleNativeWorkletScheduler(binding, "The cancelled timing");
          console.log(
            "SOLID_NATIVE_UI_WORKLET_CANCELLATION_SUCCEEDED",
            JSON.stringify({ interruptedSnapshot, cancelled, frozenInputs }),
          );
          animatedSession.animate(
            { progress: 0.5, offset: -8 },
            { durationMilliseconds: 220, easing: "ease-out" },
            4,
          );
          const replacement = animatedHost.inspectGraph(animatedSession.handle);
          if (
            replacement.timestamp !== 4 ||
            !replacement.timingActive ||
            replacement.timingProgress !== 0
          ) {
            throw new Error("The native timing did not interrupt atomically.");
          }
          return waitForCompletedTiming(
            animatedHost,
            animatedSession.handle,
            interruptedSnapshot.sequence,
          );
        })
        .then(async (snapshot) => {
          if (
            snapshot.timestamp !== 4 ||
            snapshot.outputs.opacity !== 0.625 ||
            snapshot.outputs.translateX !== -8 ||
            snapshot.outputs.translateY !== 0 ||
            snapshot.outputs.scaleX !== 1.1 ||
            snapshot.outputs.scaleY !== 1.1 ||
            snapshot.outputs.rotation !== 4
          ) {
            throw new Error("The native timing endpoint was wrong.");
          }
          assertIdleNativeWorkletScheduler(binding, "The completed timing");
          setStatus(TIMING_TEXT);
          await application.root.flush();
          console.log(
            "SOLID_NATIVE_UI_WORKLET_TIMING_SUCCEEDED",
            JSON.stringify(snapshot),
          );
        })
        .catch(reportFatal);
    } catch (error) {
      reportFatal(error);
    }
  };

  const measureStability = (): void => {
    if (session === undefined || workletHost === undefined) return;
    try {
      const measuredHost = workletHost;
      const measuredSession = session;
      const previousSequence = measuredHost.inspectGraph(
        measuredSession.handle,
      ).sequence;
      measuredSession.animate(
        { progress: 0.75, offset: 8 },
        {
          durationMilliseconds: STABILITY_DURATION_MS,
          easing: "linear",
        },
        5,
      );
      void waitForCompletedTiming(
        measuredHost,
        measuredSession.handle,
        previousSequence,
      )
        .then(async (snapshot) => {
          const statistics = snapshot.timingFrameStatistics;
          if (statistics === undefined) {
            throw new Error("The native timing omitted frame statistics.");
          }
          const elapsed =
            statistics.lastFrameTimeMilliseconds -
            statistics.firstFrameTimeMilliseconds;
          const highRefresh = statistics.p50FrameIntervalMilliseconds <= 10;
          const minimumFrameCount = highRefresh ? 500 : 270;
          const maximumMeanInterval = highRefresh ? 10.5 : 18.75;
          const maximumP95Interval = highRefresh ? 17 : 25;
          const maximumP99Interval = highRefresh ? 25 : 34;
          if (
            snapshot.timestamp !== 5 ||
            snapshot.outputs.opacity !== 0.8125 ||
            snapshot.outputs.translateX !== 8 ||
            snapshot.outputs.translateY !== 0 ||
            snapshot.outputs.scaleX !== 1.15 ||
            snapshot.outputs.scaleY !== 1.15 ||
            snapshot.outputs.rotation !== 6 ||
            elapsed < STABILITY_DURATION_MS - 1 ||
            statistics.frameCount < minimumFrameCount ||
            statistics.intervalCount !== statistics.frameCount - 1 ||
            statistics.sampledIntervalCount !== statistics.intervalCount ||
            statistics.droppedIntervalSampleCount !== 0 ||
            statistics.meanFrameIntervalMilliseconds > maximumMeanInterval ||
            statistics.p95FrameIntervalMilliseconds > maximumP95Interval ||
            statistics.p99FrameIntervalMilliseconds > maximumP99Interval
          ) {
            throw new Error("The sustained native timing was not stable.");
          }
          assertIdleNativeWorkletScheduler(
            binding,
            "The completed stability timing",
          );
          setStatus(STABILITY_TEXT);
          await application.root.flush();
          console.log(
            "SOLID_NATIVE_UI_WORKLET_STABILITY_SUCCEEDED",
            JSON.stringify({
              cadence: highRefresh ? "high-refresh" : "standard-refresh",
              ...statistics,
            }),
          );
        })
        .catch(reportFatal);
    } catch (error) {
      reportFatal(error);
    }
  };

  const animateKeyframes = (): void => {
    if (session === undefined || workletHost === undefined) return;
    try {
      const keyframedHost = workletHost;
      const keyframedSession = session;
      const previousSequence = keyframedHost.inspectGraph(
        keyframedSession.handle,
      ).sequence;
      keyframedSession.animateKeyframes(
        [
          {
            inputs: { progress: 0.25, offset: 32, offsetY: -12 },
            timing: { durationMilliseconds: 400, easing: "linear" },
          },
          {
            inputs: { progress: 1, offset: -20 },
            timing: { durationMilliseconds: 400, easing: "ease-out" },
          },
          {
            inputs: { offset: 4, offsetY: 0 },
            timing: { durationMilliseconds: 400, easing: "linear" },
          },
        ],
        6,
      );
      void waitForCompletedKeyframes(
        keyframedHost,
        keyframedSession.handle,
        previousSequence,
      )
        .then(async ({ maximumTranslateX, minimumTranslateX, snapshot }) => {
          const statistics = snapshot.timingFrameStatistics;
          if (
            snapshot.timestamp !== 6 ||
            snapshot.outputs.opacity !== 1 ||
            snapshot.outputs.translateX !== 4 ||
            snapshot.outputs.translateY !== 0 ||
            snapshot.outputs.scaleX !== 1.2 ||
            snapshot.outputs.scaleY !== 1.2 ||
            snapshot.outputs.rotation !== 8 ||
            maximumTranslateX <= 24 ||
            minimumTranslateX >= -12 ||
            statistics === undefined ||
            statistics.frameCount < 40 ||
            statistics.intervalCount !== statistics.frameCount - 1 ||
            statistics.sampledIntervalCount !== statistics.intervalCount ||
            statistics.droppedIntervalSampleCount !== 0
          ) {
            throw new Error("The native timing keyframe sequence was invalid.");
          }
          assertIdleNativeWorkletScheduler(binding, "The completed keyframes");
          setStatus(KEYFRAMES_TEXT);
          await application.root.flush();
          console.log(
            "SOLID_NATIVE_UI_WORKLET_KEYFRAMES_SUCCEEDED",
            JSON.stringify({
              maximumTranslateX,
              minimumTranslateX,
              ...snapshot,
            }),
          );
        })
        .catch(reportFatal);
    } catch (error) {
      reportFatal(error);
    }
  };

  const spring = (): void => {
    if (session === undefined || workletHost === undefined) return;
    try {
      const sprungHost = workletHost;
      const sprungSession = session;
      const previousSequence = sprungHost.inspectGraph(
        sprungSession.handle,
      ).sequence;
      sprungSession.spring(
        { progress: 0.25, offset: 20 },
        {
          mass: 1,
          stiffness: 80,
          damping: 18,
          initialVelocity: 0,
          restSpeedThreshold: 0.01,
          restDisplacementThreshold: 0.001,
          maximumDurationMilliseconds: 5_000,
        },
        7,
      );
      void waitForActiveSpringFrame(
        sprungHost,
        sprungSession.handle,
        previousSequence,
      )
        .then((interruptedSnapshot) => {
          sprungSession.spring(
            { progress: 1, offset: -8 },
            {
              mass: 1,
              stiffness: 100,
              damping: 10,
              initialVelocity: 0,
              restSpeedThreshold: 0.01,
              restDisplacementThreshold: 0.001,
              maximumDurationMilliseconds: 5_000,
            },
            8,
          );
          const replacement = sprungHost.inspectGraph(sprungSession.handle);
          if (
            replacement.timestamp !== 8 ||
            replacement.sequence !== interruptedSnapshot.sequence ||
            replacement.springActive !== true ||
            replacement.springPosition !== 0 ||
            replacement.springVelocity !== 0 ||
            replacement.outputs.opacity !==
              interruptedSnapshot.outputs.opacity ||
            replacement.outputs.translateX !==
              interruptedSnapshot.outputs.translateX
          ) {
            throw new Error("The native spring did not interrupt atomically.");
          }
          return waitForCompletedSpring(
            sprungHost,
            sprungSession.handle,
            interruptedSnapshot.sequence,
          ).then((result) => ({ interruptedSnapshot, ...result }));
        })
        .then(
          async ({
            interruptedSnapshot,
            maximumPosition,
            minimumTranslateX,
            snapshot,
          }) => {
            const statistics = snapshot.springFrameStatistics;
            if (
              snapshot.timestamp !== 8 ||
              snapshot.timingActive ||
              snapshot.timingProgress !== 0 ||
              snapshot.outputs.opacity !== 1 ||
              snapshot.outputs.translateX !== -8 ||
              snapshot.outputs.translateY !== 0 ||
              snapshot.outputs.scaleX !== 1.2 ||
              snapshot.outputs.scaleY !== 1.2 ||
              snapshot.outputs.rotation !== 8 ||
              maximumPosition <= 1.05 ||
              minimumTranslateX >= -8.5 ||
              statistics === undefined ||
              statistics.frameCount < 20 ||
              statistics.intervalCount !== statistics.frameCount - 1 ||
              statistics.sampledIntervalCount !== statistics.intervalCount ||
              statistics.droppedIntervalSampleCount !== 0
            ) {
              throw new Error("The analytical native spring was invalid.");
            }
            assertIdleNativeWorkletScheduler(binding, "The completed spring");
            setStatus(SPRING_TEXT);
            await application.root.flush();
            console.log(
              "SOLID_NATIVE_UI_WORKLET_SPRING_SUCCEEDED",
              JSON.stringify({
                interruptedSequence: interruptedSnapshot.sequence,
                interruptedPosition: interruptedSnapshot.springPosition,
                maximumPosition,
                minimumTranslateX,
                ...snapshot,
              }),
            );
          },
        )
        .catch(reportFatal);
    } catch (error) {
      reportFatal(error);
    }
  };

  const decay = (): void => {
    if (session === undefined || workletHost === undefined) return;
    try {
      const decayedHost = workletHost;
      const decayedSession = session;
      const previousSequence = decayedHost.inspectGraph(
        decayedSession.handle,
      ).sequence;
      const definition = {
        deceleration: 2,
        velocityThreshold: 6,
        maximumDurationMilliseconds: 5_000,
      } as const;
      decayedSession.decay({ offset: 60 }, definition, 9);
      void waitForActiveDecayFrame(
        decayedHost,
        decayedSession.handle,
        previousSequence,
      )
        .then((interruptedSnapshot) => {
          decayedSession.decay({ offset: -60, offsetY: 20 }, definition, 10);
          const replacement = decayedHost.inspectGraph(decayedSession.handle);
          if (
            replacement.timestamp !== 10 ||
            replacement.sequence !== interruptedSnapshot.sequence ||
            replacement.decayActive !== true ||
            replacement.decayElapsedMilliseconds !== 0 ||
            replacement.decaySpeed !== 60 ||
            replacement.outputs.translateX !==
              interruptedSnapshot.outputs.translateX ||
            replacement.outputs.translateY !==
              interruptedSnapshot.outputs.translateY
          ) {
            throw new Error("The native decay did not interrupt atomically.");
          }
          return waitForCompletedDecay(
            decayedHost,
            decayedSession.handle,
            interruptedSnapshot.sequence,
          ).then((snapshot) => ({ interruptedSnapshot, snapshot }));
        })
        .then(async ({ interruptedSnapshot, snapshot }) => {
          const statistics = snapshot.decayFrameStatistics;
          const terminalDisplacementFactorSeconds =
            (1 - definition.velocityThreshold / 60) / definition.deceleration;
          const expectedX =
            interruptedSnapshot.outputs.translateX! -
            60 * terminalDisplacementFactorSeconds;
          const expectedY =
            interruptedSnapshot.outputs.translateY! +
            20 * terminalDisplacementFactorSeconds;
          if (
            snapshot.timestamp !== 10 ||
            snapshot.timingActive ||
            snapshot.timingProgress !== 0 ||
            snapshot.springActive !== undefined ||
            snapshot.decayActive !== false ||
            (snapshot.decayElapsedMilliseconds ?? 0) < 1_150 ||
            snapshot.decaySpeed !== 0 ||
            snapshot.outputs.opacity !== 1 ||
            Math.abs(snapshot.outputs.translateX! - expectedX) > 0.000001 ||
            Math.abs(snapshot.outputs.translateY! - expectedY) > 0.000001 ||
            snapshot.outputs.scaleX !== 1.2 ||
            snapshot.outputs.scaleY !== 1.2 ||
            snapshot.outputs.rotation !== 8 ||
            statistics === undefined ||
            statistics.frameCount < 20 ||
            statistics.intervalCount !== statistics.frameCount - 1 ||
            statistics.sampledIntervalCount !== statistics.intervalCount ||
            statistics.droppedIntervalSampleCount !== 0
          ) {
            throw new Error("The analytical native decay was invalid.");
          }
          assertIdleNativeWorkletScheduler(binding, "The completed decay");
          setStatus(DECAY_TEXT);
          await application.root.flush();
          console.log(
            "SOLID_NATIVE_UI_WORKLET_DECAY_SUCCEEDED",
            JSON.stringify({
              interruptedSequence: interruptedSnapshot.sequence,
              interruptedElapsedMilliseconds:
                interruptedSnapshot.decayElapsedMilliseconds,
              interruptedSpeed: interruptedSnapshot.decaySpeed,
              expectedX,
              expectedY,
              ...snapshot,
            }),
          );
        })
        .catch(reportFatal);
    } catch (error) {
      reportFatal(error);
    }
  };

  const bindPan = (): void => {
    if (session === undefined || workletHost === undefined) return;
    try {
      const pannedHost = workletHost;
      const pannedSession = session;
      const beforeAttachment = pannedHost.inspectGraph(pannedSession.handle);
      const previousSequence = beforeAttachment.sequence;
      const panOriginX = beforeAttachment.outputs.translateX!;
      const panOriginY = beforeAttachment.outputs.translateY!;
      pannedSession.attachPanGesture({
        xInput: "offset",
        yInput: "offsetY",
        minX: -48,
        maxX: 48,
        minY: -48,
        maxY: 48,
        releaseDecay: {
          deceleration: 20,
          velocityThreshold: 5,
          maximumDurationMilliseconds: 250,
        },
      });
      if (!pannedSession.nativeInputsOwned) {
        throw new Error("The native pan did not take input ownership.");
      }
      const attached = pannedHost.inspectGraph(pannedSession.handle);
      if (
        attached.gestureAttached !== true ||
        attached.gestureActive !== false ||
        attached.gestureSequence !== 0 ||
        attached.gestureTimestamp !== undefined
      ) {
        throw new Error("The native pan attachment snapshot was invalid.");
      }
      setStatus(GESTURE_READY_TEXT);
      void application.root
        .flush()
        .then(() => {
          console.log(
            "SOLID_NATIVE_UI_WORKLET_PAN_ATTACHED",
            JSON.stringify(attached),
          );
          return waitForCompletedPan(
            pannedHost,
            pannedSession.handle,
            previousSequence,
          );
        })
        .then((releaseSnapshot) => {
          if (
            releaseSnapshot.decayActive !== true ||
            releaseSnapshot.decayElapsedMilliseconds !== 0 ||
            (releaseSnapshot.decaySpeed ?? 0) <= 0
          ) {
            throw new Error(
              "The native pan did not hand release velocity to decay.",
            );
          }
          return waitForCompletedDecay(
            pannedHost,
            pannedSession.handle,
            releaseSnapshot.sequence,
          ).then((snapshot) => ({ releaseSnapshot, snapshot }));
        })
        .then(async ({ releaseSnapshot, snapshot }) => {
          const translated =
            Math.abs(snapshot.outputs.translateX! - panOriginX) >= 4 ||
            Math.abs(snapshot.outputs.translateY! - panOriginY) >= 4;
          const statistics = snapshot.decayFrameStatistics;
          if (
            snapshot.timestamp !== 10 ||
            snapshot.timingActive ||
            snapshot.timingProgress !== 0 ||
            snapshot.springActive !== undefined ||
            snapshot.decayActive !== false ||
            (snapshot.decayElapsedMilliseconds ?? 0) <= 0 ||
            snapshot.decaySpeed !== 0 ||
            snapshot.outputs.opacity !== 1 ||
            !translated ||
            snapshot.outputs.scaleX !== 1.2 ||
            snapshot.outputs.scaleY !== 1.2 ||
            snapshot.outputs.rotation !== 8 ||
            statistics === undefined ||
            statistics.frameCount < 2 ||
            statistics.intervalCount !== statistics.frameCount - 1
          ) {
            throw new Error(
              `The native pan-to-decay output was wrong: ${JSON.stringify({ panOriginX, panOriginY, releaseSnapshot, snapshot })}`,
            );
          }
          assertIdleNativeWorkletScheduler(
            binding,
            "The completed pan-to-decay handoff",
          );
          pannedSession.detachPanGesture(11);
          const detached = pannedHost.inspectGraph(pannedSession.handle);
          if (
            pannedSession.nativeInputsOwned ||
            detached.timestamp !== 11 ||
            detached.sequence !== snapshot.sequence ||
            detached.gestureAttached !== undefined ||
            detached.outputs.opacity !== snapshot.outputs.opacity ||
            detached.outputs.translateX !== snapshot.outputs.translateX ||
            detached.outputs.translateY !== snapshot.outputs.translateY ||
            pannedSession.inputs.progress !== 1 ||
            pannedSession.inputs.offset !== snapshot.outputs.translateX ||
            pannedSession.inputs.offsetY !== snapshot.outputs.translateY
          ) {
            throw new Error(
              "The native pan did not release synchronized input ownership.",
            );
          }
          pannedSession.update({ offsetY: pannedSession.inputs.offsetY! }, 12);
          const resumed = await waitForAppliedFrame(
            pannedHost,
            pannedSession.handle,
            detached.sequence,
          );
          if (
            resumed.timestamp !== 12 ||
            resumed.gestureAttached !== undefined ||
            resumed.outputs.opacity !== snapshot.outputs.opacity ||
            resumed.outputs.translateX !== snapshot.outputs.translateX ||
            resumed.outputs.translateY !== snapshot.outputs.translateY
          ) {
            throw new Error(
              "Solid did not resume from the detached native pan vector.",
            );
          }
          assertIdleNativeWorkletScheduler(binding, "The detached native pan");
          console.log(
            "SOLID_NATIVE_UI_WORKLET_PAN_DETACHED",
            JSON.stringify({ detached, resumed }),
          );
          setStatus(GESTURE_TEXT);
          await application.root.flush();
          console.log(
            "SOLID_NATIVE_UI_WORKLET_PAN_SUCCEEDED",
            JSON.stringify({ releaseSnapshot, snapshot, detached, resumed }),
          );
        })
        .catch(reportFatal);
    } catch (error) {
      reportFatal(error);
    }
  };

  const dispose = async (): Promise<void> => {
    try {
      await application.dispose();
      const info = binding.getSurfaceInfo();
      if (
        info.ready ||
        info.activeUIWorkletCount !== 0 ||
        info.pendingUIWorkletFrameCount !== 0
      ) {
        throw new Error(
          "The native UI worklet surface did not fully tear down.",
        );
      }
      console.log(
        "SOLID_NATIVE_UI_WORKLET_TEARDOWN_SUCCEEDED",
        JSON.stringify(info),
      );
    } catch (error) {
      reportFatal(error);
    }
  };

  application = startApplication(
    () => (
      <View
        style={{
          alignItems: "center",
          backgroundColor: "#f8fafc",
          flex: 1,
          justifyContent: "center",
          padding: 24,
        }}
      >
        <WorkletOwnerCapture
          capture={(owner) => {
            workletOwner = owner;
          }}
        />
        <Text style={{ color: "#0f172a", fontSize: 18, marginBottom: 20 }}>
          {status()}
        </Text>
        <ProductAnimationTarget
          capture={(animation) => {
            productAnimation = animation;
          }}
          onTarget={(node) => {
            target = node;
          }}
        />
        <Pressable
          accessible
          accessibilityLabel={SPRING_LABEL}
          accessibilityRole="button"
          onPress={spring}
          style={{ backgroundColor: "#9f1239", marginTop: 12, padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>{SPRING_LABEL}</Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={DECAY_LABEL}
          accessibilityRole="button"
          onPress={decay}
          style={{ backgroundColor: "#6d28d9", marginTop: 12, padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>{DECAY_LABEL}</Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={INSTALL_LABEL}
          accessibilityRole="button"
          onPress={install}
          style={{ backgroundColor: "#0f766e", padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>
            {INSTALL_LABEL}
          </Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={UPDATE_LABEL}
          accessibilityRole="button"
          onPress={update}
          style={{ backgroundColor: "#7c3aed", marginTop: 12, padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>{UPDATE_LABEL}</Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={TIMING_LABEL}
          accessibilityRole="button"
          onPress={animate}
          style={{ backgroundColor: "#be123c", marginTop: 12, padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>{TIMING_LABEL}</Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={STABILITY_LABEL}
          accessibilityRole="button"
          onPress={measureStability}
          style={{ backgroundColor: "#a16207", marginTop: 12, padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>
            {STABILITY_LABEL}
          </Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={KEYFRAMES_LABEL}
          accessibilityRole="button"
          onPress={animateKeyframes}
          style={{ backgroundColor: "#047857", marginTop: 12, padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>
            {KEYFRAMES_LABEL}
          </Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={GESTURE_LABEL}
          accessibilityRole="button"
          onPress={bindPan}
          style={{ backgroundColor: "#0369a1", marginTop: 12, padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>
            {GESTURE_LABEL}
          </Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityLabel={DISPOSE_LABEL}
          accessibilityRole="button"
          onPress={dispose}
          style={{ backgroundColor: "#334155", marginTop: 12, padding: 14 }}
        >
          <Text style={{ color: "#ffffff", fontSize: 17 }}>
            {DISPOSE_LABEL}
          </Text>
        </Pressable>
      </View>
    ),
    host,
    {
      surface: {
        name: "native-ui-worklet-proof",
        initialProps: { style: { backgroundColor: "#f8fafc", flex: 1 } },
      },
      autoCommit: false,
      requirements: {
        capabilities: ["uiWorklets"],
        components: ["Pressable", "Text", "View"],
      },
      onCommitError: reportFatal,
    },
  );
  const mount = await application.root.flush();
  if (
    mount?.sequence !== 1 ||
    target === undefined ||
    productAnimation === undefined
  ) {
    throw new Error("The native UI worklet proof did not mount exactly once.");
  }

  const product = productAnimation as NativeViewAnimation;
  if (!(await product.ready) || product.state !== "ready") {
    throw new Error("The product animation API did not install after mount.");
  }
  const productInitial = await waitForProductAnimationFrame(product, 0);
  product.update({ progress: 0.25 }, 0);
  const productImmediate = await waitForProductAnimationFrame(
    product,
    productInitial.sequence,
  );
  product.animate(
    { progress: 0.5 },
    { durationMilliseconds: 1_000, easing: "ease-in-out" },
    1,
  );
  const productUpdated = await waitForProductAnimationFrame(
    product,
    productImmediate.sequence,
  );
  if (
    productImmediate.timestamp !== 0 ||
    productImmediate.outputs.opacity !== 0.4375 ||
    productUpdated.timestamp !== 1 ||
    productUpdated.timingActive ||
    productUpdated.outputs.opacity !== 0.625 ||
    productUpdated.outputs.scaleX !== 1.1 ||
    productUpdated.outputs.scaleY !== 1.1 ||
    productUpdated.outputs.rotation !== 4
  ) {
    throw new Error("The product animation API published the wrong outputs.");
  }
  product.dispose();
  assertIdleNativeWorkletScheduler(binding, "The product animation API");
  if (binding.getSurfaceInfo().activeUIWorkletCount !== 0) {
    throw new Error("The product animation API did not release its graph.");
  }
  console.log(
    "SOLID_NATIVE_PRODUCT_ANIMATION_SUCCEEDED",
    JSON.stringify({ productInitial, productImmediate, productUpdated }),
  );

  const decoderHost = createNativeViewUIWorkletHost(target);
  let unsupportedRejected = false;
  try {
    decoderHost.installGraph(
      createUIWorkletGraph({
        protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
        inputs: [],
        outputs: [
          {
            name: "unsupportedProperty",
            expression: { kind: "constant", value: 1 },
          },
        ],
      }),
    );
  } catch {
    unsupportedRejected = true;
  }
  if (
    !unsupportedRejected ||
    binding.getSurfaceInfo().activeUIWorkletCount !== 0
  ) {
    throw new Error("The native UI worklet decoder did not fail closed.");
  }
  console.log("SOLID_NATIVE_UI_WORKLET_DECODER_SUCCEEDED");

  const conformanceGraph = createUIWorkletGraph({
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    inputs: [
      { name: "left", initialValue: -4 },
      { name: "right", initialValue: 2 },
    ],
    outputs: [
      {
        name: "opacity",
        expression: {
          kind: "clamp",
          value: { kind: "constant", value: 0.5 },
          min: 0,
          max: 1,
        },
      },
      {
        name: "translateX",
        expression: {
          kind: "binary",
          operator: "divide",
          left: {
            kind: "abs",
            value: { kind: "input", name: "left" },
          },
          right: { kind: "input", name: "right" },
        },
      },
      {
        name: "translateY",
        expression: {
          kind: "binary",
          operator: "add",
          left: {
            kind: "binary",
            operator: "subtract",
            left: { kind: "input", name: "right" },
            right: { kind: "input", name: "left" },
          },
          right: { kind: "constant", value: 1 },
        },
      },
      {
        name: "scaleX",
        expression: {
          kind: "binary",
          operator: "min",
          left: { kind: "constant", value: 1.5 },
          right: { kind: "input", name: "right" },
        },
      },
      {
        name: "scaleY",
        expression: {
          kind: "binary",
          operator: "max",
          left: { kind: "constant", value: 1 },
          right: { kind: "input", name: "right" },
        },
      },
      {
        name: "rotation",
        expression: {
          kind: "negate",
          value: { kind: "input", name: "left" },
        },
      },
    ],
  });
  const conformanceHandle = decoderHost.installGraph(conformanceGraph);
  try {
    const snapshot = await waitForAppliedFrame(
      decoderHost,
      conformanceHandle,
      0,
    );
    if (
      snapshot.outputs.opacity !== 0.5 ||
      snapshot.outputs.translateX !== 2 ||
      snapshot.outputs.translateY !== 7 ||
      snapshot.outputs.scaleX !== 1.5 ||
      snapshot.outputs.scaleY !== 2 ||
      snapshot.outputs.rotation !== 4
    ) {
      throw new Error("The native C++ worklet evaluator diverged.");
    }
    if (typeof decoderHost.attachPanGesture !== "function") {
      throw new Error("The native UI worklet pan extension is unavailable.");
    }
    let invalidPanRejected = false;
    const beforeInvalidPan = decoderHost.inspectGraph(conformanceHandle);
    try {
      decoderHost.attachPanGesture(conformanceHandle, {
        xInput: "missing",
        yInput: "right",
        minX: -10,
        maxX: 10,
        minY: -10,
        maxY: 10,
      });
    } catch {
      invalidPanRejected = true;
    }
    const afterInvalidPan = decoderHost.inspectGraph(conformanceHandle);
    if (
      !invalidPanRejected ||
      afterInvalidPan.sequence !== beforeInvalidPan.sequence ||
      afterInvalidPan.gestureAttached !== undefined ||
      afterInvalidPan.outputs.translateX !== beforeInvalidPan.outputs.translateX
    ) {
      throw new Error("The native pan decoder did not reject atomically.");
    }
    let invalidPanReleaseRejected = false;
    try {
      decoderHost.attachPanGesture(conformanceHandle, {
        xInput: "left",
        yInput: "right",
        minX: -10,
        maxX: 10,
        minY: -10,
        maxY: 10,
        releaseDecay: {
          deceleration: 0,
          velocityThreshold: 1,
          maximumDurationMilliseconds: 250,
        },
      });
    } catch {
      invalidPanReleaseRejected = true;
    }
    const afterInvalidPanRelease = decoderHost.inspectGraph(conformanceHandle);
    if (
      !invalidPanReleaseRejected ||
      afterInvalidPanRelease.sequence !== beforeInvalidPan.sequence ||
      afterInvalidPanRelease.gestureAttached !== undefined ||
      afterInvalidPanRelease.outputs.translateX !==
        beforeInvalidPan.outputs.translateX
    ) {
      throw new Error(
        "The native pan release decoder did not reject atomically.",
      );
    }
    let atomicRejection = false;
    try {
      decoderHost.updateGraphInputs(conformanceHandle, [-4, 0], 1);
    } catch {
      atomicRejection = true;
    }
    const afterRejection = decoderHost.inspectGraph(conformanceHandle);
    if (
      !atomicRejection ||
      afterRejection.sequence !== snapshot.sequence ||
      afterRejection.timestamp !== undefined ||
      afterRejection.outputs.translateX !== 2
    ) {
      throw new Error(
        "The native worklet input frame did not reject atomically.",
      );
    }
    if (decoderHost.animateGraphInputs === undefined) {
      throw new Error("The native worklet timing extension is unavailable.");
    }
    let timingRejection = false;
    try {
      decoderHost.animateGraphInputs(conformanceHandle, [-4, 2], 1, {
        durationMilliseconds: 0,
        easing: "linear",
      });
    } catch {
      timingRejection = true;
    }
    const afterTimingRejection = decoderHost.inspectGraph(conformanceHandle);
    if (
      !timingRejection ||
      afterTimingRejection.sequence !== snapshot.sequence ||
      afterTimingRejection.timestamp !== undefined ||
      afterTimingRejection.timingActive ||
      afterTimingRejection.timingProgress !== 0 ||
      afterTimingRejection.outputs.translateX !== 2
    ) {
      throw new Error("The native timing request did not reject atomically.");
    }
    if (decoderHost.animateGraphKeyframes === undefined) {
      throw new Error("The native worklet keyframe extension is unavailable.");
    }
    let keyframeRejection = false;
    try {
      decoderHost.animateGraphKeyframes(
        conformanceHandle,
        [
          {
            inputs: [-4, 4],
            timing: { durationMilliseconds: 100, easing: "linear" },
          },
          {
            inputs: [-4, 0],
            timing: { durationMilliseconds: 100, easing: "linear" },
          },
        ],
        1,
      );
    } catch {
      keyframeRejection = true;
    }
    const afterKeyframeRejection = decoderHost.inspectGraph(conformanceHandle);
    if (
      !keyframeRejection ||
      afterKeyframeRejection.sequence !== snapshot.sequence ||
      afterKeyframeRejection.timestamp !== undefined ||
      afterKeyframeRejection.timingActive ||
      afterKeyframeRejection.timingProgress !== 0 ||
      afterKeyframeRejection.outputs.translateX !== 2
    ) {
      throw new Error("The native keyframes did not reject atomically.");
    }
    if (decoderHost.springGraphInputs === undefined) {
      throw new Error("The native worklet spring extension is unavailable.");
    }
    let springRejection = false;
    try {
      decoderHost.springGraphInputs(conformanceHandle, [-4, 2], 1, {
        mass: 0,
        stiffness: 100,
        damping: 10,
        initialVelocity: 0,
        restSpeedThreshold: 0.01,
        restDisplacementThreshold: 0.001,
        maximumDurationMilliseconds: 5_000,
      });
    } catch {
      springRejection = true;
    }
    const afterSpringRejection = decoderHost.inspectGraph(conformanceHandle);
    if (
      !springRejection ||
      afterSpringRejection.sequence !== snapshot.sequence ||
      afterSpringRejection.timestamp !== undefined ||
      afterSpringRejection.springActive !== undefined ||
      afterSpringRejection.outputs.translateX !== 2
    ) {
      throw new Error("The native spring request did not reject atomically.");
    }
    if (decoderHost.decayGraphInputs === undefined) {
      throw new Error("The native worklet decay extension is unavailable.");
    }
    let decayRejection = false;
    try {
      decoderHost.decayGraphInputs(conformanceHandle, [0, 20], 1, {
        deceleration: 0,
        velocityThreshold: 2,
        maximumDurationMilliseconds: 5_000,
      });
    } catch {
      decayRejection = true;
    }
    const afterDecayRejection = decoderHost.inspectGraph(conformanceHandle);
    if (
      !decayRejection ||
      afterDecayRejection.sequence !== snapshot.sequence ||
      afterDecayRejection.timestamp !== undefined ||
      afterDecayRejection.decayActive !== undefined ||
      afterDecayRejection.outputs.translateX !== 2
    ) {
      throw new Error("The native decay request did not reject atomically.");
    }
    if (decoderHost.cancelGraphAnimation === undefined) {
      throw new Error(
        "The native worklet animation cancellation extension is unavailable.",
      );
    }
    let cancellationRejection = false;
    try {
      decoderHost.cancelGraphAnimation(conformanceHandle, Number.NaN);
    } catch {
      cancellationRejection = true;
    }
    const afterCancellationRejection =
      decoderHost.inspectGraph(conformanceHandle);
    if (
      !cancellationRejection ||
      afterCancellationRejection.sequence !== snapshot.sequence ||
      afterCancellationRejection.timestamp !== undefined ||
      afterCancellationRejection.outputs.translateX !== 2
    ) {
      throw new Error(
        "The native animation cancellation did not reject atomically.",
      );
    }
  } finally {
    decoderHost.destroyGraph(conformanceHandle);
  }
  if (binding.getSurfaceInfo().activeUIWorkletCount !== 0) {
    throw new Error("The native conformance graph was not destroyed.");
  }
  console.log("SOLID_NATIVE_UI_WORKLET_CONFORMANCE_SUCCEEDED");
  console.log("SOLID_NATIVE_UI_WORKLET_READY");
}

void run().catch(reportFatal);
