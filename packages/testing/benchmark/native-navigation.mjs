import os from "node:os";
import { performance } from "node:perf_hooks";

import { CORE_COMPONENT_DESCRIPTORS, Text } from "@solid-native/core";
import {
  NativeHistory,
  NativeStack,
  TanStackNativeOutlet,
  TanStackNativeRouterProvider,
  TanStackNativeStack,
  TanStackRootRoute,
  TanStackRoute,
  createTanStackNativeHistory,
  createTanStackNativeRouter,
  useTanStackNativeScreen,
} from "@solid-native/navigation";
import { createComponent, mount } from "@solid-native/renderer";
import { onCleanup } from "solid-js";

import { InMemoryHost } from "../dist/index.js";

function readPositiveInteger(name, fallback) {
  const source = process.env[name];
  if (source === undefined) return fallback;
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

function quantile(sorted, probability) {
  if (sorted.length === 0) throw new Error("Cannot summarize zero samples.");
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    throw new Error("The benchmark sample set is incomplete.");
  }
  return lower + (upper - lower) * (position - lowerIndex);
}

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function summarize(durations, iterations) {
  const sorted = durations.toSorted((left, right) => left - right);
  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const mean =
    sorted.reduce((total, duration) => total + duration, 0) / sorted.length;
  return {
    sampleCount: sorted.length,
    iterationsPerSample: iterations,
    samplesMilliseconds: durations.map((duration) => round(duration, 6)),
    medianBatchMilliseconds: round(median),
    p95BatchMilliseconds: round(p95),
    meanBatchMilliseconds: round(mean),
    minBatchMilliseconds: round(sorted[0]),
    maxBatchMilliseconds: round(sorted.at(-1)),
    medianMicrosecondsPerCycle: round((median * 1_000) / iterations),
    medianCyclesPerSecond: round((iterations * 1_000) / median),
  };
}

function runHistoryCycles(history, start, count) {
  for (let offset = 0; offset < count; offset++) {
    const cycle = start + offset;
    const push = history.push(`/details/${String(cycle)}`, { cycle });
    if (!history.acknowledgeApplicationTransition(push.id)) {
      throw new Error("The benchmark could not acknowledge a history push.");
    }
    const back = history.requestPlatformBack();
    if (
      back === undefined ||
      !history.completePlatformTransition(back.id, true)
    ) {
      throw new Error("The benchmark could not complete platform Back.");
    }
  }
}

function measureHistorySample(warmupIterations, iterations) {
  const history = new NativeHistory({ initialHref: "/" });
  runHistoryCycles(history, 0, warmupIterations);
  const startedAt = performance.now();
  runHistoryCycles(history, warmupIterations, iterations);
  const duration = performance.now() - startedAt;
  if (
    history.location.href !== "/" ||
    history.canGoBack ||
    history.pendingApplicationTransitionCount !== 0 ||
    history.hasPendingPlatformTransition ||
    history.snapshot.entries.length !== 2
  ) {
    throw new Error("The history benchmark retained invalid final state.");
  }
  return duration;
}

function findElement(snapshot, component, predicate = () => true) {
  return snapshot.nodes.find(
    (node) =>
      node.kind === "element" &&
      node.component === component &&
      predicate(node),
  );
}

