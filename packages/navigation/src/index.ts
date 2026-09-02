import type { HostValue } from "@solid-native/host-contract";
import {
  Modal,
  Screen,
  ScreenStack,
  ScrollView,
  TabsHost,
  TabsScreen,
  View,
  createCausalPlatformEventHandler,
  createMemoryWarningCount,
  retainCausalNativeEvent,
  retainCausalPlatformEvent,
  type MemoryWarningSource,
  type NativeCausalEventRetention,
  type ModalProps,
  type ScreenProps,
  type ScreenSheetDetentChangeEvent,
  type ScrollViewHandle,
  type ScrollViewProps,
  type StyleProp,
  type TabsHostProps,
  type TabsScreenAndroidIcon,
  type TabsScreenAppearance,
  type TabsScreenAppearanceAndroid,
  type TabsScreenAppearanceIOS,
  type TabsScreenBlurEffect,
  type TabsScreenFontStyle,
  type TabsScreenFontWeight,
  type TabsScreenIcon,
  type TabsScreenIOSIcon,
  type TabsScreenItemAppearanceIOS,
  type TabsScreenItemLabelVisibilityMode,
  type TabsScreenItemStateAppearanceAndroid,
  type TabsScreenItemStateAppearanceIOS,
  type TabsScreenProps,
  type TabsScreenScrollEdgeAppearance,
  type TabsScreenTitlePositionAdjustment,
} from "@solid-native/core";
import {
  createComponent,
  effect,
  type NativeNode,
  type NativeSyntheticEvent,
} from "@solid-native/renderer";
import {
  Show,
  createContext,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  mapArray,
  onCleanup,
  onSettled,
  untrack,
  useContext,
  type Accessor,
} from "solid-js";
import type { AnyRouter, RouterState } from "@tanstack/router-core";
import {
  parseHref as parseTanStackHref,
  type HistoryAction,
  type HistoryLocation,
  type NavigateOptions,
  type NavigationBlocker,
  type ParsedHistoryState,
  type RouterHistory,
} from "@tanstack/history";

import { reportIsolatedError } from "./error-reporting.js";
import { TanStackNativeMatches } from "./tanstack-matches.js";
import { useTanStackNativeRouter } from "./tanstack-router.js";

export type {
  ScreenSheetDetentChangeEvent,
  ScreenSheetDetentChangePayload,
  ScreenSheetDetents,
  ScreenSheetInitialDetent,
  ScreenSheetLargestUndimmedDetent,
  TabsScreenAppearance,
  TabsScreenAppearanceAndroid,
  TabsScreenAppearanceIOS,
  TabsScreenAndroidIcon,
  TabsScreenBlurEffect,
  TabsScreenFontStyle,
  TabsScreenFontWeight,
  TabsScreenIcon,
  TabsScreenIOSIcon,
  TabsScreenItemAppearanceIOS,
  TabsScreenItemLabelVisibilityMode,
  TabsScreenItemStateAppearanceAndroid,
  TabsScreenItemStateAppearanceIOS,
  TabsScreenScrollEdgeAppearance,
  TabsScreenTitlePositionAdjustment,
} from "@solid-native/core";
export {
  createTanStackNativeRouter,
  getSolidNativeRouterStoreConfig,
  TanStackNativeLink,
  TanStackNativeRouterProvider,
  TanStackNativeRouteView,
  TanStackRootRoute,
  TanStackRoute,
  tanStackRedirect,
  useTanStackNativeNavigate,
  useTanStackNativeRouter,
} from "./tanstack-router.js";
export type {
  AnyTanStackRoute,
  AnyTanStackRouter,
  TanStackNativeLinkPressableProps,
  TanStackNativeLinkPreload,
  TanStackNativeLinkProps,
  TanStackNativeLinkState,
  TanStackNativeRouterProviderProps,
  TanStackNativeRouteMatch,
  TanStackNativeRouteViewProps,
  TanStackRouterState,
  UseTanStackNativeNavigateOptions,
} from "./tanstack-router.js";
export {
  TanStackNativeMatch,
  TanStackNativeMatches,
  TanStackNativeOutlet,
  useTanStackNativeLoaderData,
  useTanStackNativeMatch,
} from "./tanstack-matches.js";
export type {
  TanStackNativeErrorComponent,
  TanStackNativeErrorComponentProps,
  TanStackNativeNotFoundComponent,
  TanStackNativeNotFoundComponentProps,
  TanStackNativePendingComponent,
  TanStackNativePendingComponentProps,
  TanStackNativeMatchesProps,
  TanStackNativeRouteComponent,
  UseTanStackNativeLoaderDataOptions,
  UseTanStackNativeLoaderDataResult,
  UseTanStackNativeMatchOptions,
  UseTanStackNativeMatchResult,
} from "./tanstack-matches.js";

export type NavigationOrigin =
  "application" | "platform" | "system" | "restoration";
export type NavigationKind = "push" | "replace" | "pop" | "traverse" | "reset";

export const NATIVE_HISTORY_RESTORATION_VERSION = 0 as const;
export const NATIVE_HISTORY_MAX_ENTRIES = 512;
export const NATIVE_HISTORY_MAX_SERIALIZED_LENGTH = 1_048_576;

const NATIVE_HISTORY_MAX_ENTRY_ID_LENGTH = 256;
const NATIVE_HISTORY_MAX_HREF_LENGTH = 16_384;
const NATIVE_HISTORY_MAX_STATE_DEPTH = 64;
const NATIVE_HISTORY_MAX_STATE_VALUES = 100_000;

export interface NativeHistoryEntry {
  readonly id: string;
  readonly href: string;
  readonly state: HostValue;
}

export interface NativeHistorySnapshot {
  readonly entries: readonly NativeHistoryEntry[];
  readonly index: number;
}

export interface NativeNavigationTransition {
  readonly id: string;
  readonly kind: NavigationKind;
  readonly origin: NavigationOrigin;
  readonly from: NativeHistoryEntry;
  readonly to: NativeHistoryEntry;
  readonly delta: number;
}

export interface NativeHistoryUpdate {
  readonly transition: NativeNavigationTransition;
  readonly snapshot: NativeHistorySnapshot;
}

export type NativeHistoryListener = (update: NativeHistoryUpdate) => void;
export type NativePlatformTransitionBlocker = (
  transition: NativeNavigationTransition,
) => boolean | Promise<boolean>;
export type NativePlatformTransitionBlockerListener = (
  hasBlockers: boolean,
) => void;

export interface NativeHistoryOptions {
  readonly initialHref?: string;
  readonly initialState?: HostValue;
  readonly snapshot?: NativeHistorySnapshot;
}

export type NativeHistoryLaunchSource = "initial" | "restoration" | "deep-link";

export interface NativeHistoryLaunchOptions {
  readonly initialHref?: string;
  readonly initialState?: HostValue;
  /** Untrusted value returned by the application shell's persistence layer. */
  readonly serializedSnapshot?: unknown;
  /** Untrusted value returned by the platform's initial-URL API. */
  readonly initialURL?: unknown;
  readonly resolveDeepLink?: (url: string) => NativeDeepLinkTarget | undefined;
}

export interface NativeHistoryLaunchResult {
  readonly history: NativeHistory;
  readonly source: NativeHistoryLaunchSource;
  readonly initialURL?: string;
  /** Present when corrupt or obsolete stored state was discarded. */
  readonly restorationError?: unknown;
}

export interface NativeHistoryPersistenceStorage {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

export interface StoredNativeHistoryLaunchOptions extends Omit<
  NativeHistoryLaunchOptions,
  "serializedSnapshot"
> {
  readonly storage: NativeHistoryPersistenceStorage;
  readonly storageKey: string;
}

export interface NativeHistoryPersistenceOptions {
  readonly storageKey: string;
  readonly onError?: (error: unknown) => unknown;
}

export interface NativeHistoryPersistence {
  /** Writes or retries the newest scheduled snapshot and awaits durability. */
  flush(): Promise<void>;
  /** Stops observing history. Already-started native writes still settle. */
  dispose(): void;
}

export interface TanStackNativeHistoryOptions {
  /** Converts a router href into the form exposed by links to the host shell. */
  readonly createHref?: (href: string) => string;
  /** Called after a TanStack navigation blocker rejects a programmatic move. */
  readonly onBlocked?: () => unknown;
  /** Reports a blocker failure; without a handler it reaches the global queue. */
  readonly onNavigationError?: (error: unknown) => unknown;
}

interface PendingPlatformTransition {
  readonly transition: NativeNavigationTransition;
  readonly targetIndex: number;
}

interface StateCloneContext {
  readonly ancestors: Set<object>;
  values: number;
}

function cloneStateValue(
  value: unknown,
  path: string,
  context: StateCloneContext,
  depth: number,
): HostValue {
  if (depth > NATIVE_HISTORY_MAX_STATE_DEPTH) {
    throw new RangeError(
      `${path} exceeds the maximum navigation state depth of ${NATIVE_HISTORY_MAX_STATE_DEPTH}.`,
    );
  }
  context.values++;
  if (context.values > NATIVE_HISTORY_MAX_STATE_VALUES) {
    throw new RangeError(
      `${path} exceeds the maximum navigation state size of ${NATIVE_HISTORY_MAX_STATE_VALUES} values.`,
    );
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} is not transport-safe navigation state.`);
  }
  if (context.ancestors.has(value)) {
    throw new TypeError(`${path} contains a circular value.`);
  }

  if (Array.isArray(value)) {
    context.ancestors.add(value);
    const result = value.map((entry, index) =>
      cloneStateValue(entry, `${path}[${String(index)}]`, context, depth + 1),
    );
    context.ancestors.delete(value);
    return result;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain transport-safe object.`);
  }
  context.ancestors.add(value);
  const entries = Object.entries(value).map(
    ([key, entry]) =>
      [
        key,
        cloneStateValue(entry, `${path}.${key}`, context, depth + 1),
      ] as const,
  );
  context.ancestors.delete(value);
  return Object.fromEntries(entries);
}

function cloneValue(value: unknown, path = "navigation state"): HostValue {
  return cloneStateValue(
    value,
    path,
    { ancestors: new Set<object>(), values: 0 },
    0,
  );
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function normalizeEntryId(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > NATIVE_HISTORY_MAX_ENTRY_ID_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${path} must be a 1-${NATIVE_HISTORY_MAX_ENTRY_ID_LENGTH} character string without null bytes.`,
    );
  }
  return value;
}

function normalizeHref(value: unknown, path = "navigation href"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > NATIVE_HISTORY_MAX_HREF_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${path} must be a 1-${NATIVE_HISTORY_MAX_HREF_LENGTH} character string without null bytes.`,
    );
  }
  return value;
}

function cloneEntry(entry: NativeHistoryEntry): NativeHistoryEntry {
  return {
    id: entry.id,
    href: entry.href,
    state: cloneValue(entry.state),
  };
}

function normalizeSnapshot(value: unknown): NativeHistorySnapshot {
  const snapshot = plainRecord(value, "native history snapshot");
  if (!Array.isArray(snapshot.entries)) {
    throw new TypeError("Native history snapshot entries must be an array.");
  }
  if (
    snapshot.entries.length === 0 ||
    snapshot.entries.length > NATIVE_HISTORY_MAX_ENTRIES
  ) {
    throw new RangeError(
      `Native history requires 1-${NATIVE_HISTORY_MAX_ENTRIES} entries.`,
    );
  }
  if (
    !Number.isInteger(snapshot.index) ||
    (snapshot.index as number) < 0 ||
    (snapshot.index as number) >= snapshot.entries.length
  ) {
    throw new RangeError(
      `Native history index ${String(snapshot.index)} is out of range.`,
    );
  }
  const ids = new Set<string>();
  const entries = snapshot.entries.map((value, index) => {
    const path = `native history snapshot entry ${String(index)}`;
    const entry = plainRecord(value, path);
    const id = normalizeEntryId(entry.id, `${path} id`);
    if (ids.has(id)) {
      throw new Error(`Duplicate native screen id: ${id}.`);
    }
    ids.add(id);
    return {
      id,
      href: normalizeHref(entry.href, `${path} href`),
      state: cloneValue(entry.state, `${path} state`),
    };
  });
  return {
    entries,
    index: snapshot.index as number,
  };
}

export function serializeNativeHistorySnapshot(
  snapshot: NativeHistorySnapshot,
): string {
  return serializeNormalizedNativeHistorySnapshot(normalizeSnapshot(snapshot));
}

function serializeNormalizedNativeHistorySnapshot(
  snapshot: NativeHistorySnapshot,
): string {
  const serialized = JSON.stringify({
    version: NATIVE_HISTORY_RESTORATION_VERSION,
    snapshot,
  });
  if (serialized.length > NATIVE_HISTORY_MAX_SERIALIZED_LENGTH) {
    throw new RangeError(
      `Serialized native history exceeds ${NATIVE_HISTORY_MAX_SERIALIZED_LENGTH} characters.`,
    );
  }
  return serialized;
}

