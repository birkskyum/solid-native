import assert from "node:assert/strict";
import test from "node:test";
import { createMemo, createRoot } from "solid-js";

import {
  NATIVE_HISTORY_MAX_ENTRIES,
  NATIVE_HISTORY_MAX_SERIALIZED_LENGTH,
  NATIVE_SCROLL_RESTORATION_MAX_CONTAINERS_PER_ENTRY,
  NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH,
  NATIVE_TABS_STATE_MAX_SERIALIZED_LENGTH,
  NativeHistory,
  NativeScrollRestoration,
  createDeepLinkHandler,
  createHardwareBackHandler,
  createNativeHistoryFromLaunch,
  createNativeHistoryFromStorage,
  createNativeHistoryPersistence,
  createNativeScrollRestorationFromStorage,
  createNativeScrollRestorationPersistence,
  createNativeTabsState,
  createNativeTabsStateFromLaunch,
  createNativeTabsStateFromStorage,
  createNativeTabsStatePersistence,
  createTanStackNativeHistory,
  createTanStackNativeRouter,
  deserializeNativeHistorySnapshot,
  deserializeNativeScrollRestorationSnapshot,
  deserializeNativeTabsStateSnapshot,
  serializeNativeHistorySnapshot,
  serializeNativeScrollRestorationSnapshot,
  serializeNativeTabsStateSnapshot,
  TanStackRootRoute,
  TanStackRoute,
} from "@solid-native/navigation";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("tracks application navigation with stable screen identities", () => {
  const history = new NativeHistory({ initialHref: "/" });
  const updates = [];
  history.subscribe((update) => updates.push(update));

  const details = history.push("/details", { item: 42 });
  const replaced = history.replace("/details?tab=info", { item: 42 });
  const popped = history.back();

  assert.equal(details.kind, "push");
  assert.equal(replaced.to.id, details.to.id);
  assert.equal(popped.kind, "pop");
  assert.equal(history.location.href, "/");
  assert.equal(history.pendingApplicationTransitionCount, 3);
  assert.equal(history.acknowledgeApplicationTransition(details.id), true);
  assert.equal(history.acknowledgeApplicationTransition(details.id), false);
  assert.equal(history.pendingApplicationTransitionCount, 2);
  assert.equal(updates.length, 3);
});

test("synchronizes TanStack history without native feedback loops", () => {
  const nativeHistory = new NativeHistory({
    snapshot: {
      entries: [
        { id: "restored-root", href: "/", state: null },
        {
          id: "restored-detail",
          href: "/detail?tab=info#heading",
          state: {
            key: "solid-native-1",
            __TSR_key: "solid-native-1",
            __TSR_index: 99,
            item: 42,
          },
        },
      ],
      index: 1,
    },
  });
  const history = createTanStackNativeHistory(nativeHistory, {
    createHref: (href) => `solid-native:${href}`,
  });
  const updates = [];
  history.subscribe((update) => updates.push(update));

  assert.equal(history.location.pathname, "/detail");
  assert.equal(history.location.search, "?tab=info");
  assert.equal(history.location.hash, "#heading");
  assert.equal(history.location.state.item, 42);
  assert.equal(history.location.state.__TSR_index, 1);
  assert.equal(history.location.state.__TSR_key, "solid-native-1");
  assert.equal(history.length, 2);
  assert.equal(history.canGoBack(), true);
  assert.equal(history.createHref("/next"), "solid-native:/next");

  history.push("/next?from=router", { source: "router" });
  assert.equal(nativeHistory.location.href, "/next?from=router");
  assert.equal(nativeHistory.location.state.source, "router");
  assert.equal(nativeHistory.location.state.__TSR_index, 2);
  assert.equal(nativeHistory.location.state.__TSR_key, "solid-native-2");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].action.type, "PUSH");

  history.replace("/next#replaced", { replaced: true });
  assert.equal(nativeHistory.location.href, "/next#replaced");
  assert.equal(updates.length, 2);
  assert.equal(updates[1].action.type, "REPLACE");

  history.back();
  assert.equal(nativeHistory.location.id, "restored-detail");
  assert.equal(updates.length, 3);
  assert.equal(updates[2].action.type, "BACK");
  assert.equal(nativeHistory.canGoForward, true);

  history.forward();
  assert.equal(nativeHistory.location.href, "/next#replaced");
  assert.equal(updates.length, 4);
  assert.equal(updates[3].action.type, "FORWARD");

  history.go(-2);
  assert.equal(nativeHistory.location.id, "restored-root");
  assert.equal(history.location.state.__TSR_index, 0);
  assert.equal(updates.length, 5);
  assert.deepEqual(updates[4].action, { type: "GO", index: -2 });

  nativeHistory.openDeepLink("/linked", { source: "platform-link" });
  assert.equal(history.location.pathname, "/linked");
  assert.equal(history.location.state.__TSR_index, 1);
  assert.equal(updates.length, 6);
  assert.equal(updates[5].action.type, "PUSH");

  const platformBack = nativeHistory.requestPlatformBack();
  assert.ok(platformBack);
  assert.equal(
    nativeHistory.completePlatformTransition(platformBack.id, true),
    true,
  );
  assert.equal(history.location.pathname, "/");
  assert.equal(updates.length, 7);
  assert.equal(updates[6].action.type, "BACK");

  nativeHistory.reset([{ href: "/reset", state: null }]);
  assert.equal(history.location.pathname, "/reset");
  assert.equal(updates.length, 8);
  assert.equal(updates[7].action.type, "REPLACE");

  history.destroy();
  history.destroy();
  nativeHistory.push("/after-destroy");
  assert.equal(updates.length, 8);
  assert.equal(history.location.pathname, "/reset");
});