async function measureRenderedSample(warmupIterations, iterations) {
  const host = new InMemoryHost({ descriptors: CORE_COMPONENT_DESCRIPTORS });
  const history = new NativeHistory({ initialHref: "/" });
  let ownerCreations = 0;
  let ownerDisposals = 0;
  const application = mount(
    () =>
      createComponent(NativeStack, {
        history,
        children: (entry) => {
          ownerCreations++;
          onCleanup(() => {
            ownerDisposals++;
          });
          return createComponent(Text, {
            get children() {
              return entry().href;
            },
          });
        },
      }),
    host,
    { surface: { name: "native-navigation-benchmark" }, autoCommit: false },
  );
  await application.root.flush();
  const initialSnapshot = host.getSurfaceSnapshot(application.root.surfaceId);
  const stack = findElement(initialSnapshot, "ScreenStack");
  const root = findElement(initialSnapshot, "Screen");
  if (stack === undefined || root === undefined) {
    throw new Error(
      "The navigation benchmark did not mount its initial stack.",
    );
  }
  const rootContent = root.children[0];

  const runCycles = async (start, count) => {
    for (let offset = 0; offset < count; offset++) {
      const cycle = start + offset;
      const push = history.push(`/details/${String(cycle)}`, { cycle });
      if ((await application.root.flush()) === undefined) {
        throw new Error("A benchmark push did not produce a commit.");
      }
      const pushedSnapshot = host.getSurfaceSnapshot(
        application.root.surfaceId,
      );
      const detail = findElement(
        pushedSnapshot,
        "Screen",
        (node) => node.props.screenId === push.to.id,
      );
      if (detail === undefined) {
        throw new Error("A benchmark detail screen did not mount.");
      }
      host.injectEvent({
        surface: application.root.surfaceId,
        target: stack.node,
        name: "transitionEnd",
        priority: "default",
        bubbles: false,
      });
      if (history.acknowledgeApplicationTransition(push.id)) {
        throw new Error("The native stack did not acknowledge a push.");
      }
      host.injectEvent({
        surface: application.root.surfaceId,
        target: detail.node,
        name: "dismiss",
        payload: { dismissCount: 1 },
        priority: "default",
        bubbles: false,
      });
      await Promise.resolve();
      if ((await application.root.flush()) === undefined) {
        throw new Error("A benchmark pop did not produce a commit.");
      }
    }
  };

  await runCycles(0, warmupIterations);
  const startedAt = performance.now();
  await runCycles(warmupIterations, iterations);
  const duration = performance.now() - startedAt;
  const finalSnapshot = host.getSurfaceSnapshot(application.root.surfaceId);
  const finalRoot = findElement(finalSnapshot, "Screen");
  const expectedCycles = warmupIterations + iterations;
  if (
    finalSnapshot.nodes.length !== 5 ||
    finalRoot?.node !== root.node ||
    finalRoot.children[0] !== rootContent ||
    history.location.href !== "/" ||
    history.canGoBack ||
    history.pendingApplicationTransitionCount !== 0 ||
    history.hasPendingPlatformTransition ||
    ownerCreations !== expectedCycles + 1 ||
    ownerDisposals !== expectedCycles ||
    host.commits.length !== expectedCycles * 2 + 1
  ) {
    throw new Error("The rendered benchmark retained invalid final state.");
  }

  await application.dispose();
  if (!application.root.disposed || ownerDisposals !== expectedCycles + 1) {
    throw new Error("The rendered benchmark did not dispose its application.");
  }
  return duration;
}

async function waitForRouterPath(router, pathname) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      router.state.status === "idle" &&
      router.state.location.pathname === pathname
    ) {
      return;
    }
    await Promise.resolve();
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      router.state.status === "idle" &&
      router.state.location.pathname === pathname
    ) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`The TanStack router did not settle at ${pathname}.`);
}