export function deserializeNativeHistorySnapshot(
  serialized: unknown,
): NativeHistorySnapshot {
  if (typeof serialized !== "string") {
    throw new TypeError("Serialized native history must be a string.");
  }
  if (serialized.length > NATIVE_HISTORY_MAX_SERIALIZED_LENGTH) {
    throw new RangeError(
      `Serialized native history exceeds ${NATIVE_HISTORY_MAX_SERIALIZED_LENGTH} characters.`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    throw new SyntaxError("Serialized native history is not valid JSON.");
  }
  const envelope = plainRecord(decoded, "native history restoration");
  if (envelope.version !== NATIVE_HISTORY_RESTORATION_VERSION) {
    throw new Error(
      `Unsupported native history restoration version: ${String(envelope.version)}.`,
    );
  }
  return normalizeSnapshot(envelope.snapshot);
}

export class NativeHistory {
  readonly #listeners = new Set<NativeHistoryListener>();
  readonly #platformTransitionBlockers =
    new Set<NativePlatformTransitionBlocker>();
  readonly #platformTransitionBlockerListeners =
    new Set<NativePlatformTransitionBlockerListener>();
  readonly #awaitingApplicationAck = new Set<string>();
  readonly #pendingPlatform = new Map<string, PendingPlatformTransition>();
  // Generated IDs are monotonic, so only restored IDs need to be reserved.
  // Retaining every screen ID ever visited would turn ordinary push/pop churn
  // into an unbounded history-side memory cost.
  readonly #reservedRestoredEntryIds = new Set<string>();
  #entries: NativeHistoryEntry[];
  #index: number;
  #nextEntry = 1;
  #nextTransition = 1;

  constructor(options: NativeHistoryOptions = {}) {
    if (options.snapshot !== undefined) {
      const snapshot = normalizeSnapshot(options.snapshot);
      serializeNormalizedNativeHistorySnapshot(snapshot);
      this.#entries = [...snapshot.entries];
      this.#index = snapshot.index;
      for (const entry of this.#entries) {
        this.#reservedRestoredEntryIds.add(entry.id);
      }
    } else {
      this.#entries = [
        this.#createEntry(
          options.initialHref ?? "/",
          options.initialState ?? null,
        ),
      ];
      this.#index = 0;
      serializeNormalizedNativeHistorySnapshot(this.snapshot);
    }
  }

  get location(): NativeHistoryEntry {
    return cloneEntry(this.#entries[this.#index] as NativeHistoryEntry);
  }

  get canGoBack(): boolean {
    return this.#index > 0;
  }

  get canGoForward(): boolean {
    return this.#index < this.#entries.length - 1;
  }

  get pendingApplicationTransitionCount(): number {
    return this.#awaitingApplicationAck.size;
  }

  get hasPendingPlatformTransition(): boolean {
    return this.#pendingPlatform.size > 0;
  }

  get hasPlatformTransitionBlockers(): boolean {
    return this.#platformTransitionBlockers.size > 0;
  }

  get snapshot(): NativeHistorySnapshot {
    return {
      entries: this.#entries.map(cloneEntry),
      index: this.#index,
    };
  }

  subscribe(listener: NativeHistoryListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  subscribePlatformTransitionBlockers(
    listener: NativePlatformTransitionBlockerListener,
  ): () => void {
    this.#platformTransitionBlockerListeners.add(listener);
    return () => {
      this.#platformTransitionBlockerListeners.delete(listener);
    };
  }

  blockPlatformTransitions(
    blocker: NativePlatformTransitionBlocker,
  ): () => void {
    const wasEmpty = this.#platformTransitionBlockers.size === 0;
    const registered: NativePlatformTransitionBlocker = (transition) =>
      blocker(transition);
    this.#platformTransitionBlockers.add(registered);
    if (wasEmpty) this.#notifyPlatformTransitionBlockers(true);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (!this.#platformTransitionBlockers.delete(registered)) return;
      if (this.#platformTransitionBlockers.size === 0) {
        this.#notifyPlatformTransitionBlockers(false);
      }
    };
  }

  push(href: string, state: HostValue = null): NativeNavigationTransition {
    if (this.#index + 1 >= NATIVE_HISTORY_MAX_ENTRIES) {
      throw new RangeError(
        `Native history cannot exceed ${NATIVE_HISTORY_MAX_ENTRIES} active entries.`,
      );
    }
    const from = this.#entries[this.#index] as NativeHistoryEntry;
    const previousNextEntry = this.#nextEntry;
    let to: NativeHistoryEntry;
    let next: NativeHistoryEntry[];
    try {
      to = this.#createEntry(href, state);
      next = [...this.#entries.slice(0, this.#index + 1), to];
      serializeNormalizedNativeHistorySnapshot({
        entries: next,
        index: this.#index + 1,
      });
    } catch (error) {
      this.#nextEntry = previousNextEntry;
      throw error;
    }
    this.#entries = next;
    this.#index++;
    return this.#publish("push", "application", from, to, 1, true);
  }

  replace(href: string, state: HostValue = null): NativeNavigationTransition {
    const from = this.#entries[this.#index] as NativeHistoryEntry;
    const to: NativeHistoryEntry = {
      ...from,
      href: normalizeHref(href),
      state: cloneValue(state),
    };
    const next = [...this.#entries];
    next[this.#index] = to;
    serializeNormalizedNativeHistorySnapshot({
      entries: next,
      index: this.#index,
    });
    this.#entries = next;
    return this.#publish("replace", "application", from, to, 0, true);
  }

  back(count = 1): NativeNavigationTransition | undefined {
    const targetIndex = this.#backIndex(count);
    return this.#moveTo(targetIndex, "pop");
  }

  forward(count = 1): NativeNavigationTransition | undefined {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Forward count must be a positive integer.");
    }
    const targetIndex = Math.min(this.#entries.length - 1, this.#index + count);
    return this.#moveTo(targetIndex, "traverse");
  }

  go(delta: number): NativeNavigationTransition | undefined {
    if (!Number.isInteger(delta)) {
      throw new Error("History delta must be an integer.");
    }
    if (delta === 0) return undefined;
    const targetIndex = Math.min(
      this.#entries.length - 1,
      Math.max(0, this.#index + delta),
    );
    return this.#moveTo(targetIndex, delta < 0 ? "pop" : "traverse");
  }

  reset(
    entries: readonly Omit<NativeHistoryEntry, "id">[],
    index = entries.length - 1,
  ): NativeNavigationTransition {
    if (entries.length === 0 || entries.length > NATIVE_HISTORY_MAX_ENTRIES) {
      throw new RangeError(
        `Native history reset requires 1-${NATIVE_HISTORY_MAX_ENTRIES} entries.`,
      );
    }
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
      throw new RangeError(
        `Native history index ${String(index)} is out of range.`,
      );
    }
    const from = this.#entries[this.#index] as NativeHistoryEntry;
    const previousNextEntry = this.#nextEntry;
    let next: NativeHistoryEntry[];
    try {
      next = entries.map((entry) => this.#createEntry(entry.href, entry.state));
      serializeNormalizedNativeHistorySnapshot({ entries: next, index });
    } catch (error) {
      this.#nextEntry = previousNextEntry;
      throw error;
    }
    this.#entries = next;
    this.#index = index;
    const to = next[index] as NativeHistoryEntry;
    return this.#publish("reset", "application", from, to, 0, true);
  }

  openDeepLink(
    href: string,
    state: HostValue = null,
  ): NativeNavigationTransition {
    if (this.#index + 1 >= NATIVE_HISTORY_MAX_ENTRIES) {
      throw new RangeError(
        `Native history cannot exceed ${NATIVE_HISTORY_MAX_ENTRIES} active entries.`,
      );
    }
    const from = this.#entries[this.#index] as NativeHistoryEntry;
    const previousNextEntry = this.#nextEntry;
    let to: NativeHistoryEntry;
    let next: NativeHistoryEntry[];
    try {
      to = this.#createEntry(href, state);
      next = [...this.#entries.slice(0, this.#index + 1), to];
      serializeNormalizedNativeHistorySnapshot({
        entries: next,
        index: this.#index + 1,
      });
    } catch (error) {
      this.#nextEntry = previousNextEntry;
      throw error;
    }
    this.#entries = next;
    this.#index++;
    return this.#publish("push", "system", from, to, 1, true);
  }

  requestPlatformBack(count = 1): NativeNavigationTransition | undefined {
    if (this.#pendingPlatform.size > 0) {
      throw new Error("A platform navigation transition is already pending.");
    }
    const targetIndex = this.#backIndex(count);
    if (targetIndex === this.#index) return undefined;
    const transition = this.#transition(
      "pop",
      "platform",
      this.#entries[this.#index] as NativeHistoryEntry,
      this.#entries[targetIndex] as NativeHistoryEntry,
      targetIndex - this.#index,
    );
    this.#pendingPlatform.set(transition.id, { transition, targetIndex });
    return transition;
  }

  completePlatformTransition(id: string, completed: boolean): boolean {
    const pending = this.#pendingPlatform.get(id);
    if (pending === undefined) return false;
    this.#pendingPlatform.delete(id);
    if (!completed) return true;
    if (
      (this.#entries[this.#index] as NativeHistoryEntry).id !==
      pending.transition.from.id
    ) {
      return false;
    }
    this.#index = pending.targetIndex;
    this.#notify(pending.transition);
    return true;
  }

  async isPlatformTransitionBlocked(id: string): Promise<boolean> {
    const pending = this.#pendingPlatform.get(id);
    if (pending === undefined) {
      throw new Error(`Unknown platform navigation transition ${id}.`);
    }
    for (const blocker of [...this.#platformTransitionBlockers]) {
      const blocked = await blocker({
        ...pending.transition,
        from: cloneEntry(pending.transition.from),
        to: cloneEntry(pending.transition.to),
      });
      if (typeof blocked !== "boolean") {
        throw new TypeError(
          "A native platform transition blocker must return a boolean.",
        );
      }
      if (blocked) return true;
    }
    return false;
  }

  acknowledgeTransition(id: string): boolean {
    return this.#awaitingApplicationAck.delete(id);
  }

  acknowledgeApplicationTransition(id: string): boolean {
    return this.acknowledgeTransition(id);
  }

  #backIndex(count: number): number {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Back count must be a positive integer.");
    }
    return Math.max(0, this.#index - count);
  }

  #moveTo(
    targetIndex: number,
    kind: "pop" | "traverse",
  ): NativeNavigationTransition | undefined {
    if (targetIndex === this.#index) return undefined;
    const from = this.#entries[this.#index] as NativeHistoryEntry;
    const to = this.#entries[targetIndex] as NativeHistoryEntry;
    const delta = targetIndex - this.#index;
    this.#index = targetIndex;
    return this.#publish(kind, "application", from, to, delta, true);
  }

  #createEntry(href: string, state: HostValue): NativeHistoryEntry {
    const normalizedHref = normalizeHref(href);
    const normalizedState = cloneValue(state);
    let id: string;
    do {
      id = `screen-${this.#nextEntry++}`;
    } while (this.#reservedRestoredEntryIds.has(id));
    return {
      id,
      href: normalizedHref,
      state: normalizedState,
    };
  }

  #transition(
    kind: NavigationKind,
    origin: NavigationOrigin,
    from: NativeHistoryEntry,
    to: NativeHistoryEntry,
    delta: number,
  ): NativeNavigationTransition {
    return {
      id: `navigation-${this.#nextTransition++}`,
      kind,
      origin,
      from: cloneEntry(from),
      to: cloneEntry(to),
      delta,
    };
  }

  #publish(
    kind: NavigationKind,
    origin: NavigationOrigin,
    from: NativeHistoryEntry,
    to: NativeHistoryEntry,
    delta: number,
    requiresAcknowledgement: boolean,
  ): NativeNavigationTransition {
    const transition = this.#transition(kind, origin, from, to, delta);
    if (requiresAcknowledgement) {
      this.#awaitingApplicationAck.add(transition.id);
    }
    this.#notify(transition);
    return transition;
  }

  #notify(transition: NativeNavigationTransition): void {
    const update: NativeHistoryUpdate = {
      transition,
      snapshot: this.snapshot,
    };
    for (const listener of [...this.#listeners]) listener(update);
  }

  #notifyPlatformTransitionBlockers(hasBlockers: boolean): void {
    for (const listener of [...this.#platformTransitionBlockerListeners]) {
      try {
        listener(hasBlockers);
      } catch {
        // Blocker-presence observers update presentation policy only. One
        // failing observer cannot strand every future platform transition.
      }
    }
  }
}

const TANSTACK_NATIVE_STATE_KEY = "__solidNativeState";
const nativeHistoryByTanStackHistory = new WeakMap<
  RouterHistory,
  NativeHistory
>();

type TanStackSubscriberAction = Parameters<RouterHistory["notify"]>[0];
type TanStackSubscriber =
  RouterHistory["subscribers"] extends Set<infer T> ? T : never;

function tanStackState(
  entry: NativeHistoryEntry,
  index: number,
): ParsedHistoryState {
  const nativeState = entry.state;
  let state: Readonly<Record<string, HostValue>>;
  if (
    nativeState !== null &&
    typeof nativeState === "object" &&
    !Array.isArray(nativeState)
  ) {
    state = nativeState as Readonly<Record<string, HostValue>>;
  } else if (nativeState === null) {
    state = {};
  } else {
    state = { [TANSTACK_NATIVE_STATE_KEY]: nativeState };
  }
  const legacyKey = typeof state.key === "string" ? state.key : undefined;
  const routerKey =
    typeof state.__TSR_key === "string"
      ? state.__TSR_key
      : (legacyKey ?? entry.id);
  return {
    ...state,
    key: legacyKey ?? routerKey,
    __TSR_key: routerKey,
    __TSR_index: index,
  };
}

function tanStackLocation(history: NativeHistory) {
  const snapshot = history.snapshot;
  const entry = snapshot.entries[snapshot.index] as NativeHistoryEntry;
  return parseTanStackHref(entry.href, tanStackState(entry, snapshot.index));
}

function tanStackAction(
  transition: NativeNavigationTransition,
): TanStackSubscriberAction {
  switch (transition.kind) {
    case "push":
      return { type: "PUSH" };
    case "replace":
    case "reset":
      return { type: "REPLACE" };
    case "pop":
    case "traverse":
      if (transition.delta === -1) return { type: "BACK" };
      if (transition.delta === 1) return { type: "FORWARD" };
      return { type: "GO", index: transition.delta };
  }
}

function assignedTanStackState(
  state: unknown,
  index: number,
  key: string,
): ParsedHistoryState {
  const source = state ? Object(state) : {};
  return {
    ...source,
    key,
    __TSR_key: key,
    __TSR_index: index,
  } as ParsedHistoryState;
}

/**
 * Adapts the native navigation state machine to TanStack Router's current
 * framework-neutral history contract. Adapter-originated mutations are
 * suppressed at the native subscription boundary and then published exactly
 * once by TanStack history; platform backs and deep links enter through the
 * native subscription and are translated into the matching TanStack action.
 */
export function createTanStackNativeHistory(
  nativeHistory: NativeHistory = new NativeHistory(),
  options: TanStackNativeHistoryOptions = {},
): RouterHistory {
  let suppressNativeNotification = false;
  let destroyed = false;
  let nextLocationKey = 1;
  let location = tanStackLocation(nativeHistory);
  const subscribers = new Set<TanStackSubscriber>();
  let blockers: NavigationBlocker[] = [];

  const createLocationKey = (): string => {
    const snapshot = nativeHistory.snapshot;
    const activeKeys = new Set(
      snapshot.entries.map(
        (entry, index) => tanStackState(entry, index).__TSR_key,
      ),
    );
    let key: string;
    do {
      key = `solid-native-${String(nextLocationKey++)}`;
    } while (activeKeys.has(key));
    return key;
  };

  const notify = (action: TanStackSubscriberAction): void => {
    location = tanStackLocation(nativeHistory);
    for (const subscriber of [...subscribers]) {
      subscriber({ location, action });
    }
  };

  const mutate = (
    mutation: () => unknown,
    action: TanStackSubscriberAction,
  ): void => {
    suppressNativeNotification = true;
    try {
      mutation();
    } finally {
      suppressNativeNotification = false;
    }
    notify(action);
  };

  const reportNavigationError = (error: unknown): void => {
    if (reportIsolatedError(options.onNavigationError, error)) return;
    void Promise.resolve().then(() => {
      throw error;
    });
  };

  const isNavigationBlocked = async (
    action: HistoryAction,
    currentLocation: HistoryLocation,
    nextLocation: HistoryLocation,
  ): Promise<boolean> => {
    for (const blocker of [...blockers]) {
      if (
        await blocker.blockerFn({
          currentLocation,
          nextLocation,
          action,
        })
      ) {
        try {
          options.onBlocked?.();
        } catch {
          // Navigation already stopped; observer failures are isolated.
        }
        return true;
      }
    }
    return false;
  };

  const attemptNavigation = (
    action: HistoryAction,
    navigateOptions: NavigateOptions | undefined,
    nextLocation: () => HistoryLocation,
    commit: (next: HistoryLocation) => void,
  ): void => {
    const run = async (): Promise<void> => {
      const next = nextLocation();
      if (
        !(navigateOptions?.ignoreBlocker ?? false) &&
        (await isNavigationBlocked(action, location, next))
      ) {
        return;
      }
      commit(next);
    };

    if ((navigateOptions?.ignoreBlocker ?? false) || blockers.length === 0) {
      commit(nextLocation());
      return;
    }
    void run().catch(reportNavigationError);
  };

  let removePlatformTransitionBlocker: (() => void) | undefined;
  const syncPlatformTransitionBlocker = (): void => {
    if (destroyed || blockers.length === 0) {
      removePlatformTransitionBlocker?.();
      removePlatformTransitionBlocker = undefined;
      return;
    }
    if (removePlatformTransitionBlocker !== undefined) return;
    removePlatformTransitionBlocker = nativeHistory.blockPlatformTransitions(
      async (transition) => {
        const snapshot = nativeHistory.snapshot;
        const targetIndex = snapshot.entries.findIndex(
          (entry) => entry.id === transition.to.id,
        );
        if (targetIndex < 0) return true;
        const next = parseTanStackHref(
          transition.to.href,
          tanStackState(transition.to, targetIndex),
        );
        const action: HistoryAction = transition.delta === -1 ? "BACK" : "GO";
        try {
          return await isNavigationBlocked(action, location, next);
        } catch (error) {
          reportNavigationError(error);
          // A failed blocker must fail closed while a native dismissal is
          // being held. The current screen remains mounted.
          return true;
        }
      },
    );
  };

  const unsubscribe = nativeHistory.subscribe(({ transition }) => {
    if (destroyed || suppressNativeNotification) return;
    notify(tanStackAction(transition));
  });

  const traverse = (
    action: "BACK" | "FORWARD" | "GO",
    delta: number,
    navigateOptions: NavigateOptions | undefined,
  ): void => {
    if (!Number.isInteger(delta)) {
      throw new Error("TanStack history delta must be an integer.");
    }
    const subscriberAction: TanStackSubscriberAction =
      action === "GO" ? { type: "GO", index: delta } : { type: action };
    attemptNavigation(
      action,
      navigateOptions,
      () => {
        const snapshot = nativeHistory.snapshot;
        const target = Math.min(
          snapshot.entries.length - 1,
          Math.max(0, snapshot.index + delta),
        );
        const entry = snapshot.entries[target] as NativeHistoryEntry;
        return parseTanStackHref(entry.href, tanStackState(entry, target));
      },
      () => {
        mutate(() => nativeHistory.go(delta), subscriberAction);
      },
    );
  };

  const history: RouterHistory = {
    get location() {
      return location;
    },
    get length() {
      return nativeHistory.snapshot.entries.length;
    },
    subscribers,
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    push(href, state, navigateOptions) {
      const key = createLocationKey();
      attemptNavigation(
        "PUSH",
        navigateOptions,
        () =>
          parseTanStackHref(
            href,
            assignedTanStackState(state, nativeHistory.snapshot.index + 1, key),
          ),
        (next) => {
          mutate(
            () =>
              nativeHistory.push(next.href, next.state as unknown as HostValue),
            { type: "PUSH" },
          );
        },
      );
    },
    replace(href, state, navigateOptions) {
      const key = createLocationKey();
      attemptNavigation(
        "REPLACE",
        navigateOptions,
        () =>
          parseTanStackHref(
            href,
            assignedTanStackState(state, nativeHistory.snapshot.index, key),
          ),
        (next) => {
          mutate(
            () =>
              nativeHistory.replace(
                next.href,
                next.state as unknown as HostValue,
              ),
            { type: "REPLACE" },
          );
        },
      );
    },
    go(delta, navigateOptions) {
      traverse("GO", delta, navigateOptions);
    },
    back(navigateOptions) {
      traverse("BACK", -1, navigateOptions);
    },
    forward(navigateOptions) {
      traverse("FORWARD", 1, navigateOptions);
    },
    canGoBack() {
      return location.state.__TSR_index !== 0;
    },
    createHref: options.createHref ?? ((href) => href),
    block(blocker) {
      // One blocker object may be registered by more than one router owner.
      // Keep each registration independently disposable, matching the native
      // blocker registry and TanStack's subscription-shaped contract.
      const registered: NavigationBlocker = { ...blocker };
      blockers = [...blockers, registered];
      syncPlatformTransitionBlocker();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        blockers = blockers.filter((candidate) => candidate !== registered);
        syncPlatformTransitionBlocker();
      };
    },
    flush() {},
    destroy() {
      if (destroyed) return;
      destroyed = true;
      nativeHistoryByTanStackHistory.delete(history);
      removePlatformTransitionBlocker?.();
      removePlatformTransitionBlocker = undefined;
      unsubscribe();
    },
    notify,
  };

  nativeHistoryByTanStackHistory.set(history, nativeHistory);
  return history;
}

/**
 * Reconciles untrusted persistence and initial-URL inputs before the first
 * native tree is mounted. An accepted deep link starts a fresh one-entry stack
 * so restored screens cannot unexpectedly appear behind it. Invalid stored
 * state is reported in the result and falls back to the configured initial
 * location instead of making the application unlaunchable.
 */
export function createNativeHistoryFromLaunch(
  options: NativeHistoryLaunchOptions = {},
): NativeHistoryLaunchResult {
  let initialURL: string | undefined;
  if (options.initialURL !== undefined && options.initialURL !== null) {
    initialURL = normalizeHref(
      options.initialURL,
      "native initial deep-link URL",
    );
    const target =
      options.resolveDeepLink === undefined
        ? { href: initialURL, state: null }
        : options.resolveDeepLink(initialURL);
    if (target !== undefined) {
      return {
        history: new NativeHistory({
          initialHref: target.href,
          initialState: target.state ?? null,
        }),
        source: "deep-link",
        initialURL,
      };
    }
  }

  let restorationError: unknown;
  if (
    options.serializedSnapshot !== undefined &&
    options.serializedSnapshot !== null
  ) {
    try {
      return {
        history: new NativeHistory({
          snapshot: deserializeNativeHistorySnapshot(
            options.serializedSnapshot,
          ),
        }),
        source: "restoration",
        ...(initialURL === undefined ? {} : { initialURL }),
      };
    } catch (error) {
      restorationError = error;
    }
  }

  return {
    history: new NativeHistory({
      ...(options.initialHref === undefined
        ? {}
        : { initialHref: options.initialHref }),
      ...(options.initialState === undefined
        ? {}
        : { initialState: options.initialState }),
    }),
    source: "initial",
    ...(initialURL === undefined ? {} : { initialURL }),
    ...(restorationError === undefined ? {} : { restorationError }),
  };
}

function persistenceKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    value.includes("\0")
  ) {
    throw new TypeError(
      "Native persistence storage key must be a 1-1024 character string without null bytes.",
    );
  }
  return value;
}

/**
 * Reads and validates the application shell's persisted navigation value
 * before creating history. Corrupt or obsolete data, including a valid stack
 * discarded by an accepted initial URL, is removed before launch returns;
 * native storage availability errors still reject startup so the shell can
 * choose its own recovery policy.
 */
export async function createNativeHistoryFromStorage(
  options: StoredNativeHistoryLaunchOptions,
): Promise<NativeHistoryLaunchResult> {
  const key = persistenceKey(options.storageKey);
  const serializedSnapshot = await options.storage.getItem(key);
  const result = createNativeHistoryFromLaunch({
    ...(options.initialHref === undefined
      ? {}
      : { initialHref: options.initialHref }),
    ...(options.initialState === undefined
      ? {}
      : { initialState: options.initialState }),
    ...(options.initialURL === undefined
      ? {}
      : { initialURL: options.initialURL }),
    ...(options.resolveDeepLink === undefined
      ? {}
      : { resolveDeepLink: options.resolveDeepLink }),
    serializedSnapshot,
  });
  if (
    result.restorationError !== undefined ||
    (result.source === "deep-link" && serializedSnapshot !== null)
  ) {
    await options.storage.removeItem(key);
  }
  return result;
}

/**
 * Persists the initial snapshot and every subsequent navigation update. Writes
 * are serialized so a slow native operation cannot overwrite newer state;
 * updates that arrive while one write is pending coalesce to the newest
 * snapshot. The current Solid owner disposes the subscription automatically.
 */
export function createNativeHistoryPersistence(
  history: NativeHistory,
  storage: NativeHistoryPersistenceStorage,
  options: NativeHistoryPersistenceOptions,
): NativeHistoryPersistence {
  const key = persistenceKey(options.storageKey);
  let pending: string | undefined;
  let draining = false;
  let active = true;
  const waiters: Array<{
    resolve(): void;
    reject(error: unknown): void;
  }> = [];

  const settleWaiters = (failed: boolean, failure?: unknown): void => {
    const settled = waiters.splice(0);
    for (const waiter of settled) {
      if (failed) waiter.reject(failure);
      else waiter.resolve();
    }
  };
  const reportError = (error: unknown): void => {
    reportIsolatedError(options.onError, error);
  };
  const drain = async (): Promise<void> => {
    draining = true;
    let failed = false;
    let failure: unknown;
    while (pending !== undefined) {
      const serialized = pending;
      pending = undefined;
      try {
        await storage.setItem(key, serialized);
      } catch (error) {
        reportError(error);
        // Retain the failed value unless an update that arrived during the
        // native write already supplied a newer snapshot. Do not retry in a
        // tight loop; the next explicit flush or history update owns retry.
        pending ??= serialized;
        failed = true;
        failure = error;
        break;
      }
    }
    draining = false;
    settleWaiters(failed, failure);
    if (!failed && pending !== undefined) void drain();
  };
  const schedule = (snapshot: NativeHistorySnapshot): void => {
    pending = serializeNativeHistorySnapshot(snapshot);
    if (!draining) void drain();
  };
  const unsubscribe = history.subscribe((update) => {
    if (active) schedule(update.snapshot);
  });
  schedule(history.snapshot);

  const persistence: NativeHistoryPersistence = Object.freeze({
    async flush() {
      if (!draining && pending === undefined) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
        if (!draining) void drain();
      });
    },
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe();
    },
  });
  // Standalone application shells can own the explicit disposable directly;
  // component callers additionally inherit automatic Solid teardown.
  if (getOwner() !== null) onCleanup(() => persistence.dispose());
  return persistence;
}