test("applies TanStack blockers to programmatic native navigation", async () => {
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  const blocked = [];
  const attempts = [];
  let shouldBlock = true;
  const history = createTanStackNativeHistory(nativeHistory, {
    onBlocked: () => blocked.push(history.location.href),
  });
  const unblock = history.block({
    async blockerFn(attempt) {
      attempts.push(attempt);
      await Promise.resolve();
      return shouldBlock;
    },
  });
  assert.equal(nativeHistory.hasPlatformTransitionBlockers, true);

  history.push("/blocked", { guarded: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeHistory.location.href, "/");
  assert.deepEqual(blocked, ["/"]);
  assert.equal(attempts[0].action, "PUSH");
  assert.equal(attempts[0].nextLocation.pathname, "/blocked");
  assert.equal(attempts[0].nextLocation.state.guarded, true);

  shouldBlock = false;
  history.push("/allowed");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeHistory.location.href, "/allowed");

  shouldBlock = true;
  history.back();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeHistory.location.href, "/allowed");
  assert.equal(attempts.at(-1).action, "BACK");

  const nativeBlocked = [];
  const nativeCompleted = [];
  const handleHardwareBack = createHardwareBackHandler(nativeHistory, {
    onBlocked: (transition) => nativeBlocked.push(transition),
    onTransition: (transition) => nativeCompleted.push(transition),
  });
  assert.equal(handleHardwareBack(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeHistory.location.href, "/allowed");
  assert.equal(nativeBlocked.length, 1);
  assert.equal(nativeCompleted.length, 0);

  shouldBlock = false;
  assert.equal(handleHardwareBack(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeHistory.location.href, "/");
  assert.equal(nativeCompleted.length, 1);

  shouldBlock = true;
  history.push("/explicit-bypass", undefined, { ignoreBlocker: true });
  assert.equal(nativeHistory.location.href, "/explicit-bypass");
  history.back({ ignoreBlocker: true });
  assert.equal(nativeHistory.location.href, "/");
  unblock();
  assert.equal(nativeHistory.hasPlatformTransitionBlockers, false);
  history.push("/after-unblock");
  assert.equal(nativeHistory.location.href, "/after-unblock");
});

test("keeps duplicate TanStack blockers independent and fails platform errors closed", async () => {
  const nativeHistory = new NativeHistory({ initialHref: "/" });
  nativeHistory.push("/guarded");
  const failure = new Error("blocker failed");
  const diagnosticFailure = new Error("diagnostic failed");
  const errors = [];
  const blocked = [];
  let diagnosticRejections = 0;
  const history = createTanStackNativeHistory(nativeHistory, {
    onNavigationError(error) {
      errors.push(error);
      return {
        then(_resolve, reject) {
          diagnosticRejections++;
          reject(diagnosticFailure);
        },
      };
    },
  });
  const blocker = {
    blockerFn() {
      throw failure;
    },
  };
  const removeFirst = history.block(blocker);
  const removeSecond = history.block(blocker);

  removeFirst();
  assert.equal(nativeHistory.hasPlatformTransitionBlockers, true);
  const handleHardwareBack = createHardwareBackHandler(nativeHistory, {
    onBlocked: (transition) => blocked.push(transition),
  });
  assert.equal(handleHardwareBack(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeHistory.location.href, "/guarded");
  assert.equal(nativeHistory.hasPendingPlatformTransition, false);
  assert.deepEqual(errors, [failure]);
  assert.equal(diagnosticRejections, 1);
  assert.equal(blocked.length, 1);

  removeSecond();
  removeSecond();
  assert.equal(nativeHistory.hasPlatformTransitionBlockers, false);
  assert.equal(handleHardwareBack(), true);
  assert.equal(nativeHistory.location.href, "/");
  history.destroy();
});

test("runs TanStack route matching and loaders through Solid 2 stores", async () => {
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;

  const detail = deferred();
  const failure = new Error("loader failed");
  const rootRoute = new TanStackRootRoute();
  const homeRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => ({ title: "Home" }),
  });
  const detailRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/detail",
    loader: async () => detail.promise,
  });
  const errorRoute = new TanStackRoute({
    getParentRoute: () => rootRoute,
    path: "/error",
    loader: () => {
      throw failure;
    },
  });
  const routeTree = rootRoute.addChildren([homeRoute, detailRoute, errorRoute]);

  const setup = createRoot((dispose) => {
    const nativeHistory = new NativeHistory({ initialHref: "/" });
    const history = createTanStackNativeHistory(nativeHistory);
    const router = createTanStackNativeRouter({
      routeTree,
      history,
      isServer: false,
      defaultPendingMs: 0,
      defaultPendingMinMs: 0,
    });
    const leafMatch = createMemo(() => router.stores.matches.get().at(-1));
    const unsubscribe = history.subscribe(router.load);
    return { dispose, history, leafMatch, router, unsubscribe };
  });

  await setup.router.load();
  assert.equal(setup.leafMatch()?.routeId, homeRoute.id);
  assert.deepEqual(setup.leafMatch()?.loaderData, { title: "Home" });

  const navigation = setup.router.navigate({ to: "/detail" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(setup.router.state.status, "pending");
  detail.resolve({ title: "Detail" });
  await navigation;
  assert.equal(setup.leafMatch()?.routeId, detailRoute.id);
  assert.deepEqual(setup.leafMatch()?.loaderData, { title: "Detail" });
  assert.equal(setup.history.location.pathname, "/detail");

  await setup.router.navigate({ to: "/error" });
  assert.equal(setup.leafMatch()?.routeId, errorRoute.id);
  assert.equal(setup.leafMatch()?.status, "error");
  assert.equal(setup.leafMatch()?.error, failure);

  setup.unsubscribe();
  setup.history.destroy();
  setup.dispose();
});

test("rejects server-mode construction for a native TanStack router", () => {
  const rootRoute = new TanStackRootRoute();
  assert.throws(
    () =>
      createTanStackNativeRouter({
        routeTree: rootRoute,
        history: createTanStackNativeHistory(),
        isServer: true,
      }),
    /must use isServer: false/,
  );
});

test("applies platform back only after completion and preserves canceled state", () => {
  const history = new NativeHistory({ initialHref: "/" });
  history.push("/first");
  history.push("/second");
  const updates = [];
  history.subscribe((update) => updates.push(update));

  const canceled = history.requestPlatformBack();
  assert.ok(canceled);
  assert.equal(history.hasPendingPlatformTransition, true);
  assert.equal(history.location.href, "/second");
  assert.equal(history.completePlatformTransition(canceled.id, false), true);
  assert.equal(history.hasPendingPlatformTransition, false);
  assert.equal(history.location.href, "/second");
  assert.equal(updates.length, 0);

  const completed = history.requestPlatformBack();
  assert.ok(completed);
  assert.equal(history.completePlatformTransition(completed.id, true), true);
  assert.equal(history.hasPendingPlatformTransition, false);
  assert.equal(history.location.href, "/first");
  assert.equal(updates[0].transition.origin, "platform");
});

test("rejects stale platform completion after application navigation", () => {
  const history = new NativeHistory({ initialHref: "/" });
  history.push("/first");
  const nativeBack = history.requestPlatformBack();
  assert.ok(nativeBack);
  history.push("/newer");

  assert.equal(history.completePlatformTransition(nativeBack.id, true), false);
  assert.equal(history.location.href, "/newer");
});

test("restores snapshots and avoids reusing screen identities", () => {
  const restored = new NativeHistory({
    snapshot: {
      entries: [
        { id: "screen-1", href: "/", state: null },
        { id: "screen-3", href: "/restored", state: { coldStart: true } },
      ],
      index: 1,
    },
  });
  const next = restored.openDeepLink("/deep-link");

  assert.equal(next.origin, "system");
  assert.equal(next.to.id, "screen-2");
  assert.deepEqual(restored.snapshot.entries[1].state, { coldStart: true });
});