async function measureTanStackRenderedSample(warmupIterations, iterations) {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const host = new InMemoryHost({ descriptors: CORE_COMPONENT_DESCRIPTORS });
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const routerHistory = createTanStackNativeHistory(nativeHistory);
  let ownerCreations = 0;
  let ownerDisposals = 0;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const createScreen = (label) => () => {
    ownerCreations++;
    onCleanup(() => {
      ownerDisposals++;
    });
    const screen = useTanStackNativeScreen();
    return createComponent(Text, {
      get children() {
        return `${label}:${screen.entry().href}`;
      },
    });
  };
  const rootRoute = new TanStackRootRoute({
    component: () => createComponent(TanStackNativeOutlet, {}),
  });
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => ({ title: "Home" }),
    component: createScreen("home"),
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/details/$cycle",
    loader: ({ params }) => ({ cycle: params.cycle }),
    component: createScreen("detail"),
  });
  const router = createTanStackNativeRouter({
    routeTree: rootRoute.addChildren([homeRoute, detailRoute]),
    history: routerHistory,
    isServer: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await router.load();

  const application = mount(
    () =>
      createComponent(TanStackNativeRouterProvider, {
        router,
        onReady: () => readyResolve(),
        onError: (error) => readyReject(error),
        get children() {
          return createComponent(TanStackNativeStack, {
            history: nativeHistory,
            renderUnresolved: (entry) =>
              createComponent(Text, {
                get children() {
                  return `unresolved:${entry().href}`;
                },
              }),
          });
        },
      }),
    host,
    {
      surface: { name: "tanstack-native-navigation-benchmark" },
      autoCommit: false,
    },
  );
  await application.root.flush();
  await ready;
  const initialSnapshot = host.getSurfaceSnapshot(application.root.surfaceId);
  const stack = findElement(initialSnapshot, "ScreenStack");
  const root = findElement(initialSnapshot, "Screen");
  if (stack === undefined || root === undefined) {
    throw new Error(
      "The TanStack navigation benchmark did not mount its initial stack.",
    );
  }
  const rootContent = root.children[0];

  const runCycles = async (start, count) => {
    for (let offset = 0; offset < count; offset++) {
      const cycle = start + offset;
      await router.navigate({
        to: "/details/$cycle",
        params: { cycle: String(cycle) },
      });
      if ((await application.root.flush()) === undefined) {
        throw new Error("A TanStack benchmark push did not produce a commit.");
      }
      const pushedEntry = nativeHistory.location;
      if (
        nativeHistory.pendingApplicationTransitionCount !== 1 ||
        pushedEntry.href !== `/details/${String(cycle)}`
      ) {
        throw new Error("The TanStack benchmark lost its native history push.");
      }
      const pushedSnapshot = host.getSurfaceSnapshot(
        application.root.surfaceId,
      );
      const detail = findElement(
        pushedSnapshot,
        "Screen",
        (node) => node.props.screenId === pushedEntry.id,
      );
      if (detail === undefined) {
        throw new Error("A TanStack benchmark detail screen did not mount.");
      }
      host.injectEvent({
        surface: application.root.surfaceId,
        target: stack.node,
        name: "transitionEnd",
        priority: "default",
        bubbles: false,
      });
      if (nativeHistory.pendingApplicationTransitionCount !== 0) {
        throw new Error(
          "The TanStack native stack did not acknowledge a push.",
        );
      }
      host.injectEvent({
        surface: application.root.surfaceId,
        target: detail.node,
        name: "dismiss",
        payload: { dismissCount: 1 },
        priority: "default",
        bubbles: false,
      });
      await waitForRouterPath(router, "/");
      if ((await application.root.flush()) === undefined) {
        throw new Error("A TanStack benchmark pop did not produce a commit.");
      }
    }
  };

  await runCycles(0, warmupIterations);
  const startedAt = performance.now();
  await runCycles(warmupIterations, iterations);
  const duration = performance.now() - startedAt;
  const finalSnapshot = host.getSurfaceSnapshot(application.root.surfaceId);
  const finalRoot = findElement(finalSnapshot, "Screen");
  const expectedCycles = warmupIterations + iterations;
  if (
    finalSnapshot.nodes.length !== 5 ||
    finalRoot?.node !== root.node ||
    finalRoot.children[0] !== rootContent ||
    nativeHistory.location.href !== "/" ||
    nativeHistory.canGoBack ||
    nativeHistory.pendingApplicationTransitionCount !== 0 ||
    nativeHistory.hasPendingPlatformTransition ||
    router.state.status !== "idle" ||
    router.state.location.pathname !== "/" ||
    ownerCreations !== expectedCycles + 1 ||
    ownerDisposals !== expectedCycles ||
    host.commits.length !== expectedCycles * 2 + 1
  ) {
    throw new Error(
      "The TanStack rendered benchmark retained invalid final state.",
    );
  }

  await application.dispose();
  routerHistory.destroy();
  if (!application.root.disposed || ownerDisposals !== expectedCycles + 1) {
    throw new Error(
      "The TanStack rendered benchmark did not dispose its application.",
    );
  }
  return duration;
}

async function main() {
  const unknownArguments = process.argv
    .slice(2)
    .filter((value) => value !== "--json");
  if (unknownArguments.length > 0) {
    throw new Error(
      `Unknown benchmark arguments: ${unknownArguments.join(", ")}`,
    );
  }
  const jsonOnly = process.argv.includes("--json");
  const warmupIterations = readPositiveInteger(
    "SOLID_NATIVE_NAV_BENCH_WARMUP",
    100,
  );
  const iterations = readPositiveInteger(
    "SOLID_NATIVE_NAV_BENCH_ITERATIONS",
    500,
  );
  const sampleCount = readPositiveInteger("SOLID_NATIVE_NAV_BENCH_SAMPLES", 12);
  const historyDurations = [];
  const renderedDurations = [];
  const tanStackRenderedDurations = [];

  for (let sample = 0; sample < sampleCount; sample++) {
    globalThis.gc?.();
    historyDurations.push(measureHistorySample(warmupIterations, iterations));
    globalThis.gc?.();
    renderedDurations.push(
      await measureRenderedSample(warmupIterations, iterations),
    );
    globalThis.gc?.();
    tanStackRenderedDurations.push(
      await measureTanStackRenderedSample(warmupIterations, iterations),
    );
  }

  const cpu = os.cpus()[0];
  const result = {
    schemaVersion: 0,
    benchmark: "native-navigation-churn",
    measuredAt: new Date().toISOString(),
    configuration: {
      warmupCycles: warmupIterations,
      cyclesPerSample: iterations,
      sampleCount,
      commitsPerRenderedCycle: 2,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuModel: cpu?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
    },
    modes: [
      { mode: "history-only", ...summarize(historyDurations, iterations) },
      { mode: "rendered-stack", ...summarize(renderedDurations, iterations) },
      {
        mode: "tanstack-stack",
        ...summarize(tanStackRenderedDurations, iterations),
      },
    ],
  };

  if (jsonOnly) {
    console.log(JSON.stringify(result, undefined, 2));
    return;
  }
  console.log("Solid Native navigation churn benchmark");
  console.log(
    `${String(sampleCount)} samples × ${String(iterations)} measured push/pop ` +
      `cycles; ${String(warmupIterations)} warmup cycles per sample`,
  );
  console.table(
    result.modes.map((mode) => ({
      mode: mode.mode,
      "median µs/cycle": mode.medianMicrosecondsPerCycle,
      "p95 batch ms": mode.p95BatchMilliseconds,
      "median cycles/s": mode.medianCyclesPerSecond,
    })),
  );
  console.log(
    `SOLID_NATIVE_NAVIGATION_BENCHMARK_RESULT ${JSON.stringify(result)}`,
  );
}

await main();