export interface NativeStackScreenOptions extends Pick<
  ScreenProps,
  | "gestureEnabled"
  | "nativeBackButtonDismissalEnabled"
  | "presentation"
  | "preventNativeDismiss"
  | "sheetAllowedDetents"
  | "sheetCornerRadius"
  | "sheetDefaultResizeAnimationEnabled"
  | "sheetElevation"
  | "sheetExpandsWhenScrolledToEdge"
  | "sheetGrabberVisible"
  | "sheetInitialDetent"
  | "sheetLargestUndimmedDetent"
  | "sheetShouldOverflowTopInset"
  | "style"
> {}

export interface NativeTabDefinition {
  readonly key: string;
}

/** Portable bound imposed by Android's native BottomNavigationView. */
export const NATIVE_TABS_MAX_ITEMS = 5;
export const NATIVE_TABS_STATE_RESTORATION_VERSION = 0 as const;
export const NATIVE_TABS_STATE_MAX_SERIALIZED_LENGTH =
  NATIVE_HISTORY_MAX_SERIALIZED_LENGTH * NATIVE_TABS_MAX_ITEMS + 16_384;

export interface NativeTabHistoryDefinition extends NativeTabDefinition {
  readonly initialHref?: string;
  readonly initialState?: HostValue;
}

export interface NativeTabsStateSnapshotTab {
  readonly key: string;
  readonly history: NativeHistorySnapshot;
}

export interface NativeTabsStateSnapshot {
  readonly selectedKey: string;
  readonly tabs: readonly NativeTabsStateSnapshotTab[];
}

export type NativeTabsStateUpdateKind = "selection" | "history" | "deep-link";

export interface NativeTabsStateUpdate {
  readonly kind: NativeTabsStateUpdateKind;
  readonly selectedKey: string;
  readonly tabKey: string;
  readonly historyUpdate?: NativeHistoryUpdate;
  readonly snapshot: NativeTabsStateSnapshot;
}

export type NativeTabsStateListener = (update: NativeTabsStateUpdate) => void;

export interface NativeTabsStateOptions {
  readonly tabs: readonly NativeTabHistoryDefinition[];
  readonly selectedKey?: string;
  readonly snapshot?: NativeTabsStateSnapshot;
}

export interface NativeTabDeepLinkTarget extends NativeDeepLinkTarget {
  readonly tabKey: string;
}

export interface NativeTabsState {
  readonly selectedKey: Accessor<string>;
  readonly selectedHistory: Accessor<NativeHistory>;
  readonly snapshot: NativeTabsStateSnapshot;
  history(tabKey: string): NativeHistory;
  select(tabKey: string): boolean;
  handleTabSelected(selection: NativeTabSelection): boolean;
  openDeepLink(target: NativeTabDeepLinkTarget): NativeNavigationTransition;
  subscribe(listener: NativeTabsStateListener): () => void;
  dispose(): void;
}

export type NativeTabsStateLaunchSource =
  "initial" | "restoration" | "deep-link";

export interface NativeTabsStateLaunchOptions extends Omit<
  NativeTabsStateOptions,
  "snapshot"
> {
  /** Untrusted value returned by the application shell's persistence layer. */
  readonly serializedSnapshot?: unknown;
  /** Untrusted value returned by the platform's initial-URL API. */
  readonly initialURL?: unknown;
  readonly resolveDeepLink?: (
    url: string,
  ) => NativeTabDeepLinkTarget | undefined;
}

export interface NativeTabsStateLaunchResult {
  readonly state: NativeTabsState;
  readonly source: NativeTabsStateLaunchSource;
  readonly initialURL?: string;
  /** Present when corrupt, obsolete, or incompatible stored state was discarded. */
  readonly restorationError?: unknown;
}

export interface StoredNativeTabsStateLaunchOptions extends Omit<
  NativeTabsStateLaunchOptions,
  "serializedSnapshot"
> {
  readonly storage: NativeHistoryPersistenceStorage;
  readonly storageKey: string;
}

export interface NativeTabsStatePersistenceOptions {
  readonly storageKey: string;
  readonly onError?: (error: unknown) => unknown;
}

export interface NativeTabsStatePersistence {
  /** Writes or retries the newest scheduled tabs snapshot and awaits durability. */
  flush(): Promise<void>;
  /** Stops observing tab selection and child histories. */
  dispose(): void;
}

export interface NativeTabsScreenOptions {
  readonly style?: StyleProp;
  readonly title?: string;
  readonly badgeValue?: string;
  readonly icon?: TabsScreenIcon;
  readonly selectedIcon?: TabsScreenIcon;
  readonly standardAppearance?: TabsScreenAppearance;
  readonly scrollEdgeAppearance?: TabsScreenScrollEdgeAppearance;
  readonly preventNativeSelection?: boolean;
  readonly tabBarItemTestID?: string;
  readonly tabBarItemAccessibilityLabel?: string;
  readonly specialEffects?: TabsScreenProps["specialEffects"];
  readonly orientation?: TabsScreenProps["orientation"];
}

export type NativeTabActionOrigin =
  "user" | "programmatic-js" | "programmatic-native" | "implicit";

export interface NativeTabSelection {
  readonly selectedKey: string;
  readonly provenance: number;
  readonly repeated: boolean;
  readonly triggeredSpecialEffect: boolean;
  readonly actionOrigin: NativeTabActionOrigin;
}

export interface NativeTabSelectionRejection {
  readonly selectedKey: string;
  readonly provenance: number;
  readonly rejectedKey: string;
  readonly rejectedBaseProvenance: number;
  readonly reason: "stale" | "repeated";
}

export interface NativeTabSelectionPrevention {
  readonly selectedKey: string;
  readonly provenance: number;
  readonly preventedKey: string;
}

export interface NativeTabsProps<
  Tab extends NativeTabDefinition = NativeTabDefinition,
> extends Pick<
  TabsHostProps,
  | "colorScheme"
  | "direction"
  | "nativeContainerBackgroundColor"
  | "tabBarControllerMode"
  | "tabBarHidden"
  | "tabBarMinimizeBehavior"
  | "tabBarRespectsIMEInsets"
  | "tabBarTintColor"