test("reconciles Android hardware Back through the framework-neutral handler", () => {
  const history = new NativeHistory({ initialHref: "/" });
  const transitions = [];
  const handler = createHardwareBackHandler(history, {
    onTransition: (transition) => transitions.push(transition),
  });

  assert.equal(handler(), false);
  history.push("/details");
  assert.equal(handler(), true);
  assert.equal(history.location.href, "/");
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].kind, "pop");
  assert.equal(transitions[0].origin, "platform");
});

test("routes hardware Back to the selected native history", async () => {
  const home = new NativeHistory({ initialHref: "/home" });
  const settings = new NativeHistory({ initialHref: "/settings" });
  settings.push("/settings/detail");
  let selected = "settings";
  const transitions = [];
  const handler = createHardwareBackHandler(
    () => (selected === "settings" ? settings : home),
    { onTransition: (transition) => transitions.push(transition) },
  );

  assert.equal(handler(), true);
  assert.equal(settings.location.href, "/settings");
  assert.equal(home.location.href, "/home");
  selected = "home";
  assert.equal(handler(), false);

  settings.push("/settings/guarded");
  const decision = deferred();
  const unblock = settings.blockPlatformTransitions(() => decision.promise);
  selected = "settings";
  assert.equal(handler(), true);
  selected = "home";
  decision.resolve(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settings.location.href, "/settings");
  assert.equal(home.location.href, "/home");
  assert.equal(transitions.length, 2);
  unblock();

  const blockerFailure = new Error("hardware blocker failed");
  const errors = [];
  let diagnosticRejections = 0;
  settings.push("/settings/failing-guard");
  const unblockFailure = settings.blockPlatformTransitions(() =>
    Promise.reject(blockerFailure),
  );
  const failedHandler = createHardwareBackHandler(settings, {
    onError(error) {
      errors.push(error);
      return {
        then(_resolve, reject) {
          diagnosticRejections++;
          reject(new Error("hardware diagnostic failed"));
        },
      };
    },
  });
  assert.equal(failedHandler(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, [blockerFailure]);
  assert.equal(diagnosticRejections, 1);
  assert.equal(settings.hasPendingPlatformTransition, false);
  assert.equal(settings.location.href, "/settings/failing-guard");
  unblockFailure();
});

test("consumes a failed hardware Back after reporting the invariant error", async () => {
  const history = new NativeHistory({ initialHref: "/" });
  history.push("/details");
  assert.ok(history.requestPlatformBack());
  const errors = [];
  let diagnosticRejections = 0;
  const handler = createHardwareBackHandler(history, {
    onError(error) {
      errors.push(error);
      return {
        then(_resolve, reject) {
          diagnosticRejections++;
          reject(new Error("hardware diagnostic failed"));
        },
      };
    },
  });

  assert.equal(handler(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.equal(diagnosticRejections, 1);
  assert.match(String(errors[0]), /already pending/);
  assert.equal(history.location.href, "/details");
});

test("round-trips a versioned native history restoration snapshot", () => {
  const history = new NativeHistory({
    initialHref: "/",
    initialState: { session: "root" },
  });
  history.push("/first", { filters: ["new", 42, true] });
  history.push("/second", { nested: { selected: null } });
  history.back();

  const serialized = serializeNativeHistorySnapshot(history.snapshot);
  const envelope = JSON.parse(serialized);
  assert.equal(envelope.version, 0);
  const snapshot = deserializeNativeHistorySnapshot(serialized);
  const restored = new NativeHistory({ snapshot });

  assert.equal(restored.location.href, "/first");
  assert.equal(restored.snapshot.entries.length, 3);
  assert.deepEqual(restored.location.state, {
    filters: ["new", 42, true],
  });
  snapshot.entries[1].state.filters[0] = "mutated";
  assert.deepEqual(restored.location.state, {
    filters: ["new", 42, true],
  });
});

test("loads navigation and removes URL-discarded or corrupt restoration", async () => {
  const restoredSnapshot = serializeNativeHistorySnapshot({
    entries: [
      { id: "stored-root", href: "/", state: null },
      { id: "stored-detail", href: "/detail", state: { item: 42 } },
    ],
    index: 1,
  });
  const removed = [];
  const storage = {
    value: restoredSnapshot,
    async getItem(key) {
      assert.equal(key, "navigation");
      return this.value;
    },
    async setItem() {},
    async removeItem(key) {
      removed.push(key);
      this.value = null;
    },
  };

  const restored = await createNativeHistoryFromStorage({
    storage,
    storageKey: "navigation",
  });
  assert.equal(restored.source, "restoration");
  assert.equal(restored.history.location.id, "stored-detail");
  assert.deepEqual(removed, []);

  storage.value = restoredSnapshot;
  const linked = await createNativeHistoryFromStorage({
    storage,
    storageKey: "navigation",
    initialURL: "solid-native://account",
    resolveDeepLink: () => ({ href: "/account", state: { cold: true } }),
  });
  assert.equal(linked.source, "deep-link");
  assert.equal(linked.history.location.href, "/account");
  assert.equal(linked.history.canGoBack, false);
  assert.equal(storage.value, null);
  assert.deepEqual(removed, ["navigation"]);

  storage.value = "corrupt";
  const fallback = await createNativeHistoryFromStorage({
    storage,
    storageKey: "navigation",
    initialHref: "/safe",
  });
  assert.equal(fallback.source, "initial");
  assert.equal(fallback.history.location.href, "/safe");
  assert.ok(fallback.restorationError);
  assert.deepEqual(removed, ["navigation", "navigation"]);
});

test("serializes and coalesces native history persistence writes", async () => {
  const firstWrite = deferred();
  const writes = [];
  const storage = {
    async getItem() {
      return null;
    },
    async setItem(key, value) {
      writes.push({ key, value });
      if (writes.length === 1) await firstWrite.promise;
    },
    async removeItem() {},
  };
  const history = new NativeHistory({ initialHref: "/" });
  const persistence = createNativeHistoryPersistence(history, storage, {
    storageKey: "navigation",
  });

  history.push("/first");
  history.push("/second", { current: true });
  assert.equal(writes.length, 1);
  firstWrite.resolve();
  await persistence.flush();

  assert.equal(writes.length, 2);
  assert.equal(writes[0].key, "navigation");
  const persisted = deserializeNativeHistorySnapshot(writes[1].value);
  assert.equal(persisted.entries.length, 3);
  assert.equal(persisted.entries[persisted.index].href, "/second");
  persistence.dispose();
  persistence.dispose();
  history.push("/ignored-after-dispose");
  await persistence.flush();
  assert.equal(writes.length, 2);
});

test("reports persistence failures through the handler and flush boundary", async () => {
  const failure = new Error("native storage unavailable");
  const errors = [];
  const writes = [];
  let attempts = 0;
  const history = new NativeHistory({ initialHref: "/" });
  const persistence = createNativeHistoryPersistence(
    history,
    {
      async getItem() {
        return null;
      },
      async setItem(_key, value) {
        attempts++;
        writes.push(value);
        if (attempts === 1) throw failure;
      },
      async removeItem() {},
    },
    {
      storageKey: "navigation",
      async onError(error) {
        errors.push(error);
        throw new Error("diagnostic failure");
      },
    },
  );

  await assert.rejects(persistence.flush(), (error) => error === failure);
  assert.deepEqual(errors, [failure]);
  await persistence.flush();
  assert.equal(attempts, 2);
  assert.equal(
    deserializeNativeHistorySnapshot(writes[1]).entries[0].href,
    "/",
  );
  history.push("/recovered");
  await persistence.flush();
  assert.equal(attempts, 3);
  assert.equal(
    deserializeNativeHistorySnapshot(writes[2]).entries[1].href,
    "/recovered",
  );
});

test("stops observing persistence when its Solid owner is disposed", async () => {
  const writes = [];
  const history = new NativeHistory({ initialHref: "/" });
  let disposeOwner;
  let persistence;
  createRoot((dispose) => {
    disposeOwner = dispose;
    persistence = createNativeHistoryPersistence(
      history,
      {
        async getItem() {
          return null;
        },
        async setItem(_key, value) {
          writes.push(deserializeNativeHistorySnapshot(value));
        },
        async removeItem() {},
      },
      { storageKey: "navigation" },
    );
  });

  await persistence.flush();
  assert.equal(writes.length, 1);
  disposeOwner();
  history.push("/ignored-after-owner-disposal");
  await persistence.flush();
  assert.equal(writes.length, 1);
});

test("round-trips and bounds native scroll restoration by history entry", () => {
  const history = new NativeHistory({
    snapshot: {
      entries: [
        { id: "restored-root", href: "/", state: null },
        { id: "restored-detail", href: "/detail", state: null },
      ],
      index: 1,
    },
  });
  const serialized = serializeNativeScrollRestorationSnapshot({
    entries: [
      {
        entryId: "stale-entry",
        containers: [{ restorationKey: "feed", x: 1, y: 2 }],
      },
      {
        entryId: "restored-root",
        containers: [
          { restorationKey: "secondary", x: 4, y: 8 },
          { restorationKey: "feed", x: 0, y: 144 },
        ],
      },
    ],
  });
  assert.equal(JSON.parse(serialized).version, 0);
  assert.deepEqual(deserializeNativeScrollRestorationSnapshot(serialized), {
    entries: [
      {
        entryId: "restored-root",
        containers: [
          { restorationKey: "feed", x: 0, y: 144 },
          { restorationKey: "secondary", x: 4, y: 8 },
        ],
      },
      {
        entryId: "stale-entry",
        containers: [{ restorationKey: "feed", x: 1, y: 2 }],
      },
    ],
  });

  const restoration = new NativeScrollRestoration(history, {
    snapshot: deserializeNativeScrollRestorationSnapshot(serialized),
  });
  assert.deepEqual(restoration.read("restored-root", "feed"), {
    x: 0,
    y: 144,
  });
  assert.equal(restoration.read("stale-entry", "feed"), undefined);
  const updates = [];
  restoration.subscribe(() => updates.push(restoration.snapshot));
  restoration.capture("restored-root", "feed", { x: 0, y: 320 });
  restoration.capture("restored-root", "feed", { x: 0, y: 320 });
  assert.equal(updates.length, 1);
  assert.throws(
    () => restoration.capture("restored-root", "invalid", { x: -1, y: 0 }),
    /finite non-negative/u,
  );
  assert.throws(
    () => restoration.capture("missing", "feed", { x: 0, y: 0 }),
    /not present in history/u,
  );
  for (
    let index = 2;
    index < NATIVE_SCROLL_RESTORATION_MAX_CONTAINERS_PER_ENTRY;
    index++
  ) {
    restoration.capture("restored-root", `container-${index}`, {
      x: index,
      y: index,
    });
  }
  assert.throws(
    () => restoration.capture("restored-root", "one-too-many", { x: 0, y: 0 }),
    /cannot retain more than 32/u,
  );
  history.reset([{ href: "/fresh", state: null }]);
  assert.deepEqual(restoration.snapshot, { entries: [] });
  restoration.capture(history.location.id, "feed", { x: 0, y: 12 });
  assert.deepEqual(restoration.read(history.location.id, "feed"), {
    x: 0,
    y: 12,
  });
  assert.ok(
    serializeNativeScrollRestorationSnapshot(restoration.snapshot).length <=
      NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH,
  );
  restoration.dispose();
  assert.throws(
    () => restoration.capture(history.location.id, "feed", { x: 0, y: 0 }),
    /disposed/u,
  );

  assert.throws(
    () =>
      serializeNativeScrollRestorationSnapshot({
        entries: [
          {
            entryId: "duplicate-containers",
            containers: [
              { restorationKey: "feed", x: 0, y: 1 },
              { restorationKey: "feed", x: 0, y: 2 },
            ],
          },
        ],
      }),
    /Duplicate native scroll restoration container/u,
  );
  assert.throws(
    () => deserializeNativeScrollRestorationSnapshot('{"version":1}'),
    /Unsupported native scroll restoration version/u,
  );
  assert.throws(
    () =>
      deserializeNativeScrollRestorationSnapshot(
        "x".repeat(NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH + 1),
      ),
    /exceeds/u,
  );
});

test("rejects oversized live scroll restoration without partial capture", () => {
  const history = new NativeHistory({
    snapshot: {
      entries: Array.from(
        { length: NATIVE_HISTORY_MAX_ENTRIES },
        (_, index) => ({
          id: `entry-${String(index)}`,
          href: `/entry/${String(index)}`,
          state: null,
        }),
      ),
      index: 0,
    },
  });
  const restoration = new NativeScrollRestoration(history);
  let rejected;

  capture: for (const entry of history.snapshot.entries) {
    for (
      let index = 0;
      index < NATIVE_SCROLL_RESTORATION_MAX_CONTAINERS_PER_ENTRY;
      index++
    ) {
      const restorationKey = `${"\\".repeat(125)}${String(index).padStart(3, "0")}`;
      try {
        restoration.capture(entry.id, restorationKey, {
          x: index,
          y: index + 1,
        });
      } catch (error) {
        rejected = { entryId: entry.id, restorationKey, error };
        break capture;
      }
    }
  }

  assert.match(
    rejected?.error.message,
    /Serialized native scroll restoration exceeds/u,
  );
  assert.equal(
    restoration.read(rejected.entryId, rejected.restorationKey),
    undefined,
  );
  assert.ok(
    serializeNativeScrollRestorationSnapshot(restoration.snapshot).length <=
      NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH,
  );
  const acceptedSnapshot = restoration.snapshot;
  const oversizedContainer = {
    restorationKey: rejected.restorationKey,
    x: Number.MAX_VALUE,
    y: Number.MAX_VALUE,
  };
  const rejectedEntry = acceptedSnapshot.entries.find(
    (entry) => entry.entryId === rejected.entryId,
  );
  const oversizedSnapshot = {
    entries:
      rejectedEntry === undefined
        ? [
            ...acceptedSnapshot.entries,
            {
              entryId: rejected.entryId,
              containers: [oversizedContainer],
            },
          ]
        : acceptedSnapshot.entries.map((entry) =>
            entry === rejectedEntry
              ? {
                  ...entry,
                  containers: [...entry.containers, oversizedContainer],
                }
              : entry,
          ),
  };
  assert.throws(
    () => new NativeScrollRestoration(history, { snapshot: oversizedSnapshot }),
    /Serialized native scroll restoration exceeds/u,
  );
  restoration.dispose();
});

test("loads only history-bound offsets and coalesces durable writes", async () => {
  const history = new NativeHistory({
    snapshot: {
      entries: [{ id: "restored-root", href: "/", state: null }],
      index: 0,
    },
  });
  const restoredValue = serializeNativeScrollRestorationSnapshot({
    entries: [
      {
        entryId: "restored-root",
        containers: [{ restorationKey: "feed", x: 0, y: 144 }],
      },
    ],
  });
  const firstWrite = deferred();
  const writes = [];
  const removed = [];
  const storage = {
    value: restoredValue,
    async getItem(key) {
      assert.equal(key, "navigation-scroll");
      return this.value;
    },
    async setItem(key, value) {
      writes.push({ key, value });
      this.value = value;
      if (writes.length === 1) await firstWrite.promise;
    },
    async removeItem(key) {
      removed.push(key);
      this.value = null;
    },
  };
  const launch = await createNativeScrollRestorationFromStorage(history, {
    storage,
    storageKey: "navigation-scroll",
    historySource: "restoration",
  });
  assert.equal(launch.restorationError, undefined);
  assert.deepEqual(launch.restoration.read("restored-root", "feed"), {
    x: 0,
    y: 144,
  });

  const persistence = createNativeScrollRestorationPersistence(
    launch.restoration,
    storage,
    { storageKey: "navigation-scroll", writeDelayMs: 5 },
  );
  const initialFlush = persistence.flush();
  assert.equal(writes.length, 1);
  launch.restoration.capture("restored-root", "feed", { x: 0, y: 220 });
  launch.restoration.capture("restored-root", "feed", { x: 0, y: 320 });
  assert.equal(writes.length, 1);
  firstWrite.resolve();
  await initialFlush;
  assert.equal(writes.length, 2);
  assert.equal(writes[1].key, "navigation-scroll");
  assert.deepEqual(
    deserializeNativeScrollRestorationSnapshot(writes[1].value),
    {
      entries: [
        {
          entryId: "restored-root",
          containers: [{ restorationKey: "feed", x: 0, y: 320 }],
        },
      ],
    },
  );
  launch.restoration.capture("restored-root", "feed", { x: 0, y: 400 });
  launch.restoration.capture("restored-root", "feed", { x: 0, y: 420 });
  assert.equal(writes.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(writes.length, 3);
  assert.equal(
    deserializeNativeScrollRestorationSnapshot(writes[2].value).entries[0]
      .containers[0].y,
    420,
  );
  persistence.dispose();
  launch.restoration.dispose();

  storage.value = restoredValue;
  const freshHistory = new NativeHistory({ initialHref: "/" });
  const fresh = await createNativeScrollRestorationFromStorage(freshHistory, {
    storage,
    storageKey: "navigation-scroll",
    historySource: "initial",
  });
  assert.deepEqual(fresh.restoration.snapshot, { entries: [] });
  assert.deepEqual(removed, ["navigation-scroll"]);
  fresh.restoration.dispose();

  storage.value = "corrupt";
  const corrupt = await createNativeScrollRestorationFromStorage(history, {
    storage,
    storageKey: "navigation-scroll",
    historySource: "restoration",
  });
  assert.ok(corrupt.restorationError);
  assert.deepEqual(corrupt.restoration.snapshot, { entries: [] });
  assert.deepEqual(removed, ["navigation-scroll", "navigation-scroll"]);
  corrupt.restoration.dispose();
});

test("reports durable scroll failures and cancels idle writes on disposal", async () => {
  const failure = new Error("scroll storage unavailable");
  const errors = [];
  let attempts = 0;
  let reads = 0;
  const history = new NativeHistory({ initialHref: "/" });
  const restoration = new NativeScrollRestoration(history);
  const storage = {
    value: null,
    async getItem() {
      reads++;
      return this.value;
    },
    async setItem(_key, value) {
      attempts++;
      if (attempts === 1) throw failure;
      this.value = value;
    },
    async removeItem() {},
  };
  await assert.rejects(
    createNativeScrollRestorationFromStorage(history, {
      storage,
      storageKey: "navigation-scroll",
      historySource: "unknown",
    }),
    /historySource/u,
  );
  assert.equal(reads, 0);
  assert.throws(
    () =>
      createNativeScrollRestorationPersistence(restoration, storage, {
        storageKey: "navigation-scroll",
        writeDelayMs: -1,
      }),
    /writeDelayMs/u,
  );
  const persistence = createNativeScrollRestorationPersistence(
    restoration,
    storage,
    {
      storageKey: "navigation-scroll",
      writeDelayMs: 5,
      async onError(error) {
        errors.push(error);
        throw new Error("diagnostic failure");
      },
    },
  );
  await assert.rejects(persistence.flush(), (error) => error === failure);
  assert.deepEqual(errors, [failure]);
  await persistence.flush();
  assert.equal(attempts, 2);
  assert.deepEqual(deserializeNativeScrollRestorationSnapshot(storage.value), {
    entries: [],
  });
  restoration.capture(history.location.id, "feed", { x: 0, y: 144 });
  await persistence.flush();
  assert.equal(attempts, 3);
  restoration.capture(history.location.id, "feed", { x: 0, y: 320 });
  persistence.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(attempts, 3);
  restoration.dispose();
});

test("retains a failed idle scroll snapshot without a hot retry loop", async () => {
  // Native adapters may reject with arbitrary values. An undefined rejection
  // must still be treated as failure rather than mistaken for success.
  const failure = undefined;
  const errors = [];
  const writes = [];
  let attempts = 0;
  const history = new NativeHistory({ initialHref: "/" });
  const restoration = new NativeScrollRestoration(history);
  restoration.capture(history.location.id, "feed", { x: 0, y: 240 });
  const persistence = createNativeScrollRestorationPersistence(
    restoration,
    {
      async getItem() {
        return null;
      },
      async setItem(_key, value) {
        attempts++;
        writes.push(value);
        if (attempts === 1) throw failure;
      },
      async removeItem() {},
    },
    {
      storageKey: "navigation-scroll",
      writeDelayMs: 1,
      onError(error) {
        errors.push(error);
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(attempts, 1);
  assert.deepEqual(errors, [failure]);
  await persistence.flush();
  assert.equal(attempts, 2);
  assert.equal(
    deserializeNativeScrollRestorationSnapshot(writes[1]).entries[0]
      .containers[0].y,
    240,
  );
  persistence.dispose();
  restoration.dispose();
});

test("coordinates selected native-tab histories and atomic cross-tab deep links", () => {
  const state = createNativeTabsState({
    tabs: [
      { key: "home", initialHref: "/home" },
      { key: "settings", initialHref: "/settings" },
    ],
  });
  const updates = [];
  state.subscribe((update) => updates.push(update));

  assert.equal(state.selectedKey(), "home");
  assert.equal(state.selectedHistory(), state.history("home"));
  state.history("home").push("/home/detail", { item: 42 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].kind, "history");
  assert.equal(updates[0].tabKey, "home");

  assert.equal(state.select("settings"), true);
  assert.equal(state.select("settings"), false);
  assert.equal(state.selectedHistory(), state.history("settings"));
  assert.equal(updates.length, 2);
  assert.equal(updates[1].kind, "selection");

  const linked = state.openDeepLink({
    tabKey: "home",
    href: "/home/inbox",
    state: { source: "live-link" },
  });
  assert.equal(linked.origin, "system");
  assert.equal(state.selectedKey(), "home");
  assert.equal(state.history("home").location.href, "/home/inbox");
  assert.equal(updates.length, 3);
  assert.equal(updates[2].kind, "deep-link");
  assert.equal(updates[2].selectedKey, "home");
  assert.equal(updates[2].historyUpdate.transition.id, linked.id);

  assert.equal(
    state.handleTabSelected({
      selectedKey: "settings",
      provenance: 1,
      repeated: false,
      triggeredSpecialEffect: false,
      actionOrigin: "user",
    }),
    true,
  );
  assert.equal(state.selectedKey(), "settings");
  assert.throws(() => state.history("missing"), /does not identify a tab/);

  state.dispose();
  state.dispose();
  assert.throws(() => state.select("home"), /is disposed/);
  state.history("settings").push("/settings/after-disposal");
  assert.equal(updates.length, 4);
});

test("round-trips and bounds versioned native-tabs restoration", () => {
  const state = createNativeTabsState({
    tabs: [
      { key: "home", initialHref: "/home" },
      { key: "settings", initialHref: "/settings" },
    ],
  });
  state.history("settings").push("/settings/detail", { item: 7 });
  state.select("settings");
  const serialized = serializeNativeTabsStateSnapshot(state.snapshot);
  const envelope = JSON.parse(serialized);
  assert.equal(envelope.version, 0);
  const restoredSnapshot = deserializeNativeTabsStateSnapshot(serialized);
  const restored = createNativeTabsState({
    tabs: [{ key: "settings" }, { key: "home" }],
    snapshot: restoredSnapshot,
  });
  assert.equal(restored.selectedKey(), "settings");
  assert.equal(restored.history("settings").location.href, "/settings/detail");
  assert.deepEqual(restored.history("settings").location.state, { item: 7 });

  assert.throws(
    () =>
      createNativeTabsState({
        tabs: [{ key: "home" }, { key: "profile" }],
        snapshot: restoredSnapshot,
      }),
    /keys do not match/,
  );
  assert.throws(
    () =>
      deserializeNativeTabsStateSnapshot(
        JSON.stringify({ version: 1, snapshot: restoredSnapshot }),
      ),
    /Unsupported native tabs state restoration version/,
  );
  assert.throws(
    () =>
      deserializeNativeTabsStateSnapshot(
        JSON.stringify({
          version: 0,
          snapshot: {
            selectedKey: "home",
            tabs: [
              restoredSnapshot.tabs[0],
              {
                ...restoredSnapshot.tabs[0],
                key: restoredSnapshot.tabs[0].key,
              },
            ],
          },
        }),
      ),
    /is duplicated/,
  );
  assert.throws(
    () =>
      deserializeNativeTabsStateSnapshot(
        "x".repeat(NATIVE_TABS_STATE_MAX_SERIALIZED_LENGTH + 1),
      ),
    /exceeds/,
  );
  restored.dispose();
  state.dispose();
});

test("gives a cross-tab cold deep link precedence over restoration", () => {
  const persisted = createNativeTabsState({
    tabs: [
      { key: "home", initialHref: "/home" },
      { key: "settings", initialHref: "/settings" },
    ],
  });
  persisted.history("settings").push("/settings/restored");
  persisted.select("settings");
  const serializedSnapshot = serializeNativeTabsStateSnapshot(
    persisted.snapshot,
  );
  persisted.dispose();

  const linked = createNativeTabsStateFromLaunch({
    tabs: [
      { key: "home", initialHref: "/home" },
      { key: "settings", initialHref: "/settings" },
    ],
    serializedSnapshot,
    initialURL: "solid-native://home/inbox",
    resolveDeepLink: (url) =>
      url.endsWith("/inbox")
        ? { tabKey: "home", href: "/home/inbox", state: { cold: true } }
        : undefined,
  });
  assert.equal(linked.source, "deep-link");
  assert.equal(linked.state.selectedKey(), "home");
  assert.equal(linked.state.history("home").location.href, "/home/inbox");
  assert.deepEqual(linked.state.history("home").location.state, {
    cold: true,
  });
  assert.equal(linked.state.history("home").canGoBack, false);
  assert.equal(linked.state.history("settings").location.href, "/settings");
  assert.throws(
    () =>
      createNativeTabsStateFromLaunch({
        tabs: [{ key: "home" }],
        initialURL: "solid-native://missing",
        resolveDeepLink: () => ({ tabKey: "missing", href: "/missing" }),
      }),
    /does not identify a configured tab/,
  );

  const restored = createNativeTabsStateFromLaunch({
    tabs: [
      { key: "home", initialHref: "/home" },
      { key: "settings", initialHref: "/settings" },
    ],
    serializedSnapshot,
    initialURL: "solid-native://unhandled",
    resolveDeepLink: () => undefined,
  });
  assert.equal(restored.source, "restoration");
  assert.equal(restored.state.selectedKey(), "settings");
  assert.equal(
    restored.state.history("settings").location.href,
    "/settings/restored",
  );

  const fallback = createNativeTabsStateFromLaunch({
    tabs: [{ key: "home", initialHref: "/safe" }],
    serializedSnapshot: "corrupt",
  });
  assert.equal(fallback.source, "initial");
  assert.equal(fallback.state.history("home").location.href, "/safe");
  assert.ok(fallback.restorationError);
  fallback.state.dispose();
  restored.state.dispose();
  linked.state.dispose();
});

test("loads native tabs and removes URL-discarded or corrupt restoration", async () => {
  const initial = createNativeTabsState({
    tabs: [{ key: "home" }, { key: "settings" }],
    selectedKey: "settings",
  });
  const serializedInitial = serializeNativeTabsStateSnapshot(initial.snapshot);
  const removed = [];
  const storage = {
    value: serializedInitial,
    async getItem(key) {
      assert.equal(key, "native-tabs");
      return this.value;
    },
    async setItem() {},
    async removeItem(key) {
      removed.push(key);
      this.value = null;
    },
  };
  initial.dispose();

  const restored = await createNativeTabsStateFromStorage({
    tabs: [{ key: "home" }, { key: "settings" }],
    storage,
    storageKey: "native-tabs",
  });
  assert.equal(restored.source, "restoration");
  assert.equal(restored.state.selectedKey(), "settings");
  assert.deepEqual(removed, []);
  restored.state.dispose();

  storage.value = serializedInitial;
  const linked = await createNativeTabsStateFromStorage({
    tabs: [{ key: "home" }, { key: "settings" }],
    storage,
    storageKey: "native-tabs",
    initialURL: "solid-native://settings/security",
    resolveDeepLink: () => ({
      tabKey: "settings",
      href: "/settings/security",
    }),
  });
  assert.equal(linked.source, "deep-link");
  assert.equal(linked.state.selectedKey(), "settings");
  assert.equal(
    linked.state.history("settings").location.href,
    "/settings/security",
  );
  assert.equal(linked.state.history("settings").canGoBack, false);
  assert.equal(storage.value, null);
  assert.deepEqual(removed, ["native-tabs"]);
  linked.state.dispose();

  storage.value = "corrupt";
  const fallback = await createNativeTabsStateFromStorage({
    tabs: [{ key: "home", initialHref: "/safe" }],
    storage,
    storageKey: "native-tabs",
  });
  assert.equal(fallback.source, "initial");
  assert.ok(fallback.restorationError);
  assert.deepEqual(removed, ["native-tabs", "native-tabs"]);
  fallback.state.dispose();
});

test("serializes and coalesces native-tabs selection and history writes", async () => {
  const firstWrite = deferred();
  const writes = [];
  const storage = {
    async getItem() {
      return null;
    },
    async setItem(key, value) {
      writes.push({ key, value });
      if (writes.length === 1) await firstWrite.promise;
    },
    async removeItem() {},
  };
  const state = createNativeTabsState({
    tabs: [{ key: "home" }, { key: "settings" }],
  });
  const persistence = createNativeTabsStatePersistence(state, storage, {
    storageKey: "native-tabs",
  });
  state.select("settings");
  state.history("settings").push("/settings/current");
  assert.equal(writes.length, 1);
  firstWrite.resolve();
  await persistence.flush();

  assert.equal(writes.length, 2);
  assert.equal(writes[0].key, "native-tabs");
  const persisted = deserializeNativeTabsStateSnapshot(writes[1].value);
  assert.equal(persisted.selectedKey, "settings");
  const settings = persisted.tabs.find((tab) => tab.key === "settings");
  assert.equal(
    settings.history.entries[settings.history.index].href,
    "/settings/current",
  );

  persistence.dispose();
  persistence.dispose();
  state.select("home");
  await persistence.flush();
  assert.equal(writes.length, 2);
  state.dispose();
});

test("retries the newest native-tabs snapshot after storage recovers", async () => {
  const failure = new Error("native tabs storage unavailable");
  const errors = [];
  const writes = [];
  let attempts = 0;
  const state = createNativeTabsState({
    tabs: [{ key: "home" }, { key: "settings" }],
  });
  const persistence = createNativeTabsStatePersistence(
    state,
    {
      async getItem() {
        return null;
      },
      async setItem(_key, value) {
        attempts++;
        writes.push(value);
        if (attempts === 1) throw failure;
      },
      async removeItem() {},
    },
    {
      storageKey: "native-tabs",
      onError(error) {
        errors.push(error);
      },
    },
  );

  state.select("settings");
  state.history("settings").push("/settings/recovered");
  await assert.rejects(persistence.flush(), (error) => error === failure);
  assert.deepEqual(errors, [failure]);
  await persistence.flush();
  assert.equal(attempts, 2);
  const persisted = deserializeNativeTabsStateSnapshot(writes[1]);
  assert.equal(persisted.selectedKey, "settings");
  const settings = persisted.tabs.find((tab) => tab.key === "settings");
  assert.equal(
    settings.history.entries[settings.history.index].href,
    "/settings/recovered",
  );
  persistence.dispose();
  state.dispose();
});

test("rejects malformed, oversized, or unsupported restoration envelopes", () => {
  assert.throws(() => deserializeNativeHistorySnapshot("{"), /not valid JSON/);
  assert.throws(
    () =>
      deserializeNativeHistorySnapshot(
        JSON.stringify({ version: 1, snapshot: {} }),
      ),
    /Unsupported native history restoration version/,
  );
  assert.throws(
    () =>
      deserializeNativeHistorySnapshot(
        "x".repeat(NATIVE_HISTORY_MAX_SERIALIZED_LENGTH + 1),
      ),
    /exceeds/,
  );
  assert.throws(
    () =>
      deserializeNativeHistorySnapshot(
        JSON.stringify({
          version: 0,
          snapshot: {
            entries: [
              { id: "duplicate", href: "/", state: null },
              { id: "duplicate", href: "/next", state: null },
            ],
            index: 1,
          },
        }),
      ),
    /Duplicate native screen id/,
  );
});

test("validates navigation state and preserves ID allocation after rejection", () => {
  const history = new NativeHistory({ initialHref: "/" });
  const circular = {};
  circular.self = circular;
  const oversizedState = "x".repeat(NATIVE_HISTORY_MAX_SERIALIZED_LENGTH);

  assert.throws(() => history.push("/circular", circular), /circular value/);
  assert.throws(() => history.push("/date", new Date()), /plain/);
  assert.throws(() => history.replace("/infinite", Infinity), /finite/);
  assert.throws(
    () =>
      history.reset([
        { href: "/valid", state: null },
        { href: "", state: null },
      ]),
    /character string/,
  );
  const beforeOversizedMutations = history.snapshot;
  assert.throws(
    () => new NativeHistory({ initialState: oversizedState }),
    /Serialized native history exceeds/u,
  );
  assert.throws(
    () => history.push("/oversized", oversizedState),
    /Serialized native history exceeds/u,
  );
  assert.throws(
    () => history.openDeepLink("/oversized-link", oversizedState),
    /Serialized native history exceeds/u,
  );
  assert.throws(
    () => history.replace("/oversized-replace", oversizedState),
    /Serialized native history exceeds/u,
  );
  assert.throws(
    () =>
      history.reset([
        { href: "/first", state: null },
        { href: "/oversized-reset", state: oversizedState },
      ]),
    /Serialized native history exceeds/u,
  );
  assert.deepEqual(history.snapshot, beforeOversizedMutations);
  const valid = history.push("/valid", { safe: true });
  assert.equal(valid.to.id, "screen-2");
  assert.equal(history.location.href, "/valid");
});

test("bounds active and restored native history stacks", () => {
  const history = new NativeHistory({ initialHref: "/" });
  for (let index = 1; index < NATIVE_HISTORY_MAX_ENTRIES; index++) {
    const transition = history.push(`/screen/${String(index)}`);
    assert.equal(history.acknowledgeApplicationTransition(transition.id), true);
  }
  assert.equal(history.snapshot.entries.length, NATIVE_HISTORY_MAX_ENTRIES);
  assert.throws(() => history.push("/overflow"), /cannot exceed/);
  assert.equal(
    history.location.href,
    `/screen/${String(NATIVE_HISTORY_MAX_ENTRIES - 1)}`,
  );

  const entries = Array.from(
    { length: NATIVE_HISTORY_MAX_ENTRIES + 1 },
    (_, index) => ({
      id: `restored-${String(index)}`,
      href: `/restored/${String(index)}`,
      state: null,
    }),
  );
  assert.throws(
    () => new NativeHistory({ snapshot: { entries, index: 0 } }),
    /requires 1-512 entries/,
  );
});

test("maps native URL events into system-originated deep-link entries", () => {
  const history = new NativeHistory({ initialHref: "/" });
  const transitions = [];
  const handler = createDeepLinkHandler(history, {
    resolve(url) {
      if (!url.startsWith("example://navigation/")) return undefined;
      return { href: "/linked", state: { source: url } };
    },
    onTransition: (transition) => transitions.push(transition),
  });

  assert.equal(handler({ url: "ignored://outside" }), undefined);
  const transition = handler({ url: "example://navigation/details?id=42" });
  assert.ok(transition);
  assert.equal(transition.kind, "push");
  assert.equal(transition.origin, "system");
  assert.equal(history.location.href, "/linked");
  assert.deepEqual(history.location.state, {
    source: "example://navigation/details?id=42",
  });
  assert.equal(transitions.length, 1);
});

test("reports malformed native URL events without mutating history", async () => {
  const history = new NativeHistory({ initialHref: "/" });
  const errors = [];
  let diagnosticRejections = 0;
  const handler = createDeepLinkHandler(history, {
    onError(error) {
      errors.push(error);
      return {
        then(_resolve, reject) {
          diagnosticRejections++;
          reject(new Error("deep-link diagnostic failed"));
        },
      };
    },
  });

  assert.equal(handler({ url: null }), undefined);
  assert.equal(handler({}), undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 2);
  assert.equal(diagnosticRejections, 2);
  assert.equal(history.location.href, "/");
  assert.equal(history.snapshot.entries.length, 1);
});

test("restores a validated stack during cold launch", () => {
  const serializedSnapshot = serializeNativeHistorySnapshot({
    entries: [
      { id: "restored-root", href: "/", state: null },
      {
        id: "restored-detail",
        href: "/restored",
        state: { source: "storage" },
      },
    ],
    index: 1,
  });
  const result = createNativeHistoryFromLaunch({ serializedSnapshot });

  assert.equal(result.source, "restoration");
  assert.equal(result.restorationError, undefined);
  assert.equal(result.history.location.id, "restored-detail");
  assert.deepEqual(result.history.location.state, { source: "storage" });
  assert.equal(result.history.pendingApplicationTransitionCount, 0);
});

test("gives an accepted cold-start deep link precedence over restoration", () => {
  const serializedSnapshot = serializeNativeHistorySnapshot({
    entries: [
      { id: "restored-root", href: "/", state: null },
      { id: "private-screen", href: "/account", state: null },
    ],
    index: 1,
  });
  const result = createNativeHistoryFromLaunch({
    serializedSnapshot,
    initialURL: "example://navigation/inbox?id=42",
    resolveDeepLink: (url) => ({ href: "/inbox/42", state: { url } }),
  });

  assert.equal(result.source, "deep-link");
  assert.equal(result.initialURL, "example://navigation/inbox?id=42");
  assert.equal(result.history.location.href, "/inbox/42");
  assert.deepEqual(result.history.location.state, {
    url: "example://navigation/inbox?id=42",
  });
  assert.equal(result.history.snapshot.entries.length, 1);
  assert.equal(result.history.canGoBack, false);
  assert.equal(result.history.pendingApplicationTransitionCount, 0);
});

test("restores after the application ignores an unrelated initial URL", () => {
  const serializedSnapshot = serializeNativeHistorySnapshot({
    entries: [{ id: "restored-root", href: "/restored", state: null }],
    index: 0,
  });
  const result = createNativeHistoryFromLaunch({
    serializedSnapshot,
    initialURL: "outside://unowned",
    resolveDeepLink: () => undefined,
  });

  assert.equal(result.source, "restoration");
  assert.equal(result.initialURL, "outside://unowned");
  assert.equal(result.history.location.href, "/restored");
});

test("reports corrupt restoration and safely falls back to the initial route", () => {
  const result = createNativeHistoryFromLaunch({
    initialHref: "/safe",
    initialState: { recovered: true },
    serializedSnapshot: '{"version":999}',
  });

  assert.equal(result.source, "initial");
  assert.match(
    String(result.restorationError),
    /Unsupported native history restoration version/,
  );
  assert.equal(result.history.location.href, "/safe");
  assert.deepEqual(result.history.location.state, { recovered: true });
  assert.equal(result.history.pendingApplicationTransitionCount, 0);
});

test("treats non-string restoration values as recoverable storage corruption", () => {
  const result = createNativeHistoryFromLaunch({
    initialHref: "/safe",
    serializedSnapshot: { unexpectedlyDecoded: true },
  });

  assert.equal(result.source, "initial");
  assert.match(
    String(result.restorationError),
    /Serialized native history must be a string/,
  );
  assert.equal(result.history.location.href, "/safe");
});

test("rejects malformed cold-start URL inputs before restoration", () => {
  const serializedSnapshot = serializeNativeHistorySnapshot({
    entries: [{ id: "restored-root", href: "/restored", state: null }],
    index: 0,
  });

  assert.throws(
    () =>
      createNativeHistoryFromLaunch({
        serializedSnapshot,
        initialURL: { malicious: true },
      }),
    /native initial deep-link URL/,
  );
});