> {
  readonly tabs: readonly Tab[];
  readonly selectedKey?: string;
  readonly defaultSelectedKey?: string;
  readonly children: (
    tab: Accessor<Tab>,
    index: Accessor<number>,
    isSelected: Accessor<boolean>,
  ) => unknown;
  /** Reactive navigator-wide defaults; per-tab options override matching keys. */
  readonly defaultScreenOptions?: Readonly<NativeTabsScreenOptions> | undefined;
  readonly screenOptions?: (
    tab: Tab,
    index: number,
  ) => Readonly<NativeTabsScreenOptions>;
  readonly onTabSelected?: (
    selection: NativeTabSelection,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onTabSelectionRejected?: (
    rejection: NativeTabSelectionRejection,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onTabSelectionPrevented?: (
    prevention: NativeTabSelectionPrevention,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onTabWillAppear?: (tab: Tab, event: NativeSyntheticEvent) => unknown;
  readonly onTabDidAppear?: (tab: Tab, event: NativeSyntheticEvent) => unknown;
  readonly onTabWillDisappear?: (
    tab: Tab,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onTabDidDisappear?: (
    tab: Tab,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onError?: (error: unknown) => unknown;
}

export interface NativeStackProps {
  readonly history: NativeHistory;
  readonly children: (
    entry: Accessor<NativeHistoryEntry>,
    index: Accessor<number>,
    isFocused: Accessor<boolean>,
  ) => unknown;
  readonly style?: StyleProp;
  /** Reactive navigator-wide defaults; per-entry options override matching keys. */
  readonly defaultScreenOptions?:
    Readonly<NativeStackScreenOptions> | undefined;
  readonly screenOptions?: (
    entry: NativeHistoryEntry,
    index: number,
  ) => Readonly<NativeStackScreenOptions>;
  /** Mounts one native header configuration inside each keyed Screen owner. */
  readonly renderHeader?: (
    entry: Accessor<NativeHistoryEntry>,
    index: Accessor<number>,
    isFocused: Accessor<boolean>,
  ) => unknown;
  readonly onTransitionEnd?: (event: NativeSyntheticEvent) => unknown;
  readonly onScreenFocus?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onScreenBlur?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onScreenSheetDetentChange?: (
    entry: NativeHistoryEntry,
    event: ScreenSheetDetentChangeEvent,
  ) => unknown;
  readonly onPlatformBack?: (transition: NativeNavigationTransition) => unknown;
  readonly onPlatformBackCancel?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onPlatformBackBlocked?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onPlatformBackError?: (error: unknown) => unknown;
  readonly onUpdate?: NativeHistoryListener;
}

export interface NativeModalScreenOptions extends Pick<
  ModalProps,
  | "accessible"
  | "accessibilityHint"
  | "accessibilityLabel"
  | "accessibilityRole"
  | "accessibilityState"
  | "allowSwipeDismissal"
  | "animationType"
  | "backdropColor"
  | "hardwareAccelerated"
  | "hidden"
  | "nativeID"
  | "navigationBarTranslucent"
  | "presentationStyle"
  | "statusBarTranslucent"
  | "style"
  | "supportedOrientations"
  | "testID"
  | "transparent"
> {}

export interface NativeModalStackProps {
  readonly history: NativeHistory;
  readonly children: (
    entry: Accessor<NativeHistoryEntry>,
    index: Accessor<number>,
    isFocused: Accessor<boolean>,
  ) => unknown;
  /** Styles the retained application content beneath modal portals. */
  readonly style?: StyleProp;
  readonly defaultModalOptions?: Readonly<NativeModalScreenOptions> | undefined;
  readonly modalOptions?: (
    entry: NativeHistoryEntry,
    index: number,
  ) => Readonly<NativeModalScreenOptions>;
  readonly onModalShow?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onModalRequestClose?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onModalDismiss?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onModalHidden?: (entry: NativeHistoryEntry) => unknown;
  readonly onModalOrientationChange?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onPlatformBack?: (transition: NativeNavigationTransition) => unknown;
  readonly onPlatformBackBlocked?: (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => unknown;
  readonly onPlatformBackError?: (error: unknown) => unknown;
  readonly onUpdate?: NativeHistoryListener;
}

export interface HardwareBackHandlerOptions {
  readonly onTransition?: (transition: NativeNavigationTransition) => unknown;
  readonly onBlocked?: (transition: NativeNavigationTransition) => unknown;
  readonly onError?: (error: unknown) => unknown;
}

function inheritNativeScreenOptions<Options extends object>(
  defaults: Readonly<Options> | undefined,
  overrides: Readonly<Options> | undefined,
): Readonly<Options> {
  if (defaults === undefined) return (overrides ?? {}) as Readonly<Options>;
  if (overrides === undefined) return defaults;
  // Option inheritance is intentionally shallow: native option values are
  // atomic transport contracts. An explicit override, including `undefined`,
  // owns that key and can therefore clear a navigator-wide default.
  return { ...defaults, ...overrides };
}

export interface NativeDeepLinkTarget {
  readonly href: string;
  readonly state?: HostValue;
}

export interface DeepLinkHandlerOptions {
  readonly resolve?: (url: string) => NativeDeepLinkTarget | undefined;
  readonly onTransition?: (transition: NativeNavigationTransition) => unknown;
  readonly onError?: (error: unknown) => unknown;
}

export interface NativeNavigationSubscription {
  remove(): void;
}

export interface NativeNavigationEventSource {
  subscribeHardwareBack(listener: () => boolean): NativeNavigationSubscription;
  subscribeURL(
    listener: (event: unknown) => unknown,
  ): NativeNavigationSubscription;
}

export interface NativeNavigationBindingsOptions {
  readonly hardwareBack?: HardwareBackHandlerOptions;
  readonly deepLinks?: DeepLinkHandlerOptions;
}

export interface NativeNavigationBindings {
  dispose(): void;
}

const HARDWARE_BACK_EVENT_NAME = "platform.hardware-back.press";
const LIVE_URL_EVENT_NAME = "platform.url.open";

interface PendingHardwareBack {
  readonly history: NativeHistory;
  readonly transition: NativeNavigationTransition;
  readonly blocked: Promise<boolean>;
}

function requestHardwareBack(
  history: NativeHistory | Accessor<NativeHistory | undefined>,
  options: HardwareBackHandlerOptions,
): boolean | PendingHardwareBack {
  try {
    const target = typeof history === "function" ? history() : history;
    if (target === undefined) return false;
    const transition = target.requestPlatformBack();
    if (transition === undefined) return false;
    if (target.hasPlatformTransitionBlockers) {
      return {
        history: target,
        transition,
        blocked: target.isPlatformTransitionBlocked(transition.id),
      };
    }
    const completed = target.completePlatformTransition(transition.id, true);
    if (completed) options.onTransition?.(transition);
    return completed;
  } catch (error) {
    if (!reportIsolatedError(options.onError, error)) throw error;
    // A navigation invariant failed after the application was offered Back.
    // Consume the event so the Activity cannot exit behind a fatal overlay.
    return true;
  }
}

function settleHardwareBack(
  pending: PendingHardwareBack,
  options: HardwareBackHandlerOptions,
  retention?: NativeCausalEventRetention,
): void {
  const run = <T>(callback: () => T): T =>
    retention?.state === "active" ? retention.run(callback) : callback();
  const settlement = pending.blocked
    .then((blocked) =>
      run(() => {
        const completed = pending.history.completePlatformTransition(
          pending.transition.id,
          !blocked,
        );
        if (!completed) return;
        if (blocked) options.onBlocked?.(pending.transition);
        else options.onTransition?.(pending.transition);
      }),
    )
    .catch((error: unknown) =>
      run(() => {
        pending.history.completePlatformTransition(
          pending.transition.id,
          false,
        );
        if (!reportIsolatedError(options.onError, error)) throw error;
      }),
    );

  if (retention === undefined) {
    void settlement;
    return;
  }
  void settlement.then(
    () => retention.finish(),
    (error: unknown) => {
      retention.fail(error);
      // Preserve the lower-level handler's global rejection when the
      // application did not install an error callback.
      throw error;
    },
  );
}

/**
 * Creates the synchronous callback expected by React Native's Android
 * BackHandler without importing React Native into this package. An accessor
 * selects a retained tab's history at event time; an asynchronous blocker
 * remains attached to that exact history even if selection changes meanwhile.
 */
export function createHardwareBackHandler(
  history: NativeHistory | Accessor<NativeHistory | undefined>,
  options: HardwareBackHandlerOptions = {},
): () => boolean {
  return () => {
    const result = requestHardwareBack(history, options);
    if (typeof result === "boolean") return result;
    settleHardwareBack(result, options);
    return true;
  };
}

function createCausalHardwareBackHandler(
  history: NativeHistory | Accessor<NativeHistory | undefined>,
  options: HardwareBackHandlerOptions = {},
) {
  return () => {
    const result = requestHardwareBack(history, options);
    if (typeof result === "boolean") {
      return retainCausalPlatformEvent(result, (event) => event.finish());
    }
    return retainCausalPlatformEvent(true, (event) =>
      settleHardwareBack(result, options, event),
    );
  };
}

/**
 * Converts a React Native-compatible `{ url }` event into a system-originated
 * history transition without importing its Linking singleton.
 */
export function createDeepLinkHandler(
  history: NativeHistory,
  options: DeepLinkHandlerOptions = {},
): (event: unknown) => NativeNavigationTransition | undefined {
  return (event) => {
    try {
      const payload = plainRecord(event, "native deep-link event");
      const url = normalizeHref(payload.url, "native deep-link URL");
      const target =
        options.resolve === undefined
          ? { href: url, state: null }
          : options.resolve(url);
      if (target === undefined) return undefined;
      const transition = history.openDeepLink(
        target.href,
        target.state ?? null,
      );
      options.onTransition?.(transition);
      return transition;
    } catch (error) {
      if (!reportIsolatedError(options.onError, error)) throw error;
      return undefined;
    }
  };
}

/**
 * Owns platform Back and live-link subscriptions for the current Solid owner.
 * The returned disposer is idempotent for callers that need an earlier stop.
 */
export function createNativeNavigationBindings(
  history: NativeHistory,
  source: NativeNavigationEventSource,
  options: NativeNavigationBindingsOptions = {},
): NativeNavigationBindings {
  const handleHardwareBack = createCausalPlatformEventHandler(
    HARDWARE_BACK_EVENT_NAME,
    createCausalHardwareBackHandler(history, options.hardwareBack),
    { priority: "discrete" },
  );
  const handleDeepLink = createCausalPlatformEventHandler(
    LIVE_URL_EVENT_NAME,
    createDeepLinkHandler(history, options.deepLinks),
  );
  const hardwareBack = source.subscribeHardwareBack(handleHardwareBack);
  let deepLinks: NativeNavigationSubscription;
  try {
    deepLinks = source.subscribeURL(handleDeepLink);
  } catch (error) {
    hardwareBack.remove();
    throw error;
  }
  let active = true;
  const bindings = Object.freeze({
    dispose() {
      if (!active) return;
      active = false;
      let firstError: unknown;
      try {
        hardwareBack.remove();
      } catch (error) {
        firstError = error;
      }
      try {
        deepLinks.remove();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError !== undefined) throw firstError;
    },
  });
  if (getOwner() !== null) onCleanup(() => bindings.dispose());
  return bindings;
}

function dismissCount(event: NativeSyntheticEvent): number {
  const payload = event.payload;
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return 1;
  }
  const value = (payload as Readonly<Record<string, HostValue>>).dismissCount;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 1;
}

function normalizeNativeTabKey(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${path} must be a 1-128 character string without null bytes.`,
    );
  }
  return value;
}

function normalizeNativeTabHistoryDefinitions(
  value: unknown,
): readonly NativeTabHistoryDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Native tabs state tabs must be a non-empty array.");
  }
  if (value.length > NATIVE_TABS_MAX_ITEMS) {
    throw new RangeError(
      `Native tabs state tabs must contain at most ${String(NATIVE_TABS_MAX_ITEMS)} items.`,
    );
  }
  const keys = new Set<string>();
  return value.map((rawDefinition, index) => {
    const definition = plainRecord(
      rawDefinition,
      `native tabs state tabs[${String(index)}]`,
    );
    const key = normalizeNativeTabKey(
      definition.key,
      `native tabs state tabs[${String(index)}].key`,
    );
    if (keys.has(key)) {
      throw new TypeError(
        `Native tabs state tab key ${JSON.stringify(key)} is duplicated.`,
      );
    }
    keys.add(key);
    return {
      key,
      ...(definition.initialHref === undefined
        ? {}
        : {
            initialHref: normalizeHref(
              definition.initialHref,
              `native tabs state tabs[${String(index)}].initialHref`,
            ),
          }),
      ...(definition.initialState === undefined
        ? {}
        : {
            initialState: cloneValue(
              definition.initialState,
              `native tabs state tabs[${String(index)}].initialState`,
            ),
          }),
    };
  });
}

function normalizeNativeTabsStateSnapshot(
  value: unknown,
): NativeTabsStateSnapshot {
  const snapshot = plainRecord(value, "native tabs state snapshot");
  if (
    !Array.isArray(snapshot.tabs) ||
    snapshot.tabs.length === 0 ||
    snapshot.tabs.length > NATIVE_TABS_MAX_ITEMS
  ) {
    throw new RangeError(
      `Native tabs state snapshot requires 1-${String(NATIVE_TABS_MAX_ITEMS)} tabs.`,
    );
  }
  const keys = new Set<string>();
  const tabs = snapshot.tabs.map((rawTab, index) => {
    const tab = plainRecord(
      rawTab,
      `native tabs state snapshot tab ${String(index)}`,
    );
    const key = normalizeNativeTabKey(
      tab.key,
      `native tabs state snapshot tab ${String(index)} key`,
    );
    if (keys.has(key)) {
      throw new TypeError(
        `Native tabs state snapshot tab key ${JSON.stringify(key)} is duplicated.`,
      );
    }
    keys.add(key);
    return { key, history: normalizeSnapshot(tab.history) };
  });
  const selectedKey = normalizeNativeTabKey(
    snapshot.selectedKey,
    "native tabs state snapshot selectedKey",
  );
  if (!keys.has(selectedKey)) {
    throw new RangeError(
      `Native tabs state snapshot selectedKey ${JSON.stringify(selectedKey)} does not identify a tab.`,
    );
  }
  return { selectedKey, tabs };
}

function normalizeNativeTabDeepLinkTarget(
  value: unknown,
): NativeTabDeepLinkTarget {
  const target = plainRecord(value, "native tab deep-link target");
  return {
    tabKey: normalizeNativeTabKey(
      target.tabKey,
      "native tab deep-link target.tabKey",
    ),
    href: normalizeHref(target.href, "native tab deep-link target.href"),
    state: cloneValue(
      target.state ?? null,
      "native tab deep-link target.state",
    ),
  };
}

function assertNativeTabsStateSnapshotCompatibility(
  definitions: readonly NativeTabHistoryDefinition[],
  snapshot: NativeTabsStateSnapshot,
): void {
  const restoredKeys = new Set(snapshot.tabs.map((tab) => tab.key));
  if (
    restoredKeys.size !== definitions.length ||
    definitions.some((definition) => !restoredKeys.has(definition.key))
  ) {
    throw new Error(
      "Native tabs state restoration keys do not match the configured tabs.",
    );
  }
}

export function serializeNativeTabsStateSnapshot(
  snapshot: NativeTabsStateSnapshot,
): string {
  const serialized = JSON.stringify({
    version: NATIVE_TABS_STATE_RESTORATION_VERSION,
    snapshot: normalizeNativeTabsStateSnapshot(snapshot),
  });
  if (serialized.length > NATIVE_TABS_STATE_MAX_SERIALIZED_LENGTH) {
    throw new RangeError(
      `Serialized native tabs state exceeds ${String(NATIVE_TABS_STATE_MAX_SERIALIZED_LENGTH)} characters.`,
    );
  }
  return serialized;
}

export function deserializeNativeTabsStateSnapshot(
  serialized: unknown,
): NativeTabsStateSnapshot {
  if (typeof serialized !== "string") {
    throw new TypeError("Serialized native tabs state must be a string.");
  }
  if (serialized.length > NATIVE_TABS_STATE_MAX_SERIALIZED_LENGTH) {
    throw new RangeError(
      `Serialized native tabs state exceeds ${String(NATIVE_TABS_STATE_MAX_SERIALIZED_LENGTH)} characters.`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    throw new SyntaxError("Serialized native tabs state is not valid JSON.");
  }
  const envelope = plainRecord(decoded, "native tabs state restoration");
  if (envelope.version !== NATIVE_TABS_STATE_RESTORATION_VERSION) {
    throw new Error(
      `Unsupported native tabs state restoration version: ${String(envelope.version)}.`,
    );
  }
  return normalizeNativeTabsStateSnapshot(envelope.snapshot);
}

/**
 * Owns one history per stable native-tab key and exposes selection as a Solid
 * accessor. A cross-tab deep link publishes one coherent state update after
 * both the target history and selected key have changed.
 */
export function createNativeTabsState(
  options: NativeTabsStateOptions,
): NativeTabsState {
  const definitions = normalizeNativeTabHistoryDefinitions(options.tabs);
  const restored =
    options.snapshot === undefined
      ? undefined
      : normalizeNativeTabsStateSnapshot(options.snapshot);
  if (restored !== undefined) {
    assertNativeTabsStateSnapshotCompatibility(definitions, restored);
  }
  const restoredTabs = new Map(
    restored?.tabs.map((tab) => [tab.key, tab.history] as const) ?? [],
  );
  const histories = new Map(
    definitions.map((definition) => [
      definition.key,
      new NativeHistory(
        restored === undefined
          ? {
              ...(definition.initialHref === undefined
                ? {}
                : { initialHref: definition.initialHref }),
              ...(definition.initialState === undefined
                ? {}
                : { initialState: definition.initialState }),
            }
          : { snapshot: restoredTabs.get(definition.key)! },
      ),
    ]),
  );
  const initialSelectedKey = normalizeNativeTabKey(
    restored?.selectedKey ?? options.selectedKey ?? definitions[0]!.key,
    "Native tabs state selectedKey",
  );
  if (!histories.has(initialSelectedKey)) {
    throw new RangeError(
      `Native tabs state selectedKey ${JSON.stringify(initialSelectedKey)} does not identify a tab.`,
    );
  }
  let currentSelectedKey = initialSelectedKey;
  // Solid 2 publishes signal writes at its flush boundary. Keep an immediate
  // canonical value for imperative snapshots/deep links while still reading
  // the signal so JSX consumers react in the next native transaction.
  const [reactiveSelectedKey, setReactiveSelectedKey] =
    createSignal(initialSelectedKey);
  const selectedKey = (): string => {
    reactiveSelectedKey();
    return currentSelectedKey;
  };
  const selectedHistory = (): NativeHistory =>
    histories.get(selectedKey()) as NativeHistory;
  const listeners = new Set<NativeTabsStateListener>();
  let active = true;
  let suppressHistoryUpdate = false;

  const snapshot = (): NativeTabsStateSnapshot => ({
    selectedKey: currentSelectedKey,
    tabs: definitions.map((definition) => ({
      key: definition.key,
      history: (histories.get(definition.key) as NativeHistory).snapshot,
    })),
  });
  const notify = (
    kind: NativeTabsStateUpdateKind,
    tabKey: string,
    historyUpdate?: NativeHistoryUpdate,
  ): void => {
    const update: NativeTabsStateUpdate = {
      kind,
      selectedKey: currentSelectedKey,
      tabKey,
      ...(historyUpdate === undefined ? {} : { historyUpdate }),
      snapshot: snapshot(),
    };
    for (const listener of [...listeners]) listener(update);
  };
  const historySubscriptions = [...histories].map(([tabKey, history]) =>
    history.subscribe((update) => {
      if (active && !suppressHistoryUpdate) {
        notify("history", tabKey, update);
      }
    }),
  );
  const resolveHistory = (rawKey: unknown, path: string): NativeHistory => {
    const key = normalizeNativeTabKey(rawKey, path);
    const history = histories.get(key);
    if (history === undefined) {
      throw new RangeError(
        `Native tabs state tab key ${JSON.stringify(key)} does not identify a tab.`,
      );
    }
    return history;
  };
  const assertActive = (): void => {
    if (!active) throw new Error("Native tabs state is disposed.");
  };

  const state: NativeTabsState = Object.freeze({
    selectedKey,
    selectedHistory,
    get snapshot() {
      return snapshot();
    },
    history(tabKey: string) {
      return resolveHistory(tabKey, "Native tabs state history key");
    },
    select(tabKey: string) {
      assertActive();
      const key = normalizeNativeTabKey(
        tabKey,
        "Native tabs state selected key",
      );
      resolveHistory(key, "Native tabs state selected key");
      if (currentSelectedKey === key) return false;
      currentSelectedKey = key;
      setReactiveSelectedKey(key);
      notify("selection", key);
      return true;
    },
    handleTabSelected(selection: NativeTabSelection) {
      if (selection === null || typeof selection !== "object") {
        throw new TypeError("Native tab selection must be an object.");
      }
      return state.select(selection.selectedKey);
    },
    openDeepLink(rawTarget: NativeTabDeepLinkTarget) {
      assertActive();
      const target = normalizeNativeTabDeepLinkTarget(rawTarget);
      const history = resolveHistory(
        target.tabKey,
        "native tab deep-link target.tabKey",
      );
      suppressHistoryUpdate = true;
      let transition: NativeNavigationTransition;
      try {
        transition = history.openDeepLink(target.href, target.state ?? null);
        currentSelectedKey = target.tabKey;
        setReactiveSelectedKey(target.tabKey);
      } finally {
        suppressHistoryUpdate = false;
      }
      notify("deep-link", target.tabKey, {
        transition,
        snapshot: history.snapshot,
      });
      return transition;
    },
    subscribe(listener: NativeTabsStateListener) {
      assertActive();
      if (typeof listener !== "function") {
        throw new TypeError("Native tabs state listener must be a function.");
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (!active) return;
      active = false;
      for (const unsubscribe of historySubscriptions) unsubscribe();
      listeners.clear();
    },
  });
  if (getOwner() !== null) onCleanup(() => state.dispose());
  return state;
}

/**
 * Resolves cold-launch precedence for native tabs. An accepted initial URL
 * starts the target tab directly at that route and discards restoration, so no
 * stale screen is exposed behind Back. Unhandled URLs still allow restoration.
 */
export function createNativeTabsStateFromLaunch(
  options: NativeTabsStateLaunchOptions,
): NativeTabsStateLaunchResult {
  const definitions = normalizeNativeTabHistoryDefinitions(options.tabs);
  let initialURL: string | undefined;
  if (options.initialURL !== undefined && options.initialURL !== null) {
    initialURL = normalizeHref(options.initialURL, "native initial URL");
    const resolved = options.resolveDeepLink?.(initialURL);
    if (resolved !== undefined) {
      const target = normalizeNativeTabDeepLinkTarget(resolved);
      if (!definitions.some((definition) => definition.key === target.tabKey)) {
        throw new RangeError(
          `Native tab deep-link target ${JSON.stringify(target.tabKey)} does not identify a configured tab.`,
        );
      }
      return {
        state: createNativeTabsState({
          tabs: definitions.map((definition) =>
            definition.key === target.tabKey
              ? {
                  ...definition,
                  initialHref: target.href,
                  initialState: target.state ?? null,
                }
              : definition,
          ),
          selectedKey: target.tabKey,
        }),
        source: "deep-link",
        initialURL,
      };
    }
  }

  let restorationError: unknown;
  if (
    options.serializedSnapshot !== undefined &&
    options.serializedSnapshot !== null
  ) {
    try {
      return {
        state: createNativeTabsState({
          tabs: definitions,
          snapshot: deserializeNativeTabsStateSnapshot(
            options.serializedSnapshot,
          ),
        }),
        source: "restoration",
        ...(initialURL === undefined ? {} : { initialURL }),
      };
    } catch (error) {
      restorationError = error;
    }
  }
  return {
    state: createNativeTabsState({
      tabs: definitions,
      ...(options.selectedKey === undefined
        ? {}
        : { selectedKey: options.selectedKey }),
    }),
    source: "initial",
    ...(initialURL === undefined ? {} : { initialURL }),
    ...(restorationError === undefined ? {} : { restorationError }),
  };
}

/**
 * Loads a validated multi-history envelope. Corrupt state and valid state
 * discarded by an accepted initial URL are removed before launch returns, so
 * a crash before persistence setup cannot resurrect obsolete tab histories.
 */
export async function createNativeTabsStateFromStorage(
  options: StoredNativeTabsStateLaunchOptions,
): Promise<NativeTabsStateLaunchResult> {
  const key = persistenceKey(options.storageKey);
  const serializedSnapshot = await options.storage.getItem(key);
  const result = createNativeTabsStateFromLaunch({
    tabs: options.tabs,
    ...(options.selectedKey === undefined
      ? {}
      : { selectedKey: options.selectedKey }),
    ...(options.initialURL === undefined
      ? {}
      : { initialURL: options.initialURL }),
    ...(options.resolveDeepLink === undefined
      ? {}
      : { resolveDeepLink: options.resolveDeepLink }),
    serializedSnapshot,
  });
  if (
    result.restorationError !== undefined ||
    (result.source === "deep-link" && serializedSnapshot !== null)
  ) {
    await options.storage.removeItem(key);
  }
  return result;
}

/** Serializes and coalesces selection and child-history persistence writes. */
export function createNativeTabsStatePersistence(
  state: NativeTabsState,
  storage: NativeHistoryPersistenceStorage,
  options: NativeTabsStatePersistenceOptions,
): NativeTabsStatePersistence {
  const key = persistenceKey(options.storageKey);
  let pending: string | undefined;
  let draining = false;
  let active = true;
  const waiters: Array<{
    resolve(): void;
    reject(error: unknown): void;
  }> = [];
  const settleWaiters = (failed: boolean, failure?: unknown): void => {
    const settled = waiters.splice(0);
    for (const waiter of settled) {
      if (failed) waiter.reject(failure);
      else waiter.resolve();
    }
  };
  const reportError = (error: unknown): void => {
    reportIsolatedError(options.onError, error);
  };
  const drain = async (): Promise<void> => {
    draining = true;
    let failed = false;
    let failure: unknown;
    while (pending !== undefined) {
      const serialized = pending;
      pending = undefined;
      try {
        await storage.setItem(key, serialized);
      } catch (error) {
        reportError(error);
        pending ??= serialized;
        failed = true;
        failure = error;
        break;
      }
    }
    draining = false;
    settleWaiters(failed, failure);
    if (!failed && pending !== undefined) void drain();
  };
  const schedule = (snapshot: NativeTabsStateSnapshot): void => {
    pending = serializeNativeTabsStateSnapshot(snapshot);
    if (!draining) void drain();
  };
  const unsubscribe = state.subscribe((update) => {
    if (active) schedule(update.snapshot);
  });
  schedule(state.snapshot);

  const persistence: NativeTabsStatePersistence = Object.freeze({
    async flush() {
      if (!draining && pending === undefined) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
        if (!draining) void drain();
      });
    },
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe();
    },
  });
  if (getOwner() !== null) onCleanup(() => persistence.dispose());
  return persistence;
}

function nativeTabsProvenance(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 2_147_483_647
  ) {
    throw new TypeError(`${path} must be a non-negative 32-bit integer.`);
  }
  return value;
}

function nativeTabsBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean.`);
  }
  return value;
}

function parseNativeTabSelection(
  event: NativeSyntheticEvent,
): NativeTabSelection {
  const payload = plainRecord(event.payload, "native tab selection payload");
  const actionOrigin = payload.actionOrigin;
  if (
    actionOrigin !== "user" &&
    actionOrigin !== "programmatic-js" &&
    actionOrigin !== "programmatic-native" &&
    actionOrigin !== "implicit"
  ) {
    throw new TypeError(
      "native tab selection payload.actionOrigin is invalid.",
    );
  }
  return {
    selectedKey: normalizeNativeTabKey(
      payload.selectedScreenKey,
      "native tab selection payload.selectedScreenKey",
    ),
    provenance: nativeTabsProvenance(
      payload.provenance,
      "native tab selection payload.provenance",
    ),
    repeated: nativeTabsBoolean(
      payload.isRepeated,
      "native tab selection payload.isRepeated",
    ),
    triggeredSpecialEffect: nativeTabsBoolean(
      payload.hasTriggeredSpecialEffect,
      "native tab selection payload.hasTriggeredSpecialEffect",
    ),
    actionOrigin,
  };
}

function parseNativeTabSelectionRejection(
  event: NativeSyntheticEvent,
): NativeTabSelectionRejection {
  const payload = plainRecord(
    event.payload,
    "native tab selection rejection payload",
  );
  const reason = payload.rejectionReason;
  if (reason !== "stale" && reason !== "repeated") {
    throw new TypeError(
      "native tab selection rejection payload.rejectionReason is invalid.",
    );
  }
  return {
    selectedKey: normalizeNativeTabKey(
      payload.selectedScreenKey,
      "native tab selection rejection payload.selectedScreenKey",
    ),
    provenance: nativeTabsProvenance(
      payload.provenance,
      "native tab selection rejection payload.provenance",
    ),
    rejectedKey: normalizeNativeTabKey(
      payload.rejectedScreenKey,
      "native tab selection rejection payload.rejectedScreenKey",
    ),
    rejectedBaseProvenance: nativeTabsProvenance(
      payload.rejectedBaseProvenance,
      "native tab selection rejection payload.rejectedBaseProvenance",
    ),
    reason,
  };
}

function parseNativeTabSelectionPrevention(
  event: NativeSyntheticEvent,
): NativeTabSelectionPrevention {
  const payload = plainRecord(
    event.payload,
    "native tab selection prevention payload",
  );
  return {
    selectedKey: normalizeNativeTabKey(
      payload.selectedScreenKey,
      "native tab selection prevention payload.selectedScreenKey",
    ),
    provenance: nativeTabsProvenance(
      payload.provenance,
      "native tab selection prevention payload.provenance",
    ),
    preventedKey: normalizeNativeTabKey(
      payload.preventedScreenKey,
      "native tab selection prevention payload.preventedScreenKey",
    ),
  };
}

/**
 * Retains one keyed Solid owner per native tab and reconciles the pinned
 * native host's provenance protocol with optional controlled Solid state.
 * Upstream tabs are stable; this projection remains locally experimental until
 * each pinned release completes Solid Native's physical promotion matrix.
 */
export function NativeTabs<Tab extends NativeTabDefinition>(
  props: NativeTabsProps<Tab>,
): NativeNode {
  const tabs = createMemo<readonly Tab[]>(() => {
    if (!Array.isArray(props.tabs) || props.tabs.length === 0) {
      throw new TypeError("NativeTabs tabs must be a non-empty array.");
    }
    if (props.tabs.length > NATIVE_TABS_MAX_ITEMS) {
      throw new RangeError(
        `NativeTabs tabs must contain at most ${String(NATIVE_TABS_MAX_ITEMS)} items.`,
      );
    }
    const keys = new Set<string>();
    for (const [index, tab] of props.tabs.entries()) {
      if (tab === null || typeof tab !== "object") {
        throw new TypeError(`NativeTabs tabs[${index}] must be an object.`);
      }
      const key = normalizeNativeTabKey(
        tab.key,
        `NativeTabs tabs[${index}].key`,
      );
      if (keys.has(key)) {
        throw new TypeError(
          `NativeTabs tab key ${JSON.stringify(key)} is duplicated.`,
        );
      }
      keys.add(key);
    }
    return props.tabs;
  });
  const { initialTabs, initialDefaultSelectedKey, initialSelectedKeyProp } =
    untrack(() => ({
      initialTabs: tabs(),
      initialDefaultSelectedKey: props.defaultSelectedKey,
      initialSelectedKeyProp: props.selectedKey,
    }));
  if (initialDefaultSelectedKey !== undefined) {
    normalizeNativeTabKey(
      initialDefaultSelectedKey,
      "NativeTabs defaultSelectedKey",
    );
  }
  const initialSelectedKey = normalizeNativeTabKey(
    initialSelectedKeyProp ?? initialDefaultSelectedKey ?? initialTabs[0]!.key,
    "NativeTabs initial selected key",
  );
  if (!initialTabs.some((tab) => tab.key === initialSelectedKey)) {
    throw new RangeError(
      `NativeTabs initial selected key ${JSON.stringify(initialSelectedKey)} does not identify a tab.`,
    );
  }

  const [nativeSelectedKey, setNativeSelectedKey] =
    createSignal(initialSelectedKey);
  const [nativeProvenance, setNativeProvenance] = createSignal(0);
  const [navigationRequest, setNavigationRequest] = createSignal(
    {
      selectedKey: initialSelectedKey,
      baseProvenance: 0,
    },
    { ownedWrite: true },
  );
  const desiredSelectedKey = createMemo(() => {
    const currentTabs = tabs();
    const available = new Set(currentTabs.map((tab) => tab.key));
    const desired =
      props.selectedKey ??
      (available.has(nativeSelectedKey())
        ? nativeSelectedKey()
        : currentTabs[0]!.key);
    const selectedKey = normalizeNativeTabKey(
      desired,
      "NativeTabs selectedKey",
    );
    if (!available.has(selectedKey)) {
      throw new RangeError(
        `NativeTabs selectedKey ${JSON.stringify(selectedKey)} does not identify a tab.`,
      );
    }
    return selectedKey;
  });

  effect(
    () => ({
      desiredKey: desiredSelectedKey(),
      nativeKey: nativeSelectedKey(),
      request: navigationRequest(),
      provenance: nativeProvenance(),
    }),
    ({ desiredKey, nativeKey, request, provenance }) => {
      if (desiredKey === nativeKey) return;
      if (
        request.selectedKey === desiredKey &&
        request.baseProvenance === provenance
      ) {
        return;
      }
      setNavigationRequest({
        selectedKey: desiredKey,
        baseProvenance: provenance,
      });
    },
  );

  const requireCurrentTab = (key: string): void => {
    if (!tabs().some((tab) => tab.key === key)) {
      throw new RangeError(
        `The native tabs host selected unknown tab ${JSON.stringify(key)}.`,
      );
    }
  };
  const reportError = (error: unknown): void => {
    if (!reportIsolatedError(props.onError, error)) throw error;
  };
  const handleSelected = (event: NativeSyntheticEvent): void => {
    try {
      const selection = parseNativeTabSelection(event);
      requireCurrentTab(selection.selectedKey);
      setNativeSelectedKey(selection.selectedKey);
      setNativeProvenance(selection.provenance);
      props.onTabSelected?.(selection, event);
    } catch (error) {
      reportError(error);
    }
  };
  const handleRejected = (event: NativeSyntheticEvent): void => {
    try {
      const rejection = parseNativeTabSelectionRejection(event);
      requireCurrentTab(rejection.selectedKey);
      setNativeSelectedKey(rejection.selectedKey);
      setNativeProvenance(rejection.provenance);
      props.onTabSelectionRejected?.(rejection, event);
    } catch (error) {
      reportError(error);
    }
  };
  const handlePrevented = (event: NativeSyntheticEvent): void => {
    try {
      const prevention = parseNativeTabSelectionPrevention(event);
      requireCurrentTab(prevention.selectedKey);
      setNativeSelectedKey(prevention.selectedKey);
      setNativeProvenance(prevention.provenance);
      props.onTabSelectionPrevented?.(prevention, event);
    } catch (error) {
      reportError(error);
    }
  };

  const screens = mapArray(
    tabs,
    (tab: Accessor<Tab>, index: Accessor<number>) => {
      const tabKey = tab().key;
      const options = createMemo(() =>
        inheritNativeScreenOptions(
          props.defaultScreenOptions,
          props.screenOptions?.(tab(), index()),
        ),
      );
      const isSelected = createMemo(() => nativeSelectedKey() === tabKey);
      const content = props.children(tab, index, isSelected);
      return createComponent(TabsScreen, {
        screenKey: tabKey,
        get style() {
          return options().style;
        },
        get title() {
          return options().title;
        },
        get badgeValue() {
          return options().badgeValue;
        },
        get icon() {
          return options().icon;
        },
        get selectedIcon() {
          return options().selectedIcon;
        },
        get standardAppearance() {
          return options().standardAppearance;
        },
        get scrollEdgeAppearance() {
          return options().scrollEdgeAppearance;
        },
        get preventNativeSelection() {
          return options().preventNativeSelection;
        },
        get tabBarItemTestID() {
          return options().tabBarItemTestID;
        },
        get tabBarItemAccessibilityLabel() {
          return options().tabBarItemAccessibilityLabel;
        },
        get specialEffects() {
          return options().specialEffects;
        },
        get orientation() {
          return options().orientation;
        },
        ...(props.onTabWillAppear === undefined
          ? {}
          : {
              onWillAppear: (event: NativeSyntheticEvent) =>
                props.onTabWillAppear?.(tab(), event),
            }),
        ...(props.onTabDidAppear === undefined
          ? {}
          : {
              onDidAppear: (event: NativeSyntheticEvent) =>
                props.onTabDidAppear?.(tab(), event),
            }),
        ...(props.onTabWillDisappear === undefined
          ? {}
          : {
              onWillDisappear: (event: NativeSyntheticEvent) =>
                props.onTabWillDisappear?.(tab(), event),
            }),
        ...(props.onTabDidDisappear === undefined
          ? {}
          : {
              onDidDisappear: (event: NativeSyntheticEvent) =>
                props.onTabDidDisappear?.(tab(), event),
            }),
        children: content,
      });
    },
    { keyed: (tab) => tab.key },
  );

  return createComponent(TabsHost, {
    get selectedKey() {
      return navigationRequest().selectedKey;
    },
    get baseProvenance() {
      return navigationRequest().baseProvenance;
    },
    rejectStaleNavStateUpdates: true,
    get tabBarHidden() {
      return props.tabBarHidden;
    },
    get nativeContainerBackgroundColor() {
      return props.nativeContainerBackgroundColor;
    },
    get direction() {
      return props.direction;
    },
    get colorScheme() {
      return props.colorScheme;
    },
    get tabBarRespectsIMEInsets() {
      return props.tabBarRespectsIMEInsets;
    },
    get tabBarTintColor() {
      return props.tabBarTintColor;
    },
    get tabBarMinimizeBehavior() {
      return props.tabBarMinimizeBehavior;
    },
    get tabBarControllerMode() {
      return props.tabBarControllerMode;
    },
    onTabSelected: handleSelected,
    onTabSelectionRejected: handleRejected,
    onTabSelectionPrevented: handlePrevented,
    get children() {
      return screens();
    },
  });
}

export function NativeStack(props: NativeStackProps): NativeNode {
  const [snapshot, setSnapshot] = createSignal(props.history.snapshot);
  const [hasPlatformTransitionBlockers, setHasPlatformTransitionBlockers] =
    createSignal(props.history.hasPlatformTransitionBlockers);
  const awaitingNativeCompletion: string[] = [];
  const screenFocusSetters = new Map<string, (focused: boolean) => void>();
  const unsubscribe = props.history.subscribe((update) => {
    if (update.transition.origin !== "platform") {
      if (update.transition.kind === "replace") {
        // Replace preserves the stable screen identity, so the native stack
        // receives an ordinary reactive content/prop update rather than a
        // presentation transition and is not required to emit transitionEnd.
        props.history.acknowledgeApplicationTransition(update.transition.id);
      } else {
        awaitingNativeCompletion.push(update.transition.id);
      }
    }
    setSnapshot(update.snapshot);
    props.onUpdate?.(update);
  });
  onCleanup(unsubscribe);
  const unsubscribePlatformTransitionBlockers =
    props.history.subscribePlatformTransitionBlockers(
      setHasPlatformTransitionBlockers,
    );
  onCleanup(unsubscribePlatformTransitionBlockers);

  const completeApplicationTransitions = (): void => {
    for (const transition of awaitingNativeCompletion.splice(0)) {
      props.history.acknowledgeApplicationTransition(transition);
    }
  };
  // A presenter that leaves its Solid owner can no longer observe native
  // completion. Relinquish every acknowledgement it owns so an externally
  // retained history cannot accumulate orphaned transition diagnostics.
  onCleanup(completeApplicationTransitions);
  const reportPlatformBackError = (error: unknown): void => {
    if (!reportIsolatedError(props.onPlatformBackError, error)) throw error;
  };
  const handleNativeDismiss = (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ) => {
    const currentSnapshot = snapshot();
    const current = currentSnapshot.entries[currentSnapshot.index];
    if (
      currentSnapshot.index === 0 ||
      current?.id !== entry.id ||
      props.history.hasPendingPlatformTransition
    ) {
      return undefined;
    }
    let transition: NativeNavigationTransition | undefined;
    try {
      transition = props.history.requestPlatformBack(dismissCount(event));
    } catch (error) {
      reportPlatformBackError(error);
      return undefined;
    }
    if (transition === undefined) return undefined;
    // Do not dispose the keyed Solid owner whose native event handler is still
    // executing. When blockers exist, react-native-screens has kept the native
    // screen in place and this decision may be asynchronous. An allowed result
    // removes it through ordinary Solid reconciliation; a blocked result keeps
    // both native and logical stacks unchanged.
    return retainCausalNativeEvent(undefined, (retention) => {
      const run = <T>(callback: () => T): T =>
        retention.state === "active" ? retention.run(callback) : callback();
      const settlement = Promise.resolve()
        .then(async () => {
          const blocked = props.history.hasPlatformTransitionBlockers
            ? await props.history.isPlatformTransitionBlocked(transition.id)
            : false;
          run(() => {
            if (
              !props.history.completePlatformTransition(transition.id, !blocked)
            ) {
              return;
            }
            if (blocked) props.onPlatformBackBlocked?.(entry, event);
            else props.onPlatformBack?.(transition);
          });
        })
        .catch((error: unknown) => {
          run(() => {
            props.history.completePlatformTransition(transition.id, false);
            reportPlatformBackError(error);
          });
        });
      void settlement.then(
        () => retention.finish(),
        (error: unknown) => {
          retention.fail(error);
          throw error;
        },
      );
    });
  };

  const screens = mapArray(
    () => {
      const current = snapshot();
      return current.entries.slice(0, current.index + 1);
    },
    (entry: Accessor<NativeHistoryEntry>, index: Accessor<number>) => {
      const options = createMemo(() =>
        inheritNativeScreenOptions(
          props.defaultScreenOptions,
          props.screenOptions?.(entry(), index()),
        ),
      );
      const [isFocused, setIsFocused] = createSignal(false);
      const entryId = entry().id;
      const presentation = untrack(() => options().presentation ?? "push");
      screenFocusSetters.set(entryId, setIsFocused);
      onCleanup(() => screenFocusSetters.delete(entryId));
      // Create route content exactly once for this keyed screen owner. The
      // entry and index accessors remain reactive across replace/reorder, but a
      // parent stack reconciliation must not reconstruct the native subtree.
      const content = props.children(entry, index, isFocused);
      const header = props.renderHeader?.(entry, index, isFocused);
      return createComponent(Screen, {
        get name() {
          return entry().id;
        },
        get style() {
          return options().style;
        },
        get presentation() {
          return presentation;
        },
        get gestureEnabled() {
          return options().gestureEnabled ?? true;
        },
        get nativeBackButtonDismissalEnabled() {
          return options().nativeBackButtonDismissalEnabled ?? true;
        },
        get preventNativeDismiss() {
          return (
            hasPlatformTransitionBlockers() ||
            options().preventNativeDismiss === true
          );
        },
        // Presentation kind is structural for one keyed native screen. Only a
        // sheet owner subscribes to the corresponding configuration surface.
        ...(presentation === "sheet"
          ? {
              get sheetAllowedDetents() {
                return options().sheetAllowedDetents;
              },
              get sheetInitialDetent() {
                return options().sheetInitialDetent;
              },
              get sheetLargestUndimmedDetent() {
                return options().sheetLargestUndimmedDetent;
              },
              get sheetGrabberVisible() {
                return options().sheetGrabberVisible;
              },
              get sheetCornerRadius() {
                return options().sheetCornerRadius;
              },
              get sheetExpandsWhenScrolledToEdge() {
                return options().sheetExpandsWhenScrolledToEdge;
              },
              get sheetElevation() {
                return options().sheetElevation;
              },
              get sheetShouldOverflowTopInset() {
                return options().sheetShouldOverflowTopInset;
              },
              get sheetDefaultResizeAnimationEnabled() {
                return options().sheetDefaultResizeAnimationEnabled;
              },
            }
          : {}),
        activityState: 2,
        onFocus(event) {
          // Android screen stacks may emit appear without a paired disappear
          // for the covered screen. A native stack has one focused owner, so
          // reconcile the complete keyed set from the positive event.
          for (const [screenId, setFocused] of screenFocusSetters) {
            setFocused(screenId === entryId);
          }
          props.onScreenFocus?.(entry(), event);
        },
        onBlur(event) {
          setIsFocused(false);
          props.onScreenBlur?.(entry(), event);
        },
        ...(props.onScreenSheetDetentChange === undefined
          ? {}
          : {
              onSheetDetentChange: (event: ScreenSheetDetentChangeEvent) =>
                props.onScreenSheetDetentChange?.(entry(), event),
            }),
        onDismiss(event) {
          return handleNativeDismiss(entry(), event);
        },
        onGestureCancel(event) {
          // A blocker-protected stack nested under a native tab reports its
          // prevented dismissal as gestureCancel, while a standalone stack
          // reports nativeDismissCancel. Both must enter the same history
          // arbitration path. Without blockers, gestureCancel remains a
          // natural user cancellation and cannot mutate history.
          if (hasPlatformTransitionBlockers()) {
            return handleNativeDismiss(entry(), event);
          } else {
            return props.onPlatformBackCancel?.(entry(), event);
          }
        },
        onNativeDismissCancel(event) {
          if (hasPlatformTransitionBlockers()) {
            return handleNativeDismiss(entry(), event);
          } else {
            return props.onPlatformBackBlocked?.(entry(), event);
          }
        },
        get children() {
          return header === undefined ? content : [content, header];
        },
      });
    },
    { keyed: (entry) => entry.id },
  );

  return createComponent(ScreenStack, {
    get style() {
      return props.style;
    },
    onTransitionEnd(event) {
      completeApplicationTransitions();
      props.onTransitionEnd?.(event);
    },
    get children() {
      return screens();
    },
  });
}

interface NativeModalPresentation {
  readonly entry: NativeHistoryEntry;
  readonly index: number;
  readonly shown: boolean;
  readonly visible: boolean;
}

function activeNativeModalPresentations(
  snapshot: NativeHistorySnapshot,
): readonly NativeModalPresentation[] {
  return snapshot.entries.slice(1, snapshot.index + 1).map((entry, offset) => ({
    entry,
    index: offset + 1,
    shown: false,
    visible: true,
  }));
}

function reconcileNativeModalPresentations(
  current: readonly NativeModalPresentation[],
  snapshot: NativeHistorySnapshot,
): readonly NativeModalPresentation[] {
  const active = activeNativeModalPresentations(snapshot);
  const activeById = new Map(
    active.map((presentation) => [presentation.entry.id, presentation]),
  );
  const closing = current.some((presentation) => !presentation.visible);
  if (closing) {
    // UIKit and Android Dialog dismissal are asynchronous. Do not reactivate a
    // closing route or mount replacement routes until its native hidden
    // boundary; doing so can ask one controller to present while it is still
    // dismissing. Active retained entries may still receive a replace update.
    return current.map((presentation) => {
      const target = activeById.get(presentation.entry.id);
      return target === undefined || !presentation.visible
        ? presentation
        : { ...presentation, entry: target.entry, index: target.index };
    });
  }

  const retired = current.filter(
    (presentation) => !activeById.has(presentation.entry.id),
  );
  if (retired.length > 0) {
    // A multi-pop or reset dismisses one real native container at a time from
    // the top. Lower routes retain their Solid owners and presentation until
    // the route above reports the portable hidden boundary.
    const topRetired = retired[retired.length - 1] as NativeModalPresentation;
    return current.map((presentation) => {
      const target = activeById.get(presentation.entry.id);
      if (target !== undefined) {
        return { ...presentation, entry: target.entry, index: target.index };
      }
      return presentation.entry.id === topRetired.entry.id
        ? { ...presentation, visible: false }
        : presentation;
    });
  }

  const previousById = new Map(
    current.map((presentation) => [presentation.entry.id, presentation]),
  );
  return active.map((presentation) => {
    const previous = previousById.get(presentation.entry.id);
    return previous === undefined
      ? presentation
      : { ...presentation, shown: previous.shown, visible: true };
  });
}

function nativeModalPresentationChanged(
  previous: NativeHistorySnapshot,
  next: NativeHistorySnapshot,
): boolean {
  const previousIds = new Set(
    previous.entries.slice(1, previous.index + 1).map((entry) => entry.id),
  );
  const nextIds = new Set(
    next.entries.slice(1, next.index + 1).map((entry) => entry.id),
  );
  return (
    previousIds.size !== nextIds.size ||
    [...previousIds].some((entryId) => !nextIds.has(entryId))
  );
}

/**
 * Projects the root NativeHistory entry as retained application content and
 * every active later entry as a keyed cross-platform Modal route.
 */
export function NativeModalStack(props: NativeModalStackProps): NativeNode {
  const initialSnapshot = props.history.snapshot;
  let latestSnapshot = initialSnapshot;
  const [snapshot, setSnapshot] = createSignal(initialSnapshot, {
    ownedWrite: true,
  });
  const [presentations, setPresentations] = createSignal<
    readonly NativeModalPresentation[]
  >(activeNativeModalPresentations(initialSnapshot), { ownedWrite: true });
  const [hasPlatformTransitionBlockers, setHasPlatformTransitionBlockers] =
    createSignal(props.history.hasPlatformTransitionBlockers);
  const awaitingNativeCompletion: string[] = [];

  const acknowledgeApplicationTransitions = (): void => {
    for (const transition of awaitingNativeCompletion.splice(0)) {
      props.history.acknowledgeApplicationTransition(transition);
    }
  };
  onCleanup(acknowledgeApplicationTransitions);
  const completeApplicationTransitions = (current = presentations()): void => {
    if (
      current.some(
        (presentation) => !presentation.visible || !presentation.shown,
      )
    ) {
      return;
    }
    acknowledgeApplicationTransitions();
  };
  const unsubscribe = props.history.subscribe((update) => {
    const previous = latestSnapshot;
    latestSnapshot = update.snapshot;
    if (update.transition.origin !== "platform") {
      if (nativeModalPresentationChanged(previous, update.snapshot)) {
        awaitingNativeCompletion.push(update.transition.id);
      } else {
        props.history.acknowledgeApplicationTransition(update.transition.id);
      }
    }
    setSnapshot(update.snapshot);
    setPresentations((current) =>
      reconcileNativeModalPresentations(current, update.snapshot),
    );
    props.onUpdate?.(update);
  });
  onCleanup(unsubscribe);
  const unsubscribePlatformTransitionBlockers =
    props.history.subscribePlatformTransitionBlockers(
      setHasPlatformTransitionBlockers,
    );
  onCleanup(unsubscribePlatformTransitionBlockers);

  const reportPlatformBackError = (error: unknown): void => {
    if (!reportIsolatedError(props.onPlatformBackError, error)) throw error;
  };
  const handlePlatformClose = (
    entry: NativeHistoryEntry,
    event: NativeSyntheticEvent,
  ): void => {
    const currentSnapshot = latestSnapshot;
    const current = currentSnapshot.entries[currentSnapshot.index];
    if (
      currentSnapshot.index === 0 ||
      current?.id !== entry.id ||
      props.history.hasPendingPlatformTransition
    ) {
      return;
    }
    let transition: NativeNavigationTransition | undefined;
    try {
      transition = props.history.requestPlatformBack(1);
    } catch (error) {
      reportPlatformBackError(error);
      return;
    }
    if (transition === undefined) return;
    if (!props.history.hasPlatformTransitionBlockers) {
      if (props.history.completePlatformTransition(transition.id, true)) {
        props.onPlatformBack?.(transition);
      }
      return;
    }
    void Promise.resolve()
      .then(async () => {
        const blocked = await props.history.isPlatformTransitionBlocked(
          transition.id,
        );
        if (
          !props.history.completePlatformTransition(transition.id, !blocked)
        ) {
          return;
        }
        if (blocked) props.onPlatformBackBlocked?.(entry, event);
        else props.onPlatformBack?.(transition);
      })
      .catch((error: unknown) => {
        props.history.completePlatformTransition(transition.id, false);
        reportPlatformBackError(error);
      });
  };

  const base = mapArray(
    () => {
      const root = snapshot().entries[0];
      return root === undefined ? [] : [root];
    },
    (entry: Accessor<NativeHistoryEntry>, index: Accessor<number>) => {
      const isFocused = createMemo(
        () => snapshot().index === 0 && presentations().length === 0,
      );
      return props.children(entry, index, isFocused);
    },
    { keyed: (entry) => entry.id },
  );

  const modalRoutes = mapArray(
    presentations,
    (presentation: Accessor<NativeModalPresentation>) => {
      const entry = createMemo(() => presentation().entry);
      const index = createMemo(() => presentation().index);
      const entryId = entry().id;
      const [nestedRoute, setNestedRoute] = createSignal<
        NativeNode | undefined
      >(undefined, { ownedWrite: true });
      const isFocused = createMemo(() => {
        const current = presentations();
        return (
          presentation().visible &&
          current[current.length - 1]?.entry.id === entryId
        );
      });
      const options = createMemo(() =>
        inheritNativeScreenOptions(
          props.defaultModalOptions,
          props.modalOptions?.(entry(), index()),
        ),
      );
      const content = props.children(entry, index, isFocused);
      const modal = createComponent(Modal, {
        get visible() {
          return presentation().visible;
        },
        get accessible() {
          return options().accessible;
        },
        get accessibilityHint() {
          return options().accessibilityHint;
        },
        get accessibilityLabel() {
          return options().accessibilityLabel;
        },
        get accessibilityRole() {
          return options().accessibilityRole;
        },
        get accessibilityState() {
          return options().accessibilityState;
        },
        get allowSwipeDismissal() {
          return (
            !hasPlatformTransitionBlockers() &&
            options().allowSwipeDismissal === true
          );
        },
        get animationType() {
          return options().animationType;
        },
        get backdropColor() {
          return options().backdropColor;
        },
        get hardwareAccelerated() {
          return options().hardwareAccelerated;
        },
        get hidden() {
          return options().hidden;
        },
        get nativeID() {
          return options().nativeID;
        },
        get navigationBarTranslucent() {
          return options().navigationBarTranslucent;
        },
        get presentationStyle() {
          return options().presentationStyle;
        },
        get statusBarTranslucent() {
          return options().statusBarTranslucent;
        },
        get style() {
          return options().style;
        },
        get supportedOrientations() {
          return options().supportedOrientations;
        },
        get testID() {
          return options().testID;
        },
        get transparent() {
          return options().transparent;
        },
        onShow(event) {
          const nextPresentations = presentations().map((candidate) =>
            candidate.entry.id === entryId
              ? { ...candidate, shown: true }
              : candidate,
          );
          setPresentations(nextPresentations);
          completeApplicationTransitions(nextPresentations);
          props.onModalShow?.(entry(), event);
        },
        onRequestClose(event) {
          props.onModalRequestClose?.(entry(), event);
          handlePlatformClose(entry(), event);
        },
        onDismiss(event) {
          // The pinned iOS interactive path emits requestClose before this
          // normalized completion, which has already marked the presentation
          // hidden. Retain dismiss-only backend compatibility without turning
          // an application dismissal (or a back/forward race) into a second
          // platform pop.
          if (presentation().visible) {
            handlePlatformClose(entry(), event);
          }
          props.onModalDismiss?.(entry(), event);
        },
        onHidden() {
          const hiddenEntry = entry();
          const nextPresentations = reconcileNativeModalPresentations(
            presentations().filter(
              (candidate) => candidate.entry.id !== entryId,
            ),
            latestSnapshot,
          );
          try {
            props.onModalHidden?.(hiddenEntry);
          } finally {
            setPresentations(nextPresentations);
            if (
              nextPresentations.every(
                (candidate) => candidate.visible && candidate.shown,
              )
            ) {
              acknowledgeApplicationTransitions();
            }
          }
        },
        ...(props.onModalOrientationChange === undefined
          ? {}
          : {
              onOrientationChange: (event: NativeSyntheticEvent) =>
                props.onModalOrientationChange?.(entry(), event),
            }),
        children: () => [content, nestedRoute()],
      } as ModalProps);
      return { modal, setNestedRoute };
    },
    { keyed: (presentation) => presentation.entry.id },
  );

  effect(modalRoutes, (routes) => {
    for (let index = 0; index < routes.length; index++) {
      routes[index]?.setNestedRoute(routes[index + 1]?.modal);
    }
  });

  return createComponent(View, {
    get style() {
      return [{ flex: 1 }, props.style];
    },
    get children() {
      return [...base(), modalRoutes()[0]?.modal];
    },
  });
}

export interface TanStackNativeScreenContextValue {
  readonly entry: Accessor<NativeHistoryEntry>;
  readonly index: Accessor<number>;
  readonly isFocused: Accessor<boolean>;
}

export const NATIVE_SCROLL_RESTORATION_VERSION = 0 as const;
export const NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH = 1_048_576;
export const NATIVE_SCROLL_RESTORATION_MAX_CONTAINERS_PER_ENTRY = 32;

export interface NativeScrollOffset {
  readonly x: number;
  readonly y: number;
}

export interface NativeScrollRestorationContainerSnapshot extends NativeScrollOffset {
  readonly restorationKey: string;
}

export interface NativeScrollRestorationEntrySnapshot {
  readonly entryId: string;
  readonly containers: readonly NativeScrollRestorationContainerSnapshot[];
}

export interface NativeScrollRestorationSnapshot {
  readonly entries: readonly NativeScrollRestorationEntrySnapshot[];
}

export type NativeScrollRestorationListener = () => void;

export interface NativeScrollRestorationOptions {
  readonly snapshot?: NativeScrollRestorationSnapshot;
}

export interface StoredNativeScrollRestorationOptions {
  readonly storage: NativeHistoryPersistenceStorage;
  readonly storageKey: string;
  /** Offsets are accepted only with the history snapshot that owns their IDs. */
  readonly historySource: NativeHistoryLaunchSource;
}

export interface NativeScrollRestorationLaunchResult {
  readonly restoration: NativeScrollRestoration;
  /** Present when malformed stored scroll state was discarded. */
  readonly restorationError?: unknown;
}

export interface NativeScrollRestorationPersistenceOptions {
  readonly storageKey: string;
  /** Idle time before serializing a changed snapshot. Defaults to 250 ms. */
  readonly writeDelayMs?: number;
  readonly onError?: (error: unknown) => unknown;
}

export interface NativeScrollRestorationPersistence {
  /** Writes or retries the newest scheduled offset snapshot and awaits durability. */
  flush(): Promise<void>;
  /** Stops observing offsets. Already-started native writes still settle. */
  dispose(): void;
}

function normalizedNativeScrollOffset(
  value: unknown,
  path: string,
): NativeScrollOffset {
  const offset = plainRecord(value, path);
  if (
    typeof offset.x !== "number" ||
    !Number.isFinite(offset.x) ||
    offset.x < 0 ||
    typeof offset.y !== "number" ||
    !Number.isFinite(offset.y) ||
    offset.y < 0
  ) {
    throw new TypeError(`${path} must contain finite non-negative x and y.`);
  }
  return { x: offset.x, y: offset.y };
}

function normalizeNativeScrollRestorationSnapshot(
  value: unknown,
): NativeScrollRestorationSnapshot {
  const snapshot = plainRecord(value, "native scroll restoration snapshot");
  if (!Array.isArray(snapshot.entries)) {
    throw new TypeError(
      "Native scroll restoration snapshot entries must be an array.",
    );
  }
  if (snapshot.entries.length > NATIVE_HISTORY_MAX_ENTRIES) {
    throw new RangeError(
      `Native scroll restoration cannot exceed ${String(NATIVE_HISTORY_MAX_ENTRIES)} entries.`,
    );
  }
  const entryIds = new Set<string>();
  const entries = snapshot.entries.map((value, entryIndex) => {
    const path = `native scroll restoration entry ${String(entryIndex)}`;
    const entry = plainRecord(value, path);
    const entryId = normalizeEntryId(entry.entryId, `${path} id`);
    if (entryIds.has(entryId)) {
      throw new Error(`Duplicate native scroll restoration entry: ${entryId}.`);
    }
    entryIds.add(entryId);
    if (!Array.isArray(entry.containers)) {
      throw new TypeError(`${path} containers must be an array.`);
    }
    if (
      entry.containers.length >
      NATIVE_SCROLL_RESTORATION_MAX_CONTAINERS_PER_ENTRY
    ) {
      throw new RangeError(
        `${path} cannot contain more than ${String(NATIVE_SCROLL_RESTORATION_MAX_CONTAINERS_PER_ENTRY)} containers.`,
      );
    }
    const restorationKeys = new Set<string>();
    const containers = entry.containers.map((value, containerIndex) => {
      const containerPath = `${path} container ${String(containerIndex)}`;
      const container = plainRecord(value, containerPath);
      const restorationKey = normalizeScrollRestorationKey(
        container.restorationKey,
      );
      if (restorationKeys.has(restorationKey)) {
        throw new Error(
          `Duplicate native scroll restoration container: ${restorationKey}.`,
        );
      }
      restorationKeys.add(restorationKey);
      return {
        restorationKey,
        ...normalizedNativeScrollOffset(container, containerPath),
      };
    });
    containers.sort((left, right) =>
      left.restorationKey.localeCompare(right.restorationKey),
    );
    return { entryId, containers };
  });
  entries.sort((left, right) => left.entryId.localeCompare(right.entryId));
  return { entries };
}

const EMPTY_NATIVE_SCROLL_RESTORATION_SERIALIZED_LENGTH = JSON.stringify({
  version: NATIVE_SCROLL_RESTORATION_VERSION,
  snapshot: { entries: [] },
}).length;

function nativeScrollContainerSerializedLength(
  restorationKey: string,
  offset: NativeScrollOffset,
): number {
  return JSON.stringify({
    restorationKey,
    x: offset.x,
    y: offset.y,
  }).length;
}

function nativeScrollEntrySerializedLength(
  entryId: string,
  offsets: ReadonlyMap<string, NativeScrollOffset>,
): number {
  let length = JSON.stringify({ entryId, containers: [] }).length;
  let containerCount = 0;
  for (const [restorationKey, offset] of offsets) {
    length += nativeScrollContainerSerializedLength(restorationKey, offset);
    if (containerCount > 0) length++;
    containerCount++;
  }
  return length;
}

export function serializeNativeScrollRestorationSnapshot(
  snapshot: NativeScrollRestorationSnapshot,
): string {
  const serialized = JSON.stringify({
    version: NATIVE_SCROLL_RESTORATION_VERSION,
    snapshot: normalizeNativeScrollRestorationSnapshot(snapshot),
  });
  if (serialized.length > NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH) {
    throw new RangeError(
      `Serialized native scroll restoration exceeds ${String(NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH)} characters.`,
    );
  }
  return serialized;
}

export function deserializeNativeScrollRestorationSnapshot(
  serialized: unknown,
): NativeScrollRestorationSnapshot {
  if (typeof serialized !== "string") {
    throw new TypeError(
      "Serialized native scroll restoration must be a string.",
    );
  }
  if (serialized.length > NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH) {
    throw new RangeError(
      `Serialized native scroll restoration exceeds ${String(NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH)} characters.`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch {
    throw new SyntaxError(
      "Serialized native scroll restoration is not valid JSON.",
    );
  }
  const envelope = plainRecord(decoded, "native scroll restoration");
  if (envelope.version !== NATIVE_SCROLL_RESTORATION_VERSION) {
    throw new Error(
      `Unsupported native scroll restoration version: ${String(envelope.version)}.`,
    );
  }
  return normalizeNativeScrollRestorationSnapshot(envelope.snapshot);
}

/**
 * Owns bounded offsets for the live entries of one NativeHistory. A supplied
 * snapshot is pruned against that history before any route can read it.
 */
export class NativeScrollRestoration {
  readonly #history: NativeHistory;
  readonly #listeners = new Set<NativeScrollRestorationListener>();
  readonly #offsets = new Map<string, Map<string, NativeScrollOffset>>();
  readonly #entrySerializedLengths = new Map<string, number>();
  #entryIds = new Set<string>();
  #serializedLength = EMPTY_NATIVE_SCROLL_RESTORATION_SERIALIZED_LENGTH;
  #unsubscribeHistory: () => void;
  #active = true;

  constructor(
    history: NativeHistory,
    options: NativeScrollRestorationOptions = {},
  ) {
    this.#history = history;
    const snapshot = normalizeNativeScrollRestorationSnapshot(
      options.snapshot ?? { entries: [] },
    );
    this.#entryIds = new Set(history.snapshot.entries.map((entry) => entry.id));
    for (const entry of snapshot.entries) {
      if (!this.#entryIds.has(entry.entryId)) continue;
      const offsets = new Map(
        entry.containers.map((container) => [
          container.restorationKey,
          { x: container.x, y: container.y },
        ]),
      );
      const entryLength = nativeScrollEntrySerializedLength(
        entry.entryId,
        offsets,
      );
      this.#serializedLength +=
        entryLength + (this.#offsets.size === 0 ? 0 : 1);
      if (
        this.#serializedLength > NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH
      ) {
        throw new RangeError(
          `Serialized native scroll restoration exceeds ${String(NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH)} characters.`,
        );
      }
      this.#offsets.set(entry.entryId, offsets);
      this.#entrySerializedLengths.set(entry.entryId, entryLength);
    }
    this.#unsubscribeHistory = history.subscribe((update) => {
      this.#entryIds = new Set(
        update.snapshot.entries.map((entry) => entry.id),
      );
      let changed = false;
      for (const entryId of this.#offsets.keys()) {
        if (this.#entryIds.has(entryId)) continue;
        const entryLength = this.#entrySerializedLengths.get(entryId) as number;
        this.#serializedLength -=
          entryLength + (this.#offsets.size > 1 ? 1 : 0);
        this.#offsets.delete(entryId);
        this.#entrySerializedLengths.delete(entryId);
        changed = true;
      }
      if (changed) this.#notify();
    });
  }

  get history(): NativeHistory {
    return this.#history;
  }

  get snapshot(): NativeScrollRestorationSnapshot {
    return {
      entries: [...this.#offsets]
        .map(([entryId, offsets]) => ({
          entryId,
          containers: [...offsets]
            .map(([restorationKey, offset]) => ({
              restorationKey,
              x: offset.x,
              y: offset.y,
            }))
            .sort((left, right) =>
              left.restorationKey.localeCompare(right.restorationKey),
            ),
        }))
        .sort((left, right) => left.entryId.localeCompare(right.entryId)),
    };
  }

  subscribe(listener: NativeScrollRestorationListener): () => void {
    if (!this.#active) {
      throw new Error("Native scroll restoration has been disposed.");
    }
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  }

  read(
    entryId: string,
    restorationKey: string,
  ): NativeScrollOffset | undefined {
    const normalizedEntryId = normalizeEntryId(
      entryId,
      "native scroll restoration entry id",
    );
    const normalizedKey = normalizeScrollRestorationKey(restorationKey);
    const offset = this.#offsets.get(normalizedEntryId)?.get(normalizedKey);
    return offset === undefined ? undefined : { ...offset };
  }

  capture(
    entryId: string,
    restorationKey: string,
    offset: NativeScrollOffset,
  ): void {
    if (!this.#active) {
      throw new Error("Native scroll restoration has been disposed.");
    }
    const normalizedEntryId = normalizeEntryId(
      entryId,
      "native scroll restoration entry id",
    );
    if (!this.#entryIds.has(normalizedEntryId)) {
      throw new Error(
        `Native scroll restoration entry is not present in history: ${normalizedEntryId}.`,
      );
    }
    const normalizedKey = normalizeScrollRestorationKey(restorationKey);
    const normalizedOffset = normalizedNativeScrollOffset(
      offset,
      "native scroll restoration offset",
    );
    const existingOffsets = this.#offsets.get(normalizedEntryId);
    const offsets = existingOffsets ?? new Map<string, NativeScrollOffset>();
    if (
      !offsets.has(normalizedKey) &&
      offsets.size >= NATIVE_SCROLL_RESTORATION_MAX_CONTAINERS_PER_ENTRY
    ) {
      throw new RangeError(
        `A native history entry cannot retain more than ${String(NATIVE_SCROLL_RESTORATION_MAX_CONTAINERS_PER_ENTRY)} scroll containers.`,
      );
    }
    const previous = offsets.get(normalizedKey);
    if (
      previous !== undefined &&
      previous.x === normalizedOffset.x &&
      previous.y === normalizedOffset.y
    ) {
      return;
    }
    const previousEntryLength =
      this.#entrySerializedLengths.get(normalizedEntryId) ??
      nativeScrollEntrySerializedLength(normalizedEntryId, offsets);
    const nextEntryLength =
      previousEntryLength -
      (previous === undefined
        ? 0
        : nativeScrollContainerSerializedLength(normalizedKey, previous)) +
      nativeScrollContainerSerializedLength(normalizedKey, normalizedOffset) +
      (previous === undefined && offsets.size > 0 ? 1 : 0);
    const nextSerializedLength =
      this.#serializedLength -
      (this.#entrySerializedLengths.has(normalizedEntryId)
        ? previousEntryLength
        : 0) +
      nextEntryLength +
      (this.#entrySerializedLengths.has(normalizedEntryId) ||
      this.#entrySerializedLengths.size === 0
        ? 0
        : 1);
    if (
      nextSerializedLength > NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH
    ) {
      throw new RangeError(
        `Serialized native scroll restoration exceeds ${String(NATIVE_SCROLL_RESTORATION_MAX_SERIALIZED_LENGTH)} characters.`,
      );
    }
    offsets.set(normalizedKey, normalizedOffset);
    if (existingOffsets === undefined) {
      this.#offsets.set(normalizedEntryId, offsets);
    }
    this.#entrySerializedLengths.set(normalizedEntryId, nextEntryLength);
    this.#serializedLength = nextSerializedLength;
    this.#notify();
  }

  dispose(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#unsubscribeHistory();
    this.#listeners.clear();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

/**
 * Loads a scroll snapshot only when navigation itself restored stable entry
 * IDs. Fresh and deep-link launches remove old offsets before returning.
 */
export async function createNativeScrollRestorationFromStorage(
  history: NativeHistory,
  options: StoredNativeScrollRestorationOptions,
): Promise<NativeScrollRestorationLaunchResult> {
  if (
    options.historySource !== "initial" &&
    options.historySource !== "restoration" &&
    options.historySource !== "deep-link"
  ) {
    throw new TypeError(
      "Native scroll restoration historySource must be initial, restoration, or deep-link.",
    );
  }
  const key = persistenceKey(options.storageKey);
  const serializedSnapshot = await options.storage.getItem(key);
  if (options.historySource !== "restoration") {
    if (serializedSnapshot !== null && serializedSnapshot !== undefined) {
      await options.storage.removeItem(key);
    }
    return { restoration: new NativeScrollRestoration(history) };
  }
  if (serializedSnapshot === null || serializedSnapshot === undefined) {
    return { restoration: new NativeScrollRestoration(history) };
  }
  let snapshot: NativeScrollRestorationSnapshot;
  try {
    snapshot = deserializeNativeScrollRestorationSnapshot(serializedSnapshot);
  } catch (restorationError) {
    await options.storage.removeItem(key);
    return {
      restoration: new NativeScrollRestoration(history),
      restorationError,
    };
  }
  const restoration = new NativeScrollRestoration(history, { snapshot });
  if (
    snapshot.entries.length > 0 &&
    restoration.snapshot.entries.length === 0
  ) {
    try {
      await options.storage.removeItem(key);
    } catch (error) {
      restoration.dispose();
      throw error;
    }
  }
  return { restoration };
}

/** Serializes and coalesces durable offset writes behind native storage. */
export function createNativeScrollRestorationPersistence(
  restoration: NativeScrollRestoration,
  storage: NativeHistoryPersistenceStorage,
  options: NativeScrollRestorationPersistenceOptions,
): NativeScrollRestorationPersistence {
  const key = persistenceKey(options.storageKey);
  const writeDelayMs = options.writeDelayMs ?? 250;
  if (
    !Number.isSafeInteger(writeDelayMs) ||
    writeDelayMs < 0 ||
    writeDelayMs > 60_000
  ) {
    throw new RangeError(
      "Native scroll restoration writeDelayMs must be an integer between 0 and 60000.",
    );
  }
  let pending: string | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let draining = false;
  let flushRequested = false;
  let active = true;
  const waiters: Array<{
    resolve(): void;
    reject(error: unknown): void;
  }> = [];

  const settleWaiters = (failed: boolean, failure?: unknown): void => {
    const settled = waiters.splice(0);
    for (const waiter of settled) {
      if (failed) waiter.reject(failure);
      else waiter.resolve();
    }
  };
  const reportError = (error: unknown): void => {
    reportIsolatedError(options.onError, error);
  };
  const clearWriteTimer = (): void => {
    if (writeTimer === undefined) return;
    clearTimeout(writeTimer);
    writeTimer = undefined;
  };
  const enqueueLatest = (): void => {
    if (!dirty) return;
    dirty = false;
    let serialized: string;
    try {
      serialized = serializeNativeScrollRestorationSnapshot(
        restoration.snapshot,
      );
    } catch (error) {
      reportError(error);
      return;
    }
    pending = serialized;
    if (!draining) void drain();
  };
  const scheduleIdleWrite = (): void => {
    if (
      !active ||
      !dirty ||
      draining ||
      flushRequested ||
      writeTimer !== undefined
    ) {
      return;
    }
    writeTimer = setTimeout(() => {
      writeTimer = undefined;
      enqueueLatest();
    }, writeDelayMs);
  };
  const drain = async (): Promise<void> => {
    draining = true;
    let failed = false;
    let failure: unknown;
    while (pending !== undefined) {
      const serialized = pending;
      pending = undefined;
      try {
        await storage.setItem(key, serialized);
      } catch (error) {
        reportError(error);
        // Preserve the failed value unless a newer serialized offset snapshot
        // arrived during the native write. Retry only after another change or
        // explicit flush so an unavailable store cannot create a hot loop.
        pending ??= serialized;
        failed = true;
        failure = error;
        break;
      }
      if (flushRequested && dirty) enqueueLatest();
    }
    draining = false;
    if (failed) {
      const rejectedFlush = flushRequested;
      flushRequested = false;
      if (rejectedFlush) settleWaiters(true, failure);
      if (dirty) scheduleIdleWrite();
      return;
    }
    if (flushRequested) {
      if (dirty) {
        enqueueLatest();
        if (draining) return;
      }
      flushRequested = false;
      settleWaiters(false);
      return;
    }
    scheduleIdleWrite();
  };
  const schedule = (): void => {
    dirty = true;
    clearWriteTimer();
    scheduleIdleWrite();
  };
  const unsubscribe = restoration.subscribe(schedule);
  schedule();

  const persistence: NativeScrollRestorationPersistence = Object.freeze({
    async flush() {
      if (!dirty && !draining && pending === undefined) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
        flushRequested = true;
        clearWriteTimer();
        enqueueLatest();
        if (!draining) {
          if (pending === undefined) {
            flushRequested = false;
            settleWaiters(false);
          } else {
            void drain();
          }
        }
      });
    },
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe();
      clearWriteTimer();
      dirty = false;
    },
  });
  if (getOwner() !== null) onCleanup(() => persistence.dispose());
  return persistence;
}

export interface TanStackNativeScrollViewProps extends ScrollViewProps {
  /** Distinguishes multiple restorable scroll containers within one route. */
  readonly restorationKey?: string;
  /** Observes malformed native offsets or an active restoration failure. */
  readonly onRestorationError?: (
    error: unknown,
    entry: NativeHistoryEntry,
    restorationKey: string,
  ) => unknown;
}

export type NativeScreenFocusSetup = () => void | (() => void);

export type NativeScreenFocusTask = (
  signal: AbortSignal,
) => void | PromiseLike<void>;

export interface NativeScreenFocusTaskOptions {
  /** Additional reactive gate, for example foreground AppState or connectivity. */
  readonly enabled?: Accessor<boolean>;
  /** Observes a task failure while its screen is still focused. */
  readonly onError?: (error: unknown) => unknown;
}

export type NativeAccessibilityFocusTarget =
  NativeNode | (() => NativeNode | undefined);

/**
 * Owns focus-only work beneath the current Solid owner. Setup runs after a
 * positive native focus event; its cleanup runs on blur, screen disposal, or
 * parent disposal before setup can run again.
 */
export function createNativeScreenFocusEffect(
  isFocused: Accessor<boolean>,
  setup: NativeScreenFocusSetup,
): void {
  let disposeFocused: (() => void) | undefined;
  effect(isFocused, (focused) => {
    disposeFocused?.();
    disposeFocused = undefined;
    if (!focused) return;
    createRoot((dispose) => {
      disposeFocused = dispose;
      try {
        const cleanup = setup();
        if (cleanup === undefined) return;
        if (typeof cleanup !== "function") {
          throw new TypeError(
            "A native screen focus setup must return a cleanup function or undefined.",
          );
        }
        onCleanup(cleanup);
      } catch (error) {
        disposeFocused = undefined;
        dispose();
        throw error;
      }
    });
  });
  onCleanup(() => {
    disposeFocused?.();
    disposeFocused = undefined;
  });
}

/**
 * Runs abort-aware asynchronous work for each native screen focus interval.
 * Blur or owner disposal aborts the interval before another task can start.
 * Rejections caused after cancellation are stale and intentionally ignored;
 * failures while the interval is active are reported without allowing a
 * failing diagnostic hook to replace the task failure.
 */
export function createNativeScreenFocusTask(
  isFocused: Accessor<boolean>,
  task: NativeScreenFocusTask,
  options: NativeScreenFocusTaskOptions = {},
): void {
  const isActive = (): boolean => {
    if (!isFocused()) return false;
    const enabled = options.enabled?.() ?? true;
    if (typeof enabled !== "boolean") {
      throw new TypeError(
        "A native screen focus task enabled accessor must return a boolean.",
      );
    }
    return enabled;
  };
  createNativeScreenFocusEffect(isActive, () => {
    const controller = new AbortController();
    let active = true;
    let result: void | PromiseLike<void>;
    try {
      result = task(controller.signal);
      if (
        result !== undefined &&
        (result === null ||
          (typeof result !== "object" && typeof result !== "function") ||
          typeof result.then !== "function")
      ) {
        throw new TypeError(
          "A native screen focus task must return a promise or undefined.",
        );
      }
    } catch (error) {
      active = false;
      controller.abort();
      if (!reportIsolatedError(options.onError, error)) throw error;
      return;
    }

    if (result !== undefined) {
      void Promise.resolve(result).catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        if (!reportIsolatedError(options.onError, error)) throw error;
      });
    }

    return () => {
      active = false;
      controller.abort();
    };
  });
}

/**
 * Moves platform accessibility focus once each time a native screen appears.
 * A target accessor is resolved at the positive native focus event, after the
 * keyed screen subtree has mounted.
 */
export function createNativeScreenAccessibilityFocus(
  isFocused: Accessor<boolean>,
  target: NativeAccessibilityFocusTarget,
): void {
  let ownerSettled = false;
  let initialFocusPending = false;
  const focusTarget = (): void => {
    const node = typeof target === "function" ? target() : target;
    if (node === undefined) {
      throw new Error(
        "The native accessibility focus target was unavailable after its focused screen settled.",
      );
    }
    void node.focusAccessibility();
  };
  // Register from the component's owner, not from the focus effect's
  // children-forbidden scope. This is the one route-mount interval where a
  // Screen may already be focused before its async match subtree assigns refs.
  onSettled(() => {
    ownerSettled = true;
    if (!initialFocusPending || !untrack(isFocused)) return;
    initialFocusPending = false;
    focusTarget();
  });
  createNativeScreenFocusEffect(isFocused, () => {
    if (ownerSettled) {
      focusTarget();
      return;
    }
    initialFocusPending = true;
    return () => {
      initialFocusPending = false;
    };
  });
}

const TanStackNativeScreenContext =
  createContext<TanStackNativeScreenContextValue>();
const TanStackNativeScrollRestorationContext =
  createContext<NativeScrollRestoration>();
const TanStackNativeScreenContextProvider =
  TanStackNativeScreenContext as unknown as (props: {
    readonly value: TanStackNativeScreenContextValue;
    readonly children: NativeNode;
  }) => NativeNode;
const TanStackNativeScrollRestorationContextProvider =
  TanStackNativeScrollRestorationContext as unknown as (props: {
    readonly value: NativeScrollRestoration;
    readonly children: NativeNode;
  }) => NativeNode;
const TanStackNativeScreenShow = Show as unknown as (props: {
  readonly when: RouterState | undefined;
  readonly fallback: NativeNode;
  readonly children: (state: Accessor<RouterState>) => NativeNode;
}) => NativeNode;

/** Reads the keyed native screen owning the current route component subtree. */
export function useTanStackNativeScreen(): TanStackNativeScreenContextValue {
  return useContext(TanStackNativeScreenContext);
}

function normalizeScrollRestorationKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.includes("\0")
  ) {
    throw new TypeError(
      "TanStackNativeScrollView restorationKey must be a 1-128 character string without null bytes.",
    );
  }
  return value;
}

function nativeScrollOffset(event: NativeSyntheticEvent): NativeScrollOffset {
  const payload = event.payload;
  const contentOffset =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Readonly<Record<string, HostValue>>).contentOffset
      : undefined;
  const x =
    contentOffset !== null &&
    typeof contentOffset === "object" &&
    !Array.isArray(contentOffset)
      ? (contentOffset as Readonly<Record<string, HostValue>>).x
      : undefined;
  const y =
    contentOffset !== null &&
    typeof contentOffset === "object" &&
    !Array.isArray(contentOffset)
      ? (contentOffset as Readonly<Record<string, HostValue>>).y
      : undefined;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  ) {
    throw new TypeError(
      "TanStackNativeScrollView scroll events must include finite x and y content offsets.",
    );
  }
  // UIKit reports negative bounce offsets. They are transient presentation
  // state and are not valid destinations for the portable scrollTo command.
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

const TANSTACK_NATIVE_SCROLL_VIEW_LOCAL_PROPERTIES = new Set<string | symbol>([
  "onRestorationError",
  "restorationKey",
]);

function tanStackNativeScrollViewProps(
  props: TanStackNativeScrollViewProps,
  ref: (handle: ScrollViewHandle) => void,
  onScroll: (event: NativeSyntheticEvent) => unknown,
): ScrollViewProps {
  return new Proxy(props, {
    get(target, property, receiver) {
      if (TANSTACK_NATIVE_SCROLL_VIEW_LOCAL_PROPERTIES.has(property)) {
        return undefined;
      }
      if (property === "ref") return ref;
      if (property === "onScroll") return onScroll;
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (TANSTACK_NATIVE_SCROLL_VIEW_LOCAL_PROPERTIES.has(property)) {
        return false;
      }
      return (
        property === "ref" || property === "onScroll" || property in target
      );
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target).filter(
        (property) =>
          !TANSTACK_NATIVE_SCROLL_VIEW_LOCAL_PROPERTIES.has(property),
      );
      if (!keys.includes("ref")) keys.push("ref");
      if (!keys.includes("onScroll")) keys.push("onScroll");
      return keys;
    },
    getOwnPropertyDescriptor(target, property) {
      if (TANSTACK_NATIVE_SCROLL_VIEW_LOCAL_PROPERTIES.has(property)) {
        return undefined;
      }
      if (property === "ref" || property === "onScroll") {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
  });
}

/**
 * A native ScrollView whose last finite offset follows its stable TanStack
 * history entry across route-tree parking and remounting. Mounted native views
 * retain their own position and are never commanded a second time.
 */
export function TanStackNativeScrollView(
  props: TanStackNativeScrollViewProps,
): NativeNode {
  const screen = useTanStackNativeScreen();
  const store = useContext(TanStackNativeScrollRestorationContext);
  const restorationKey = untrack(() =>
    normalizeScrollRestorationKey(props.restorationKey ?? "primary"),
  );
  let scrollView: ScrollViewHandle | undefined;
  let restoredNode: ScrollViewHandle | undefined;
  let restoringNode: ScrollViewHandle | undefined;
  let captureFailureActive = false;
  const reportRestorationError = (error: unknown): void => {
    if (
      !reportIsolatedError(
        props.onRestorationError,
        error,
        screen.entry(),
        restorationKey,
      )
    ) {
      throw error;
    }
  };
  const ref = (handle: ScrollViewHandle): void => {
    scrollView = handle;
    props.ref?.(handle);
  };
  const onScroll = (event: NativeSyntheticEvent): unknown => {
    try {
      store.capture(
        screen.entry().id,
        restorationKey,
        nativeScrollOffset(event),
      );
      captureFailureActive = false;
    } catch (error) {
      if (!captureFailureActive) {
        captureFailureActive = true;
        reportRestorationError(error);
      }
    }
    return props.onScroll?.(event);
  };
  const nativeScrollView = createComponent(
    ScrollView,
    tanStackNativeScrollViewProps(props, ref, onScroll),
  );
  createNativeScreenFocusTask(
    screen.isFocused,
    () => {
      const node = scrollView;
      const offset = store.read(untrack(screen.entry).id, restorationKey);
      if (
        node === undefined ||
        offset === undefined ||
        restoredNode === node ||
        restoringNode === node
      ) {
        return;
      }
      restoringNode = node;
      return node
        .scrollTo({ x: offset.x, y: offset.y, animated: false })
        .then(() => {
          restoredNode = node;
        })
        .finally(() => {
          if (restoringNode === node) restoringNode = undefined;
        });
    },
    { onError: reportRestorationError },
  );
  return nativeScrollView;
}

/** Focus-scopes work to the native screen owning the current route subtree. */
export function createTanStackNativeScreenFocusEffect(
  setup: NativeScreenFocusSetup,
): void {
  createNativeScreenFocusEffect(useTanStackNativeScreen().isFocused, setup);
}

/** Runs abort-aware work while the current TanStack native screen is focused. */
export function createTanStackNativeScreenFocusTask(
  task: NativeScreenFocusTask,
  options?: NativeScreenFocusTaskOptions,
): void {
  createNativeScreenFocusTask(
    useTanStackNativeScreen().isFocused,
    task,
    options,
  );
}

/** Moves accessibility focus when the current TanStack native screen appears. */
export function createTanStackNativeScreenAccessibilityFocus(
  target: NativeAccessibilityFocusTarget,
): void {
  createNativeScreenAccessibilityFocus(
    useTanStackNativeScreen().isFocused,
    target,
  );
}

export interface TanStackNativeStackProps<
  TRouter extends AnyRouter = AnyRouter,
> extends Omit<NativeStackProps, "children"> {
  readonly router?: TRouter;
  /**
   * Maximum TanStack match trees mounted across the current and inactive
   * native screens. The default keeps every active history entry mounted.
   * Native Screen containers, history entries, and settled router snapshots
   * remain intact when an older match tree is parked. The prop is reactive.
   */
  readonly maxMountedRouteTrees?: number;
  /**
   * Owner-bound memory policy. A warning cancels restored-entry preloading,
   * clears TanStack's inactive/preload cache, and drops inactive snapshots.
   */
  readonly memoryPolicy?: TanStackNativeMemoryPolicy;
  /**
   * Optional process-durable offset owner. It must be bound to the same
   * NativeHistory; otherwise the stack owns an in-memory controller.
   */
  readonly scrollRestoration?: NativeScrollRestoration;
  /**
   * Preloads and mounts at most this many nearest inactive entries from the
   * initial native stack. The default is zero so restored loaders never run
   * without an explicit application policy.
   */
  readonly preloadRestoredEntries?: number;
  /**
   * Selects each bounded restored-entry candidate before its loader starts.
   * The shared signal aborts when pressure begins or the stack owner disposes.
   */
  readonly shouldPreloadRestoredEntry?: (
    entry: NativeHistoryEntry,
    index: number,
    signal: AbortSignal,
  ) => boolean | Promise<boolean>;
  /** Observes setup failures without replacing the unresolved fallback. */
  readonly onPreloadError?: (
    error: unknown,
    entry: NativeHistoryEntry,
  ) => unknown;
  /**
   * Renders a safe placeholder for a restored or newly pushed screen until
   * that history index has received its first router match publication.
   */
  readonly renderUnresolved: (
    entry: Accessor<NativeHistoryEntry>,
    index: Accessor<number>,
    isFocused: Accessor<boolean>,
  ) => NativeNode;
  /** Renders inside a native Screen whose settled match tree is parked. */
  readonly renderParked?: (
    entry: Accessor<NativeHistoryEntry>,
    index: Accessor<number>,
    isFocused: Accessor<boolean>,
  ) => NativeNode;
}

interface TanStackNativeStackScreenProps {
  readonly states: Accessor<ReadonlyMap<string, RouterState>>;
  readonly readLiveState: Accessor<RouterState>;
  readonly entry: Accessor<NativeHistoryEntry>;
  readonly index: Accessor<number>;
  readonly isFocused: Accessor<boolean>;
  readonly isRouteTreeMounted: Accessor<boolean>;
  readonly renderUnresolved: TanStackNativeStackProps["renderUnresolved"];
  readonly renderParked: TanStackNativeStackProps["renderParked"];
  readonly scrollRestoration: NativeScrollRestoration;
}

function tanStackLocationIndex(state: RouterState): number | undefined {
  const index = state.location.state.__TSR_index;
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0
    ? index
    : undefined;
}

function isTanStackStateSettled(state: RouterState): boolean {
  const resolved = state.resolvedLocation;
  return (
    state.status === "idle" &&
    resolved !== undefined &&
    resolved.href === state.location.href &&
    resolved.state.__TSR_key === state.location.state.__TSR_key
  );
}

function tanStackPreloadCount(value: number | undefined): number {
  if (value === undefined) return 0;
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > NATIVE_HISTORY_MAX_ENTRIES
  ) {
    throw new RangeError(
      `preloadRestoredEntries must be an integer between 0 and ${String(NATIVE_HISTORY_MAX_ENTRIES)}.`,
    );
  }
  return value;
}

function tanStackRestoredPreloadDecision(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(
      "shouldPreloadRestoredEntry must resolve to a boolean.",
    );
  }
  return value;
}

function tanStackMountedRouteTreeLimit(
  value: number | undefined,
  name = "maxMountedRouteTrees",
): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > NATIVE_HISTORY_MAX_ENTRIES
  ) {
    throw new RangeError(
      `${name} must be an integer between 1 and ${String(NATIVE_HISTORY_MAX_ENTRIES)}.`,
    );
  }
  return value;
}

function tanStackMemoryWarningCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      "memoryPolicy.warningCount() must be a non-negative safe integer.",
    );
  }
  return value;
}

function tanStackMemoryPressureState(value: boolean): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(
      "memoryPolicy.isUnderMemoryPressure() must return a boolean.",
    );
  }
  return value;
}

export interface TanStackNativeMemoryPolicyOptions {
  /** Route trees retained before the application enters pressure mode. */
  readonly normalMountedRouteTrees: number;
  /** Route trees retained after a warning and before recovery is acknowledged. */
  readonly pressuredMountedRouteTrees: number;
  /**
   * Evicts application-owned caches for each observed warning generation.
   * The return value is not awaited by native navigation reclamation.
   */
  readonly onMemoryPressure?: (warningCount: number) => unknown;
  /** Observes an isolated sync or async application cache-eviction failure. */
  readonly onMemoryPressureError?: (
    error: unknown,
    warningCount: number,
  ) => unknown;
}

export interface TanStackNativeMemoryPolicy {
  /** Monotonic native warning generation owned by the creating Solid owner. */
  readonly warningCount: Accessor<number>;
  /** True from the latest warning until application recovery is acknowledged. */
  readonly isUnderMemoryPressure: Accessor<boolean>;
  /** Reactive route-tree limit for `TanStackNativeStack`. */
  readonly maxMountedRouteTrees: Accessor<number>;
  /** Allows the application to restore its normal route-tree budget. */
  acknowledgeRecovery(): void;
}

function notifyTanStackNativeMemoryPressure(
  options: TanStackNativeMemoryPolicyOptions,
  warningCount: number,
): void {
  const handler = options.onMemoryPressure;
  if (handler === undefined) return;
  try {
    const result = handler(warningCount);
    void Promise.resolve(result).catch((error: unknown) => {
      reportIsolatedError(options.onMemoryPressureError, error, warningCount);
    });
  } catch (error) {
    reportIsolatedError(options.onMemoryPressureError, error, warningCount);
  }
}

/**
 * Couples native pressure delivery to an explicit, recoverable navigation
 * budget. The source subscription follows the current Solid owner.
 */
export function createTanStackNativeMemoryPolicy(
  source: MemoryWarningSource,
  options: TanStackNativeMemoryPolicyOptions,
): TanStackNativeMemoryPolicy {
  const normalMountedRouteTrees = tanStackMountedRouteTreeLimit(
    options.normalMountedRouteTrees,
    "normalMountedRouteTrees",
  )!;
  const pressuredMountedRouteTrees = tanStackMountedRouteTreeLimit(
    options.pressuredMountedRouteTrees,
    "pressuredMountedRouteTrees",
  )!;
  if (pressuredMountedRouteTrees > normalMountedRouteTrees) {
    throw new RangeError(
      "pressuredMountedRouteTrees cannot exceed normalMountedRouteTrees.",
    );
  }
  const warningCount = createMemoryWarningCount(source);
  const [recoveredThroughWarning, setRecoveredThroughWarning] = createSignal(0);
  const isUnderMemoryPressure = createMemo(
    () => warningCount() > recoveredThroughWarning(),
  );
  const maxMountedRouteTrees = createMemo(() =>
    isUnderMemoryPressure()
      ? pressuredMountedRouteTrees
      : normalMountedRouteTrees,
  );
  let observedWarningCount = untrack(warningCount);
  effect(warningCount, (nextWarningCount) => {
    if (nextWarningCount <= observedWarningCount) return;
    observedWarningCount = nextWarningCount;
    notifyTanStackNativeMemoryPressure(options, nextWarningCount);
  });
  return Object.freeze({
    warningCount,
    isUnderMemoryPressure,
    maxMountedRouteTrees,
    acknowledgeRecovery() {
      setRecoveredThroughWarning(untrack(warningCount));
    },
  });
}

function reportTanStackPreloadError(
  error: unknown,
  entry: NativeHistoryEntry,
  handler: TanStackNativeStackProps["onPreloadError"],
): void {
  reportIsolatedError(handler, error, entry);
}

interface TanStackNativeFrozenScreenProps {
  readonly state: Accessor<RouterState | undefined>;
  readonly isRouteTreeMounted: Accessor<boolean>;
  readonly entry: Accessor<NativeHistoryEntry>;
  readonly index: Accessor<number>;
  readonly isFocused: Accessor<boolean>;
  readonly renderUnresolved: TanStackNativeStackProps["renderUnresolved"];
  readonly renderParked: TanStackNativeStackProps["renderParked"];
}

function TanStackNativeFrozenScreen(
  props: TanStackNativeFrozenScreenProps,
): NativeNode {
  const requiredState = props.state as Accessor<RouterState>;
  const visibleState = (): RouterState | undefined =>
    props.isRouteTreeMounted() ? props.state() : undefined;
  return createComponent(TanStackNativeScreenShow, {
    get when() {
      return visibleState();
    },
    get fallback() {
      if (!props.isRouteTreeMounted() && props.renderParked !== undefined) {
        return props.renderParked(props.entry, props.index, props.isFocused);
      }
      return props.renderUnresolved(props.entry, props.index, props.isFocused);
    },
    children: (_state) =>
      createComponent(TanStackNativeMatches, {
        state: requiredState,
      }) as NativeNode,
  }) as NativeNode;
}

function TanStackNativeStackScreen(
  props: TanStackNativeStackScreenProps,
): NativeNode {
  const scrollRestoration = props.scrollRestoration;
  const state = (): RouterState | undefined => {
    const live = props.readLiveState();
    const entry = props.entry();
    if (
      isTanStackStateSettled(live) &&
      tanStackLocationIndex(live) === props.index() &&
      live.location.href === entry.href
    ) {
      return live;
    }
    return props.states().get(entry.id);
  };
  const context: TanStackNativeScreenContextValue = {
    entry: props.entry,
    index: props.index,
    isFocused: props.isFocused,
  };
  return createComponent(TanStackNativeScreenContextProvider, {
    value: context,
    get children() {
      return createComponent(TanStackNativeScrollRestorationContextProvider, {
        value: scrollRestoration,
        get children() {
          return createComponent(TanStackNativeFrozenScreen, {
            state,
            isRouteTreeMounted: props.isRouteTreeMounted,
            entry: props.entry,
            index: props.index,
            isFocused: props.isFocused,
            renderUnresolved: props.renderUnresolved,
            renderParked: props.renderParked,
          }) as NativeNode;
        },
      }) as NativeNode;
    },
  }) as NativeNode;
}

/**
 * Couples TanStack's current match publication to keyed native screen owners.
 * By default, each visited history entry retains its last settled match tree
 * while hidden. An explicit mount budget can park older match trees while
 * retaining their keyed native Screen containers and settled router state.
 */
export function TanStackNativeStack<TRouter extends AnyRouter = AnyRouter>(
  props: TanStackNativeStackProps<TRouter>,
): NativeNode {
  const router = props.router ?? useTanStackNativeRouter<TRouter>();
  const preloadRestoredEntries = tanStackPreloadCount(
    props.preloadRestoredEntries,
  );
  const mountedRouteTreeLimit = (): number | undefined => {
    const configured = tanStackMountedRouteTreeLimit(
      props.maxMountedRouteTrees,
    );
    const memoryPolicy = props.memoryPolicy;
    if (memoryPolicy === undefined) return configured;
    const policyLimit = tanStackMountedRouteTreeLimit(
      memoryPolicy.maxMountedRouteTrees(),
      "memoryPolicy.maxMountedRouteTrees()",
    )!;
    return configured === undefined
      ? policyLimit
      : Math.min(configured, policyLimit);
  };
  untrack(mountedRouteTreeLimit);
  if (
    nativeHistoryByTanStackHistory.get(router.history as RouterHistory) !==
    props.history
  ) {
    throw new Error(
      "TanStackNativeStack requires the NativeHistory used to create the router history adapter.",
    );
  }
  const readLiveState = router.stores.__store.get as Accessor<RouterState>;
  const ownsScrollRestoration = props.scrollRestoration === undefined;
  const scrollRestoration =
    props.scrollRestoration ?? new NativeScrollRestoration(props.history);
  if (scrollRestoration.history !== props.history) {
    if (ownsScrollRestoration) scrollRestoration.dispose();
    throw new Error(
      "TanStackNativeStack scrollRestoration must own the stack's NativeHistory.",
    );
  }
  if (ownsScrollRestoration) onCleanup(() => scrollRestoration.dispose());
  const readMemoryPressure = (): boolean => {
    const memoryPolicy = props.memoryPolicy;
    return memoryPolicy === undefined
      ? false
      : tanStackMemoryPressureState(memoryPolicy.isUnderMemoryPressure());
  };
  let retainedStates = new Map<string, RouterState>();
  const captureSettledState = (state: RouterState): boolean => {
    if (!isTanStackStateSettled(state)) return false;
    const index = tanStackLocationIndex(state);
    const snapshot = props.history.snapshot;
    if (index === undefined || index > snapshot.index) return false;
    const currentEntry = snapshot.entries[index];
    if (
      currentEntry === undefined ||
      currentEntry.href !== state.location.href
    ) {
      return false;
    }
    const activeIds = new Set(
      untrack(readMemoryPressure)
        ? [currentEntry.id]
        : snapshot.entries
            .slice(0, snapshot.index + 1)
            .map((entry) => entry.id),
    );
    const nextStates = new Map<string, RouterState>();
    for (const [entryId, retained] of retainedStates) {
      if (activeIds.has(entryId)) nextStates.set(entryId, retained);
    }
    nextStates.set(currentEntry.id, state);
    retainedStates = nextStates;
    return true;
  };
  const initialState = untrack(readLiveState);
  captureSettledState(initialState);
  const [states, setStates] = createSignal<ReadonlyMap<string, RouterState>>(
    retainedStates,
    {
      ownedWrite: true,
    },
  );
  let preloading = !untrack(readMemoryPressure);
  const preloadPolicyAbortController = new AbortController();
  let preloadStarted = false;
  const initialSnapshot = props.history.snapshot;
  const firstPreloadIndex = Math.max(
    0,
    initialSnapshot.index - preloadRestoredEntries,
  );
  const prewarm = async (): Promise<void> => {
    for (
      let index = initialSnapshot.index - 1;
      preloading && index >= firstPreloadIndex;
      index--
    ) {
      const entry = initialSnapshot.entries[index];
      if (entry === undefined || retainedStates.has(entry.id)) continue;
      try {
        const shouldPreloadRestoredEntry = props.shouldPreloadRestoredEntry;
        if (
          shouldPreloadRestoredEntry !== undefined &&
          !tanStackRestoredPreloadDecision(
            await shouldPreloadRestoredEntry(
              entry,
              index,
              preloadPolicyAbortController.signal,
            ),
          )
        ) {
          continue;
        }
        if (preloadPolicyAbortController.signal.aborted || !preloading) {
          continue;
        }
        const state = tanStackState(entry, index);
        const options = { to: entry.href, href: entry.href, state };
        const location = router.buildLocation(options);
        const expectedMatches = router.matchRoutes(location);
        const matches = await router.preloadRoute(options);
        if (!preloading || matches === undefined) continue;
        const latestSnapshot = props.history.snapshot;
        const latestEntry = latestSnapshot.entries[index];
        if (
          index > latestSnapshot.index ||
          latestEntry?.id !== entry.id ||
          latestEntry.href !== entry.href ||
          retainedStates.has(entry.id) ||
          matches.length !== expectedMatches.length ||
          matches.some(
            (match, matchIndex) =>
              match.routeId !== expectedMatches[matchIndex]?.routeId ||
              match.pathname !== expectedMatches[matchIndex]?.pathname,
          )
        ) {
          continue;
        }
        const nextStates = new Map(retainedStates);
        nextStates.set(entry.id, {
          status: "idle",
          isLoading: false,
          matches,
          location,
          resolvedLocation: location,
        });
        retainedStates = nextStates;
        setStates(nextStates);
      } catch (error) {
        if (preloading) {
          reportTanStackPreloadError(error, entry, props.onPreloadError);
        }
      }
    }
  };
  const startPrewarm = (state: RouterState): void => {
    if (
      preloadRestoredEntries === 0 ||
      preloadStarted ||
      !isTanStackStateSettled(state)
    ) {
      return;
    }
    const initialEntry = initialSnapshot.entries[initialSnapshot.index];
    if (
      initialEntry === undefined ||
      tanStackLocationIndex(state) !== initialSnapshot.index ||
      state.location.href !== initialEntry.href ||
      state.location.state.__TSR_key !==
        tanStackState(initialEntry, initialSnapshot.index).__TSR_key
    ) {
      return;
    }
    preloadStarted = true;
    // TanStack reads its Solid-backed stores while constructing preload
    // locations. Run that work after this effect's untracked apply phase.
    void Promise.resolve().then(prewarm);
  };
  const discardInactiveStates = (): void => {
    captureSettledState(untrack(readLiveState));
    const snapshot = props.history.snapshot;
    const currentEntry = snapshot.entries[snapshot.index];
    const currentState =
      currentEntry === undefined
        ? undefined
        : retainedStates.get(currentEntry.id);
    retainedStates =
      currentEntry === undefined || currentState === undefined
        ? new Map()
        : new Map([[currentEntry.id, currentState]]);
    setStates(retainedStates);
  };
  let observedMemoryPolicy: TanStackNativeMemoryPolicy | undefined;
  let observedMemoryWarningCount = 0;
  let wasUnderMemoryPressure = false;
  effect(
    () => {
      const memoryPolicy = props.memoryPolicy;
      if (memoryPolicy === undefined) {
        return {
          isUnderMemoryPressure: false,
          memoryPolicy,
          warningCount: 0,
        };
      }
      const isUnderMemoryPressure = tanStackMemoryPressureState(
        memoryPolicy.isUnderMemoryPressure(),
      );
      return {
        isUnderMemoryPressure,
        memoryPolicy,
        warningCount: tanStackMemoryWarningCount(memoryPolicy.warningCount()),
      };
    },
    ({ isUnderMemoryPressure, memoryPolicy, warningCount }) => {
      const policyChanged = memoryPolicy !== observedMemoryPolicy;
      const warningAdvanced =
        !policyChanged && warningCount > observedMemoryWarningCount;
      const pressureStarted = isUnderMemoryPressure && !wasUnderMemoryPressure;
      observedMemoryPolicy = memoryPolicy;
      observedMemoryWarningCount = warningCount;
      wasUnderMemoryPressure = isUnderMemoryPressure;
      if (!warningAdvanced && !pressureStarted) return;
      preloading = false;
      preloadPolicyAbortController.abort();
      discardInactiveStates();
      router.clearCache();
    },
  );
  effect(readLiveState, (state) => {
    if (captureSettledState(state)) setStates(retainedStates);
    startPrewarm(state);
  });
  startPrewarm(initialState);
  onCleanup(() => {
    preloading = false;
    preloadPolicyAbortController.abort();
  });
  return createComponent(NativeStack, {
    history: props.history,
    get style() {
      return props.style;
    },
    get defaultScreenOptions() {
      return props.defaultScreenOptions;
    },
    ...(props.screenOptions === undefined
      ? {}
      : { screenOptions: props.screenOptions }),
    ...(props.onTransitionEnd === undefined
      ? {}
      : { onTransitionEnd: props.onTransitionEnd }),
    ...(props.onScreenFocus === undefined
      ? {}
      : { onScreenFocus: props.onScreenFocus }),
    ...(props.onScreenBlur === undefined
      ? {}
      : { onScreenBlur: props.onScreenBlur }),
    ...(props.onScreenSheetDetentChange === undefined
      ? {}
      : {
          onScreenSheetDetentChange: props.onScreenSheetDetentChange,
        }),
    ...(props.onPlatformBack === undefined
      ? {}
      : { onPlatformBack: props.onPlatformBack }),
    ...(props.onPlatformBackCancel === undefined
      ? {}
      : { onPlatformBackCancel: props.onPlatformBackCancel }),
    ...(props.onPlatformBackBlocked === undefined
      ? {}
      : { onPlatformBackBlocked: props.onPlatformBackBlocked }),
    ...(props.onPlatformBackError === undefined
      ? {}
      : { onPlatformBackError: props.onPlatformBackError }),
    ...(props.onUpdate === undefined ? {} : { onUpdate: props.onUpdate }),
    ...(props.renderHeader === undefined
      ? {}
      : { renderHeader: props.renderHeader }),
    children: (entry, index, isFocused) =>
      createComponent(TanStackNativeStackScreen, {
        states,
        readLiveState,
        entry,
        index,
        isFocused,
        scrollRestoration,
        isRouteTreeMounted: () => {
          const limit = mountedRouteTreeLimit();
          const liveIndex = tanStackLocationIndex(readLiveState());
          const activeIndex = liveIndex ?? props.history.snapshot.index;
          return limit === undefined || activeIndex - index() < limit;
        },
        renderUnresolved: props.renderUnresolved,
        renderParked: props.renderParked,
      }),
  });
}
