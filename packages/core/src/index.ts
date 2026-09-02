import type {
  HostValue,
  NativeComponentDescriptor,
  NativeMeasurement,
} from "@solid-native/host-contract";
import {
  compareNativeNodeOrder,
  createElement,
  createCausalPlatformEventHandler,
  retainCausalNativeEvent,
  retainCausalPlatformEvent,
  effect,
  flushNativeNodeMount,
  insert,
  nativeNodeRoot,
  nativeNodePlatform,
  releaseDetachedNativeNode,
  spread,
  type NativeEventHandler,
  type NativeCausalPlatformEventOptions,
  type NativeNode,
  type NativeSyntheticEvent,
} from "@solid-native/renderer";
import {
  createComponent as solidCreateComponent,
  createContext,
  createMemo,
  createSignal,
  getOwner,
  mapArray,
  onCleanup,
  untrack,
  useContext,
  type Accessor,
  type Component,
  type Element as SolidElement,
} from "solid-js";

export {
  CausalOwner,
  CausalComputation,
  createCausalPlatformEventHandler,
  createCausalScope,
  retainCausalNativeEvent,
  retainCausalPlatformEvent,
  type CausalComputationProps,
  type NativeCausalComputation,
  type NativeCausalComputationState,
  type NativeCausalEventRetention,
  type NativeCausalEventRetentionState,
  type NativeCausalPlatformEventOptions,
  type CausalOwnerProps,
  type NativeCausalOwner,
  type NativeCausalOwnerState,
  type NativeCausalScope,
  type NativeCausalScopeState,
  type NativeCausalRetainedResult,
} from "@solid-native/renderer";

export type NativeComponent<Props> = (props: Props) => NativeNode;
export type NativeRef = (node: NativeNode) => void;
export type NativeStyle = Readonly<Record<string, HostValue | undefined>>;
export type StyleProp =
  NativeStyle | false | null | undefined | readonly StyleProp[];

export interface StyleSheetStatic {
  /** Returns the named styles unchanged so references remain stable. */
  create<const Styles extends Readonly<Record<string, NativeStyle>>>(
    styles: Styles,
  ): Styles;
  /** Combines two styles without allocating when either side is nullish. */
  compose(first: StyleProp, second: StyleProp): StyleProp;
  /** Resolves nested style arrays from left to right. */
  flatten(style: StyleProp): NativeStyle | undefined;
  readonly absoluteFill: NativeStyle;
  readonly absoluteFillObject: NativeStyle;
}

const ABSOLUTE_FILL_STYLE: NativeStyle = Object.freeze({
  bottom: 0,
  left: 0,
  position: "absolute",
  right: 0,
  top: 0,
});

function createNamedStyles<
  const Styles extends Readonly<Record<string, NativeStyle>>,
>(styles: Styles): Styles {
  return styles;
}

function composeStyles(first: StyleProp, second: StyleProp): StyleProp {
  if (first === null || first === undefined) return second;
  if (second === null || second === undefined) return first;
  return [first, second];
}

function isStyleArray(style: StyleProp): style is readonly StyleProp[] {
  return Array.isArray(style);
}

function appendFlattenedStyle(
  style: StyleProp,
  target: Record<string, HostValue | undefined>,
  ancestors: Set<readonly StyleProp[]>,
): void {
  if (style === null || style === undefined || style === false) return;
  if (isStyleArray(style)) {
    if (ancestors.has(style)) {
      throw new TypeError("Native style arrays must not be circular.");
    }
    ancestors.add(style);
    for (const entry of style) appendFlattenedStyle(entry, target, ancestors);
    ancestors.delete(style);
    return;
  }
  if (typeof style !== "object") {
    throw new TypeError("Native style values must be objects or arrays.");
  }
  Object.assign(target, style);
}

function flattenStyles(style: StyleProp): NativeStyle | undefined {
  if (style === null || style === undefined || style === false)
    return undefined;
  if (!isStyleArray(style)) return style;
  const flattened: Record<string, HostValue | undefined> = {};
  appendFlattenedStyle(style, flattened, new Set());
  return flattened;
}

/**
 * Backend-neutral style helpers. They operate on the same plain style values
 * consumed by the Solid Native renderer and never load React Native's facade.
 */
export const StyleSheet: StyleSheetStatic = Object.freeze({
  absoluteFill: ABSOLUTE_FILL_STYLE,
  absoluteFillObject: ABSOLUTE_FILL_STYLE,
  compose: composeStyles,
  create: createNamedStyles,
  flatten: flattenStyles,
});

export type AppStateStatus =
  "active" | "background" | "extension" | "inactive" | "unknown";

export interface AppStateSource {
  readonly initialAppState: AppStateStatus;
  subscribeAppState(listener: (state: AppStateStatus) => void): {
    remove(): void;
  };
}

export interface MemoryWarningSource {
  subscribeMemoryWarning(listener: () => void): {
    remove(): void;
  };
}

export interface KeyboardMetrics {
  readonly screenX: number;
  readonly screenY: number;
  readonly width: number;
  readonly height: number;
}

export type KeyboardState =
  | {
      readonly visible: false;
      readonly metrics?: undefined;
    }
  | {
      readonly visible: true;
      readonly metrics: KeyboardMetrics;
    };

export interface KeyboardSource {
  dismissKeyboard(): void;
  getKeyboardState(): KeyboardState;
  subscribeKeyboard(listener: (state: KeyboardState) => void): {
    remove(): void;
  };
}

export interface KeyboardController {
  readonly visible: Accessor<boolean>;
  readonly metrics: Accessor<KeyboardMetrics | undefined>;
  dismiss(): void;
}

export interface WindowMetrics {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly fontScale: number;
}

export interface WindowMetricsSource {
  getWindowMetrics(): WindowMetrics;
  subscribeWindowMetrics(listener: (metrics: WindowMetrics) => void): {
    remove(): void;
  };
}

export interface WindowDimensions {
  readonly width: Accessor<number>;
  readonly height: Accessor<number>;
  readonly scale: Accessor<number>;
  readonly fontScale: Accessor<number>;
}

export type ColorScheme = "light" | "dark";

export interface ColorSchemeSource {
  getColorScheme(): ColorScheme;
  subscribeColorScheme(listener: (scheme: ColorScheme) => void): {
    remove(): void;
  };
}

export type StatusBarStyle =
  "default" | "auto" | "light-content" | "dark-content";
export type StatusBarAnimation = "none" | "fade" | "slide";

export interface StatusBarConfiguration {
  readonly animated?: boolean;
  readonly barStyle?: StatusBarStyle;
  readonly hidden?: boolean;
  readonly showHideTransition?: StatusBarAnimation;
}

export interface StatusBarStackEntry {
  replace(configuration: StatusBarConfiguration): void;
  remove(): void;
}

export interface StatusBarSource {
  pushStatusBarEntry(
    configuration: StatusBarConfiguration,
  ): StatusBarStackEntry;
}

export interface StatusBarProps extends StatusBarConfiguration {
  readonly source: StatusBarSource;
}

export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface SafeAreaFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SafeAreaMetrics {
  readonly insets: SafeAreaInsets;
  readonly frame: SafeAreaFrame;
}

export interface SafeAreaInsetAccessors {
  readonly top: Accessor<number>;
  readonly right: Accessor<number>;
  readonly bottom: Accessor<number>;
  readonly left: Accessor<number>;
}

export interface SafeAreaFrameAccessors {
  readonly x: Accessor<number>;
  readonly y: Accessor<number>;
  readonly width: Accessor<number>;
  readonly height: Accessor<number>;
}

export type SafeAreaEdge = "top" | "right" | "bottom" | "left";
export type SafeAreaEdgeMode = "off" | "additive" | "maximum";
export type SafeAreaEdges =
  | readonly SafeAreaEdge[]
  | Readonly<Partial<Record<SafeAreaEdge, SafeAreaEdgeMode>>>;

export interface SafeAreaProviderProps extends Omit<ViewProps, "children"> {
  readonly children?: SolidElement;
  readonly initialMetrics?: SafeAreaMetrics;
  readonly onMetricsChange?: (metrics: SafeAreaMetrics) => unknown;
}

export interface SafeAreaViewProps extends ViewProps {
  readonly edges?: SafeAreaEdges;
  readonly mode?: "padding" | "margin";
}

export interface KeyboardAvoidanceFrame {
  readonly pageX: number;
  readonly pageY: number;
  readonly width: number;
  readonly height: number;
}

export interface KeyboardAvoidingViewProps extends Omit<
  ViewProps,
  "children" | "onLayout" | "ref"
> {
  readonly keyboard: KeyboardController;
  readonly children?: unknown;
  /** Moves the effective keyboard top upward by this finite screen-space offset. */
  readonly keyboardVerticalOffset?: number;
  readonly onLayout?: NativeLayoutEventHandler;
  readonly ref?: NativeRef;
  /** Receives distinct applied bottom-spacer extents. */
  readonly onAvoidanceChange?: (inset: number) => unknown;
  /** Receives measurement and callback failures without breaking native delivery. */
  readonly onMeasurementError?: (error: unknown) => unknown;
}

export interface FocusedFieldScrollOptions {
  /** Additional space retained between the focused field and keyboard. */
  readonly extraScrollHeight?: number;
  /** Moves the effective keyboard top upward in screen coordinates. */
  readonly keyboardVerticalOffset?: number;
}

export interface KeyboardAwareScrollViewProps extends Omit<
  ScrollViewProps,
  "children" | "horizontal" | "onScroll" | "ref"
> {
  readonly keyboard: KeyboardController;
  readonly children?: unknown;
  readonly ref?: (handle: ScrollViewHandle) => void;
  readonly onScroll?: NativeEventHandler;
  /** Whether automatic focused-field commands animate. Defaults to true. */
  readonly animated?: boolean;
  /** Additional non-negative space retained above the keyboard. */
  readonly extraScrollHeight?: number;
  readonly keyboardVerticalOffset?: number;
  /** Receives distinct automatic vertical scroll destinations. */
  readonly onFocusedFieldScroll?: (offset: number) => unknown;
  /** Receives measurement, command, and callback failures. */
  readonly onVisibilityError?: (error: unknown) => unknown;
}

function finiteKeyboardCoordinate(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Keyboard avoidance ${name} must be finite.`);
  }
  return value;
}

function keyboardAvoidanceFrame(
  frame: KeyboardAvoidanceFrame,
): KeyboardAvoidanceFrame {
  if (typeof frame !== "object" || frame === null || Array.isArray(frame)) {
    throw new TypeError("Keyboard avoidance frame must be an object.");
  }
  const width = finiteKeyboardCoordinate(frame.width, "frame.width");
  const height = finiteKeyboardCoordinate(frame.height, "frame.height");
  if (width < 0 || height < 0) {
    throw new RangeError(
      "Keyboard avoidance frame width and height must be non-negative.",
    );
  }
  return {
    pageX: finiteKeyboardCoordinate(frame.pageX, "frame.pageX"),
    pageY: finiteKeyboardCoordinate(frame.pageY, "frame.pageY"),
    width,
    height,
  };
}

function keyboardAvoidanceMetrics(metrics: KeyboardMetrics): KeyboardMetrics {
  if (
    typeof metrics !== "object" ||
    metrics === null ||
    Array.isArray(metrics)
  ) {
    throw new TypeError("Keyboard avoidance metrics must be an object.");
  }
  const width = finiteKeyboardCoordinate(metrics.width, "metrics.width");
  const height = finiteKeyboardCoordinate(metrics.height, "metrics.height");
  if (width < 0 || height < 0) {
    throw new RangeError(
      "Keyboard avoidance metric width and height must be non-negative.",
    );
  }
  return {
    screenX: finiteKeyboardCoordinate(metrics.screenX, "metrics.screenX"),
    screenY: finiteKeyboardCoordinate(metrics.screenY, "metrics.screenY"),
    width,
    height,
  };
}

/**
 * Computes the screen-space vertical intersection between one mounted view and
 * the software keyboard. A horizontally disjoint floating keyboard contributes
 * no inset.
 */
export function calculateKeyboardAvoidanceInset(
  frameValue: KeyboardAvoidanceFrame,
  metrics: KeyboardMetrics,
  keyboardVerticalOffset = 0,
): number {
  const frame = keyboardAvoidanceFrame(frameValue);
  const keyboard = keyboardAvoidanceMetrics(metrics);
  const offset = finiteKeyboardCoordinate(
    keyboardVerticalOffset,
    "keyboardVerticalOffset",
  );
  const keyboardLeft = keyboard.screenX;
  const keyboardScreenY = keyboard.screenY;
  const keyboardTop = keyboardScreenY - offset;
  const keyboardWidth = keyboard.width;
  const keyboardHeight = keyboard.height;
  const horizontalIntersection =
    Math.min(frame.pageX + frame.width, keyboardLeft + keyboardWidth) -
    Math.max(frame.pageX, keyboardLeft);
  if (
    horizontalIntersection <= 0 ||
    frame.height === 0 ||
    keyboardHeight === 0
  ) {
    return 0;
  }
  const keyboardBottom = keyboardScreenY + keyboardHeight;
  const intersection =
    Math.min(frame.pageY + frame.height, keyboardBottom) -
    Math.max(frame.pageY, keyboardTop);
  return Math.max(0, Math.min(frame.height, intersection));
}

/**
 * Computes an absolute vertical ScrollView destination that keeps one focused
 * field inside the viewport not covered by the software keyboard.
 */
export function calculateFocusedFieldScrollOffset(
  scrollFrameValue: KeyboardAvoidanceFrame,
  fieldFrameValue: KeyboardAvoidanceFrame,
  currentScrollOffsetValue: number,
  metricsValue: KeyboardMetrics,
  options: FocusedFieldScrollOptions = {},
): number {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError("Focused-field scroll options must be an object.");
  }
  const scrollFrame = keyboardAvoidanceFrame(scrollFrameValue);
  const fieldFrame = keyboardAvoidanceFrame(fieldFrameValue);
  const keyboard = keyboardAvoidanceMetrics(metricsValue);
  const currentScrollOffset = finiteKeyboardCoordinate(
    currentScrollOffsetValue,
    "currentScrollOffset",
  );
  const keyboardVerticalOffset = finiteKeyboardCoordinate(
    options.keyboardVerticalOffset ?? 0,
    "keyboardVerticalOffset",
  );
  const extraScrollHeight = finiteKeyboardCoordinate(
    options.extraScrollHeight ?? 0,
    "extraScrollHeight",
  );
  if (currentScrollOffset < 0 || extraScrollHeight < 0) {
    throw new RangeError(
      "Focused-field scroll offset and extraScrollHeight must be non-negative.",
    );
  }

  const scrollTop = scrollFrame.pageY;
  const scrollBottom = scrollTop + scrollFrame.height;
  const scrollRight = scrollFrame.pageX + scrollFrame.width;
  const keyboardTop = keyboard.screenY - keyboardVerticalOffset;
  const keyboardBottom = keyboard.screenY + keyboard.height;
  const keyboardRight = keyboard.screenX + keyboard.width;
  const fieldTop = fieldFrame.pageY;
  const fieldBottom = fieldTop + fieldFrame.height;
  const fieldRight = fieldFrame.pageX + fieldFrame.width;
  const fieldHeightWithClearance = fieldFrame.height + extraScrollHeight;
  const fieldBottomWithClearance = fieldBottom + extraScrollHeight;
  if (
    !Number.isFinite(scrollBottom) ||
    !Number.isFinite(scrollRight) ||
    !Number.isFinite(keyboardTop) ||
    !Number.isFinite(keyboardBottom) ||
    !Number.isFinite(keyboardRight) ||
    !Number.isFinite(fieldBottom) ||
    !Number.isFinite(fieldRight) ||
    !Number.isFinite(fieldHeightWithClearance) ||
    !Number.isFinite(fieldBottomWithClearance)
  ) {
    throw new RangeError(
      "Focused-field geometry must produce finite screen-space extents.",
    );
  }
  const horizontalIntersection =
    Math.min(fieldRight, keyboardRight) -
    Math.max(fieldFrame.pageX, keyboard.screenX);
  const keyboardCoversViewport =
    horizontalIntersection > 0 &&
    keyboard.height > 0 &&
    keyboardBottom > scrollTop &&
    keyboardTop < scrollBottom;
  const visibleBottom = keyboardCoversViewport
    ? Math.max(scrollTop, Math.min(scrollBottom, keyboardTop))
    : scrollBottom;
  if (visibleBottom <= scrollTop) return currentScrollOffset;
  if (fieldTop < scrollTop) {
    return Math.max(0, currentScrollOffset - (scrollTop - fieldTop));
  }
  const visibleHeight = visibleBottom - scrollTop;
  if (fieldHeightWithClearance > visibleHeight) {
    const destination = currentScrollOffset + Math.max(0, fieldTop - scrollTop);
    if (!Number.isFinite(destination)) {
      throw new RangeError(
        "Focused-field geometry produced a non-finite scroll destination.",
      );
    }
    return destination;
  }
  if (fieldBottomWithClearance > visibleBottom) {
    const destination =
      currentScrollOffset + fieldBottomWithClearance - visibleBottom;
    if (!Number.isFinite(destination)) {
      throw new RangeError(
        "Focused-field geometry produced a non-finite scroll destination.",
      );
    }
    return destination;
  }
  return currentScrollOffset;
}

function reportKeyboardAvoidanceError(
  error: unknown,
  onError: KeyboardAvoidingViewProps["onMeasurementError"],
): void {
  try {
    const reported = onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Diagnostics cannot break layout delivery or owner disposal.
  }
}

function sameKeyboardState(left: KeyboardState, right: KeyboardState): boolean {
  if (left.visible !== right.visible) return false;
  if (!left.visible || !right.visible) return true;
  return (
    left.metrics.screenX === right.metrics.screenX &&
    left.metrics.screenY === right.metrics.screenY &&
    left.metrics.width === right.metrics.width &&
    left.metrics.height === right.metrics.height
  );
}

function sameWindowMetrics(left: WindowMetrics, right: WindowMetrics): boolean {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.scale === right.scale &&
    left.fontScale === right.fontScale
  );
}

/**
 * Projects normalized software-keyboard visibility into fine-grained Solid
 * accessors. Native delivery and subscription cleanup belong to the current
 * owner; event payloads are not copied into causal telemetry.
 */
export function createKeyboard(source: KeyboardSource): KeyboardController {
  const [state, setState] = createSignal(source.getKeyboardState(), {
    equals: sameKeyboardState,
  });
  const subscription = source.subscribeKeyboard(
    createCausalPlatformEventHandler("platform.keyboard.visibility", setState),
  );
  onCleanup(() => subscription.remove());
  return Object.freeze({
    visible: createMemo(() => state().visible),
    metrics: createMemo(() => state().metrics),
    dismiss() {
      source.dismissKeyboard();
    },
  });
}

/**
 * Projects the current application window into independently tracked Solid
 * accessors. Rotation, resizing, and foldable-window changes retain their
 * native causal boundary and the subscription follows the current owner.
 */
export function createWindowDimensions(
  source: WindowMetricsSource,
): WindowDimensions {
  const [metrics, setMetrics] = createSignal(source.getWindowMetrics(), {
    equals: sameWindowMetrics,
  });
  const subscription = source.subscribeWindowMetrics(
    createCausalPlatformEventHandler("platform.window.dimensions", setMetrics),
  );
  onCleanup(() => subscription.remove());
  return Object.freeze({
    width: createMemo(() => metrics().width),
    height: createMemo(() => metrics().height),
    scale: createMemo(() => metrics().scale),
    fontScale: createMemo(() => metrics().fontScale),
  });
}

/**
 * Projects the platform appearance into one Solid accessor. Native changes are
 * privacy-safe causal inputs and the subscription belongs to the current
 * owner.
 */
export function createColorScheme(
  source: ColorSchemeSource,
): Accessor<ColorScheme> {
  const [scheme, setScheme] = createSignal(source.getColorScheme());
  const subscription = source.subscribeColorScheme(
    createCausalPlatformEventHandler("platform.appearance.change", setScheme),
  );
  onCleanup(() => subscription.remove());
  return scheme;
}

function createStatusBar(props: StatusBarProps): SolidElement {
  let currentSource: StatusBarSource | undefined;
  let entry: StatusBarStackEntry | undefined;
  effect(
    () => ({
      configuration: {
        ...(props.animated === undefined ? {} : { animated: props.animated }),
        ...(props.barStyle === undefined ? {} : { barStyle: props.barStyle }),
        ...(props.hidden === undefined ? {} : { hidden: props.hidden }),
        ...(props.showHideTransition === undefined
          ? {}
          : { showHideTransition: props.showHideTransition }),
      },
      source: props.source,
    }),
    ({ configuration, source }) => {
      if (source !== currentSource) {
        entry?.remove();
        entry = undefined;
        currentSource = undefined;
        entry = source.pushStatusBarEntry(configuration);
        currentSource = source;
        return;
      }
      entry?.replace(configuration);
    },
  );
  onCleanup(() => {
    const activeEntry = entry;
    entry = undefined;
    currentSource = undefined;
    activeEntry?.remove();
  });
  return null;
}

interface SafeAreaContextValue {
  readonly insets: SafeAreaInsetAccessors;
  readonly frame: SafeAreaFrameAccessors;
}

const SafeAreaMetricsContext = createContext<SafeAreaContextValue | null>(null);
const SafeAreaMetricsProvider = SafeAreaMetricsContext as Component<{
  readonly value: SafeAreaContextValue;
  readonly children?: SolidElement;
}>;

function finiteSafeAreaNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function safeAreaRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function normalizeSafeAreaMetrics(
  value: unknown,
  path: string,
): SafeAreaMetrics {
  const metrics = safeAreaRecord(value, path);
  const insetsValue = safeAreaRecord(metrics.insets, `${path}.insets`);
  const frameValue = safeAreaRecord(metrics.frame, `${path}.frame`);
  const insets = Object.freeze({
    top: finiteSafeAreaNumber(insetsValue.top, `${path}.insets.top`),
    right: finiteSafeAreaNumber(insetsValue.right, `${path}.insets.right`),
    bottom: finiteSafeAreaNumber(insetsValue.bottom, `${path}.insets.bottom`),
    left: finiteSafeAreaNumber(insetsValue.left, `${path}.insets.left`),
  });
  if (
    insets.top < 0 ||
    insets.right < 0 ||
    insets.bottom < 0 ||
    insets.left < 0
  ) {
    throw new RangeError(`${path}.insets must be non-negative.`);
  }
  const frame = Object.freeze({
    x: finiteSafeAreaNumber(frameValue.x, `${path}.frame.x`),
    y: finiteSafeAreaNumber(frameValue.y, `${path}.frame.y`),
    width: finiteSafeAreaNumber(frameValue.width, `${path}.frame.width`),
    height: finiteSafeAreaNumber(frameValue.height, `${path}.frame.height`),
  });
  if (frame.width < 0 || frame.height < 0) {
    throw new RangeError(
      `${path}.frame width and height must be non-negative.`,
    );
  }
  return Object.freeze({ insets, frame });
}

function sameSafeAreaMetrics(
  left: SafeAreaMetrics | undefined,
  right: SafeAreaMetrics | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.insets.top === right.insets.top &&
    left.insets.right === right.insets.right &&
    left.insets.bottom === right.insets.bottom &&
    left.insets.left === right.insets.left &&
    left.frame.x === right.frame.x &&
    left.frame.y === right.frame.y &&
    left.frame.width === right.frame.width &&
    left.frame.height === right.frame.height
  );
}

const SAFE_AREA_PROVIDER_BASE_STYLE: NativeStyle = { flex: 1 };

function createSafeAreaContextValue(
  metrics: Accessor<SafeAreaMetrics | undefined>,
): SafeAreaContextValue {
  const requireMetrics = (): SafeAreaMetrics => {
    const value = metrics();
    if (value === undefined) {
      throw new Error("Safe-area metrics are not available yet.");
    }
    return value;
  };
  return Object.freeze({
    insets: Object.freeze({
      top: createMemo(() => requireMetrics().insets.top),
      right: createMemo(() => requireMetrics().insets.right),
      bottom: createMemo(() => requireMetrics().insets.bottom),
      left: createMemo(() => requireMetrics().insets.left),
    }),
    frame: Object.freeze({
      x: createMemo(() => requireMetrics().frame.x),
      y: createMemo(() => requireMetrics().frame.y),
      width: createMemo(() => requireMetrics().frame.width),
      height: createMemo(() => requireMetrics().frame.height),
    }),
  });
}

/**
 * Owns native safe-area delivery and makes its children available once the
 * first metrics are known. Supply server/bootstrap metrics to render children
 * in the initial native transaction.
 */
export function SafeAreaProvider(props: SafeAreaProviderProps): SolidElement {
  const initialMetrics =
    props.initialMetrics === undefined
      ? undefined
      : normalizeSafeAreaMetrics(
          props.initialMetrics,
          "SafeAreaProvider.initialMetrics",
        );
  const [metrics, setMetrics] = createSignal<SafeAreaMetrics | undefined>(
    initialMetrics,
    { equals: sameSafeAreaMetrics },
  );
  const context = createSafeAreaContextValue(metrics);
  const provider = createElement("RNCSafeAreaProvider");
  const handleInsetsChange: NativeEventHandler = (event) => {
    const next = normalizeSafeAreaMetrics(
      event.payload,
      "native safe-area event",
    );
    setMetrics(next);
    return props.onMetricsChange?.(next);
  };
  const translatedProperties = new Set<string | symbol>([
    "children",
    "initialMetrics",
    "onMetricsChange",
    "style",
  ]);
  const nativeProperties = new Set<string | symbol>([
    "onInsetsChange",
    "style",
  ]);
  const nativeProps = new Proxy({} as NativeElementProps, {
    get(_target, property) {
      if (property === "onInsetsChange") return handleInsetsChange;
      if (property === "style") {
        return [SAFE_AREA_PROVIDER_BASE_STYLE, props.style] satisfies StyleProp;
      }
      if (translatedProperties.has(property)) return undefined;
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      if (translatedProperties.has(property)) return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !translatedProperties.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
  spread(provider, nativeProps);
  return solidCreateComponent(SafeAreaMetricsProvider, {
    value: context,
    get children() {
      insert(provider, () =>
        metrics() === undefined ? undefined : props.children,
      );
      return provider;
    },
  });
}

const SAFE_AREA_EDGES = ["top", "right", "bottom", "left"] as const;

function isSafeAreaEdgeArray(
  value: SafeAreaEdges,
): value is readonly SafeAreaEdge[] {
  return Array.isArray(value);
}

function normalizeSafeAreaEdges(
  value: SafeAreaEdges | undefined,
): Readonly<Record<SafeAreaEdge, SafeAreaEdgeMode>> {
  const result: Record<SafeAreaEdge, SafeAreaEdgeMode> = {
    top: "off",
    right: "off",
    bottom: "off",
    left: "off",
  };
  if (value === undefined) {
    for (const edge of SAFE_AREA_EDGES) result[edge] = "additive";
    return Object.freeze(result);
  }
  if (isSafeAreaEdgeArray(value)) {
    for (const edge of value) {
      if (!SAFE_AREA_EDGES.includes(edge)) {
        throw new TypeError(`Unknown safe-area edge: ${String(edge)}.`);
      }
      result[edge] = "additive";
    }
    return Object.freeze(result);
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError("SafeAreaView edges must be an array or object.");
  }
  const edgeRecord = value as Readonly<
    Partial<Record<SafeAreaEdge, SafeAreaEdgeMode>>
  >;
  for (const edge of SAFE_AREA_EDGES) {
    const mode = edgeRecord[edge];
    if (mode === undefined) continue;
    if (mode !== "off" && mode !== "additive" && mode !== "maximum") {
      throw new TypeError(
        `SafeAreaView edge ${edge} has an unsupported mode: ${String(mode)}.`,
      );
    }
    result[edge] = mode;
  }
  return Object.freeze(result);
}

function createSafeAreaView(props: SafeAreaViewProps): NativeNode {
  const view = createElement("RNCSafeAreaView");
  const edges = createMemo(() => normalizeSafeAreaEdges(props.edges));
  const mode = createMemo(() => {
    const value = props.mode ?? "padding";
    if (value !== "padding" && value !== "margin") {
      throw new TypeError(`Unsupported SafeAreaView mode: ${String(value)}.`);
    }
    return value;
  });
  const nativeProps = new Proxy(props, {
    get(target, property, receiver) {
      if (property === "edges") return edges();
      if (property === "mode") return mode();
      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === "edges" || property === "mode") {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      if (!keys.includes("edges")) keys.push("edges");
      if (!keys.includes("mode")) keys.push("mode");
      return keys;
    },
  });
  spread(view, nativeProps);
  return view;
}

/** Returns fine-grained inset accessors from the nearest SafeAreaProvider. */
export function useSafeAreaInsets(): SafeAreaInsetAccessors {
  const context = useContext(SafeAreaMetricsContext);
  if (context === null) {
    throw new Error(
      "Safe-area insets require a parent Solid Native SafeAreaProvider.",
    );
  }
  return context.insets;
}

/** Returns fine-grained safe frame accessors from the nearest provider. */
export function useSafeAreaFrame(): SafeAreaFrameAccessors {
  const context = useContext(SafeAreaMetricsContext);
  if (context === null) {
    throw new Error(
      "Safe-area frame requires a parent Solid Native SafeAreaProvider.",
    );
  }
  return context.frame;
}

/**
 * Exposes native application lifecycle as a fine-grained Solid accessor. The
 * native subscription is released with the current Solid owner.
 */
export function createAppState(
  source: AppStateSource,
): Accessor<AppStateStatus> {
  const [state, setState] = createSignal(source.initialAppState);
  const subscription = source.subscribeAppState(
    createCausalPlatformEventHandler("platform.app-state.change", setState),
  );
  onCleanup(() => subscription.remove());
  return state;
}

/**
 * Returns a monotonic count of platform memory warnings. The native
 * subscription and its causal delivery belong to the current Solid owner.
 */
export function createMemoryWarningCount(
  source: MemoryWarningSource,
): Accessor<number> {
  const [count, setCount] = createSignal(0);
  const subscription = source.subscribeMemoryWarning(
    createCausalPlatformEventHandler("platform.memory-warning", () => {
      setCount((current) =>
        current === Number.MAX_SAFE_INTEGER ? current : current + 1,
      );
    }),
  );
  onCleanup(() => subscription.remove());
  return count;
}

export interface NativeEventSubscription {
  remove(): void;
}

/** Structural match for a generated Codegen `EventEmitter<T>` member. */
export type NativeEventEmitter<T> = (
  listener: (event: T) => void,
) => NativeEventSubscription;

export interface NativeEventAccessorOptions<
  TNative,
  TValue,
> extends NativeCausalPlatformEventOptions {
  /** Privacy-safe bounded causal name; native payloads are never recorded. */
  readonly name: string;
  /** Validates and projects the raw native ABI value into application data. */
  readonly decode: (event: TNative) => TValue;
  readonly initialValue?: TValue;
  /** Receives decoder and cleanup failures without breaking native delivery. */
  readonly onError?: (error: unknown) => unknown;
}

function reportNativeEventAccessorError(
  error: unknown,
  onError: NativeEventAccessorOptions<unknown, unknown>["onError"],
): void {
  try {
    const reported = onError?.(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // Diagnostics cannot break native delivery or owner disposal.
  }
}

/**
 * Converts one generated TurboModule event emitter into a fine-grained Solid
 * accessor. The decoder remains an explicit native-data boundary, delivery is
 * causally attributed, and the subscription belongs to the current owner.
 */
export function createNativeEventAccessor<TNative, TValue>(
  emitter: NativeEventEmitter<TNative>,
  options: NativeEventAccessorOptions<TNative, TValue>,
): Accessor<TValue | undefined> {
  if (typeof emitter !== "function") {
    throw new TypeError("Native event emitter must be a function.");
  }
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Native event accessor options must be an object.");
  }
  if (typeof options.decode !== "function") {
    throw new TypeError("Native event accessor decode must be a function.");
  }
  // Box the value so function-valued native payloads remain data instead of
  // selecting Solid's writable-memo overload.
  const [event, setEvent] = createSignal<{
    readonly value: TValue | undefined;
  }>({ value: options.initialValue });
  let active = true;
  const causalListener = createCausalPlatformEventHandler(
    options.name,
    (nativeEvent: TNative) => {
      if (!active) return;
      let decoded: TValue;
      try {
        decoded = options.decode(nativeEvent);
      } catch (error) {
        reportNativeEventAccessorError(error, options.onError);
        return;
      }
      if (active) setEvent({ value: decoded });
    },
    {
      ...(options.priority === undefined ? {} : { priority: options.priority }),
      ...(options.coalescible === undefined
        ? {}
        : { coalescible: options.coalescible }),
    },
  );
  const listener = (nativeEvent: TNative): void => {
    if (active) causalListener(nativeEvent);
  };
  let subscription: NativeEventSubscription;
  try {
    const candidate: unknown = emitter(listener);
    if (
      (typeof candidate !== "object" && typeof candidate !== "function") ||
      candidate === null ||
      !("remove" in candidate) ||
      typeof candidate.remove !== "function"
    ) {
      throw new TypeError(
        "Native event emitter must return a subscription with remove().",
      );
    }
    subscription = candidate as NativeEventSubscription;
  } catch (error) {
    active = false;
    throw error;
  }
  onCleanup(() => {
    active = false;
    try {
      subscription.remove();
    } catch (error) {
      reportNativeEventAccessorError(error, options.onError);
    }
  });
  return () => event().value;
}

export type AccessibilityActionName =
  "activate" | "increment" | "decrement" | "longpress" | "magicTap" | "escape";

export interface AccessibilityActionInfo {
  readonly name: AccessibilityActionName | (string & {});
  readonly label?: string;
}

export interface AccessibilityState {
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly checked?: boolean | "mixed";
  readonly busy?: boolean;
  readonly expanded?: boolean;
}

export interface AccessibilityValue {
  readonly min?: number;
  readonly max?: number;
  readonly now?: number;
  readonly text?: string;
}

export type AccessibilityActionPayload = {
  readonly [key: string]: HostValue;
  readonly actionName: string;
};

export type AccessibilityActionEvent =
  NativeSyntheticEvent<AccessibilityActionPayload>;
export type AccessibilityActionEventHandler = (
  event: AccessibilityActionEvent,
) => unknown;

export type AccessibilityRole =
  | "none"
  | "button"
  | "dropdownlist"
  | "togglebutton"
  | "link"
  | "search"
  | "image"
  | "keyboardkey"
  | "text"
  | "adjustable"
  | "imagebutton"
  | "header"
  | "summary"
  | "alert"
  | "checkbox"
  | "combobox"
  | "menu"
  | "menubar"
  | "menuitem"
  | "progressbar"
  | "radio"
  | "radiogroup"
  | "scrollbar"
  | "spinbutton"
  | "switch"
  | "tab"
  | "tabbar"
  | "tablist"
  | "timer"
  | "list"
  | "toolbar"
  | "grid"
  | "pager"
  | "scrollview"
  | "horizontalscrollview"
  | "viewgroup"
  | "webview"
  | "drawerlayout"
  | "slidingdrawer"
  | "iconmenu";

export interface AccessibilityProps {
  readonly accessible?: boolean;
  readonly accessibilityActions?: readonly AccessibilityActionInfo[];
  readonly accessibilityElementsHidden?: boolean;
  readonly accessibilityLabel?: string;
  readonly accessibilityLabelledBy?: string | readonly string[];
  readonly accessibilityHint?: string;
  readonly accessibilityIgnoresInvertColors?: boolean;
  readonly accessibilityLanguage?: string;
  readonly accessibilityLargeContentTitle?: string;
  readonly accessibilityLiveRegion?: "none" | "polite" | "assertive";
  readonly accessibilityRespondsToUserInteraction?: boolean;
  readonly accessibilityRole?: AccessibilityRole;
  readonly accessibilityShowsLargeContentViewer?: boolean;
  readonly accessibilityState?: Readonly<AccessibilityState>;
  readonly accessibilityValue?: Readonly<AccessibilityValue>;
  readonly accessibilityViewIsModal?: boolean;
  readonly importantForAccessibility?:
    "auto" | "yes" | "no" | "no-hide-descendants";
  readonly onAccessibilityAction?: AccessibilityActionEventHandler;
  readonly onAccessibilityEscape?: NativeEventHandler;
  readonly onAccessibilityTap?: NativeEventHandler;
  readonly onMagicTap?: NativeEventHandler;
  readonly role?: AccessibilityRole;
  readonly screenReaderFocusable?: boolean;
}

export type NativeLayoutRectangle = {
  readonly [key: string]: HostValue;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type NativeLayoutChangePayload = {
  readonly [key: string]: HostValue;
  readonly layout: NativeLayoutRectangle;
};

export type NativeLayoutChangeEvent =
  NativeSyntheticEvent<NativeLayoutChangePayload>;
export type NativeLayoutEventHandler = (
  event: NativeLayoutChangeEvent,
) => unknown;

export interface NativeElementProps extends AccessibilityProps {
  readonly children?: unknown;
  readonly ref?: NativeRef;
  readonly style?: StyleProp;
  readonly testID?: string;
  readonly nativeID?: string;
  readonly hidden?: boolean;
}

export interface ViewProps extends NativeElementProps {
  readonly pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  readonly collapsable?: boolean;
  readonly onLayout?: NativeLayoutEventHandler;
}

export interface TextProps extends NativeElementProps {
  readonly selectable?: boolean;
  readonly numberOfLines?: number;
  readonly ellipsizeMode?: "head" | "middle" | "tail" | "clip";
  readonly onPress?: NativeEventHandler;
}

export interface ImageURISource {
  readonly uri: string;
  readonly width?: number;
  readonly height?: number;
  readonly scale?: number;
}

export type ImageSource = string | Readonly<ImageURISource>;

export interface ImageProps extends Omit<NativeElementProps, "children"> {
  readonly source: ImageSource;
  readonly resizeMode?: "cover" | "contain" | "stretch" | "center" | "repeat";
  readonly onLoad?: NativeEventHandler;
  readonly onError?: NativeEventHandler;
}

export interface PressableState {
  readonly pressed: boolean;
}

export interface PressableInsets {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

export interface PressableAndroidRippleConfig {
  readonly color?: string;
  readonly borderless?: boolean;
  readonly radius?: number;
  readonly foreground?: boolean;
  readonly alpha?: number;
}

export interface PressableProps extends Omit<ViewProps, "children" | "style"> {
  readonly children?: SolidElement | ((state: PressableState) => SolidElement);
  readonly android_ripple?: Readonly<PressableAndroidRippleConfig>;
  readonly delayHoverIn?: number;
  readonly delayHoverOut?: number;
  readonly disabled?: boolean;
  readonly delayLongPress?: number;
  readonly focusable?: boolean;
  readonly hitSlop?: number | Readonly<PressableInsets>;
  readonly onLayout?: NativeLayoutEventHandler;
  readonly onBlur?: NativeEventHandler;
  readonly onFocus?: NativeEventHandler;
  readonly onHoverIn?: NativeEventHandler;
  readonly onHoverOut?: NativeEventHandler;
  readonly onPress?: NativeEventHandler;
  readonly onPressIn?: NativeEventHandler;
  readonly onPressMove?: NativeEventHandler;
  readonly onPressOut?: NativeEventHandler;
  readonly onLongPress?: NativeEventHandler;
  readonly pressRetentionOffset?: number | Readonly<PressableInsets>;
  readonly style?: StyleProp | ((state: PressableState) => StyleProp);
  readonly unstable_pressDelay?: number;
}

/**
 * A small platform-native button composed from Solid Native's Pressable and
 * Text facades. `color` follows React Native's familiar contract: it colors
 * the Android button background and the iOS title.
 */
export interface ButtonProps extends Omit<
  PressableProps,
  "accessibilityRole" | "children" | "onPress" | "role" | "style"
> {
  readonly title: string;
  readonly onPress: NonNullable<PressableProps["onPress"]>;
  readonly color?: string;
  readonly style?: PressableProps["style"];
  readonly textStyle?: StyleProp;
}

export interface ScrollViewScrollToOptions {
  /** Horizontal destination in density-independent pixels. Defaults to 0. */
  readonly x?: number;
  /** Vertical destination in density-independent pixels. Defaults to 0. */
  readonly y?: number;
  /** Whether the platform animates to the destination. Defaults to true. */
  readonly animated?: boolean;
}

export interface ScrollViewScrollToEndOptions {
  /** Whether the platform animates to the end. Defaults to true. */
  readonly animated?: boolean;
}

export interface ScrollViewHandle {
  /** The backing Fabric ScrollView for measurement and explicit escape hatches. */
  readonly nativeNode: NativeNode;
  scrollTo(options: ScrollViewScrollToOptions): Promise<void>;
  scrollToEnd(options?: ScrollViewScrollToEndOptions): Promise<void>;
}

export interface ScrollViewProps extends Omit<NativeElementProps, "ref"> {
  /** Receives a stable typed handle whose commands target the backing ScrollView. */
  readonly ref?: (handle: ScrollViewHandle) => void;
  readonly horizontal?: boolean;
  readonly nestedScrollEnabled?: boolean;
  readonly scrollEnabled?: boolean;
  readonly scrollEventThrottle?: number;
  readonly showsHorizontalScrollIndicator?: boolean;
  readonly showsVerticalScrollIndicator?: boolean;
  readonly contentContainerStyle?: StyleProp;
  /** Keeps the first eligible visible child anchored when content is inserted. */
  readonly maintainVisibleContentPosition?: Readonly<ScrollViewMaintainVisibleContentPosition>;
  readonly onScroll?: NativeEventHandler;
  readonly onScrollBeginDrag?: NativeEventHandler;
  readonly onScrollEndDrag?: NativeEventHandler;
}

export interface ScrollViewMaintainVisibleContentPosition {
  readonly minIndexForVisible: number;
  readonly autoscrollToTopThreshold?: number;
}

export interface RefreshableScrollViewProps extends Omit<
  ScrollViewProps,
  "horizontal"
> {
  /** Pull-to-refresh is only supported for vertical scrolling. */
  readonly horizontal?: false;
  /** Controlled native refresh indicator state. */
  readonly refreshing: boolean;
  readonly onRefresh?: () => unknown;
  /** Android refresh gesture availability. Defaults to true. */
  readonly enabled?: boolean;
  /** Android indicator colors. */
  readonly colors?: readonly string[];
  /** Android indicator background color. */
  readonly progressBackgroundColor?: string;
  /** Android indicator size. Defaults to default. */
  readonly size?: "default" | "large";
  /** Native indicator offset from the top of the scroll view. */
  readonly progressViewOffset?: number;
  /** iOS indicator color. */
  readonly tintColor?: string;
  /** iOS text displayed below the indicator. */
  readonly title?: string;
  /** iOS indicator title color. */
  readonly titleColor?: string;
}

export type TextInputChangePayload = {
  readonly [key: string]: HostValue;
  readonly text: string;
  readonly eventCount: number;
};

export type TextInputChangeEvent = NativeSyntheticEvent<TextInputChangePayload>;

export type TextInputChangeHandler = (event: TextInputChangeEvent) => unknown;
export type TextInputChangeTextHandler = (text: string) => unknown;

export type TextInputKeyboardType =
  | "default"
  | "number-pad"
  | "decimal-pad"
  | "numeric"
  | "email-address"
  | "phone-pad"
  | "url"
  | "ascii-capable"
  | "numbers-and-punctuation"
  | "name-phone-pad"
  | "twitter"
  | "web-search"
  | "visible-password";

export type TextInputMode =
  "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";

export type TextInputReturnKeyType =
  | "default"
  | "done"
  | "emergency-call"
  | "go"
  | "google"
  | "join"
  | "next"
  | "none"
  | "previous"
  | "route"
  | "search"
  | "send"
  | "yahoo";

export type TextInputEnterKeyHint =
  "done" | "enter" | "go" | "next" | "previous" | "search" | "send";

export type TextInputAutoComplete =
  | "2fa-app-otp"
  | "additional-name"
  | "address-line1"
  | "address-line2"
  | "birthdate-day"
  | "birthdate-full"
  | "birthdate-month"
  | "birthdate-year"
  | "cc-csc"
  | "cc-exp"
  | "cc-exp-day"
  | "cc-exp-month"
  | "cc-exp-year"
  | "cc-family-name"
  | "cc-given-name"
  | "cc-middle-name"
  | "cc-name"
  | "cc-number"
  | "cc-type"
  | "country"
  | "current-password"
  | "email"
  | "email-otp"
  | "family-name"
  | "flight-confirmation-code"
  | "flight-number"
  | "gender"
  | "gift-card-number"
  | "gift-card-pin"
  | "given-name"
  | "honorific-prefix"
  | "honorific-suffix"
  | "loyalty-account-number"
  | "name"
  | "name-family"
  | "name-given"
  | "name-middle"
  | "name-middle-initial"
  | "name-prefix"
  | "name-suffix"
  | "new-password"
  | "nickname"
  | "off"
  | "one-time-code"
  | "organization"
  | "organization-title"
  | "password"
  | "password-new"
  | "postal-address"
  | "postal-address-country"
  | "postal-address-dependent-locality"
  | "postal-address-extended"
  | "postal-address-extended-postal-code"
  | "postal-address-locality"
  | "postal-address-region"
  | "postal-address-unit"
  | "postal-code"
  | "promo-code"
  | "sms-otp"
  | "street-address"
  | "tel"
  | "tel-country-code"
  | "tel-device"
  | "tel-national"
  | "upi-vpa"
  | "url"
  | "username"
  | "username-new"
  | "wifi-password";

export type TextInputTextContentType =
  | "none"
  | "URL"
  | "addressCity"
  | "addressCityAndState"
  | "addressState"
  | "birthdate"
  | "birthdateDay"
  | "birthdateMonth"
  | "birthdateYear"
  | "cellularEID"
  | "cellularIMEI"
  | "countryName"
  | "creditCardExpiration"
  | "creditCardExpirationMonth"
  | "creditCardExpirationYear"
  | "creditCardFamilyName"
  | "creditCardGivenName"
  | "creditCardMiddleName"
  | "creditCardName"
  | "creditCardNumber"
  | "creditCardSecurityCode"
  | "creditCardType"
  | "dateTime"
  | "emailAddress"
  | "familyName"
  | "flightNumber"
  | "fullStreetAddress"
  | "givenName"
  | "jobTitle"
  | "location"
  | "middleName"
  | "name"
  | "namePrefix"
  | "nameSuffix"
  | "newPassword"
  | "nickname"
  | "oneTimeCode"
  | "organizationName"
  | "password"
  | "postalCode"
  | "shipmentTrackingNumber"
  | "streetAddressLine1"
  | "streetAddressLine2"
  | "sublocality"
  | "telephoneNumber"
  | "username";

export interface TextInputProps extends Omit<NativeElementProps, "children"> {
  readonly value?: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly placeholderTextColor?: string;
  readonly editable?: boolean;
  readonly readOnly?: boolean;
  readonly multiline?: boolean;
  readonly numberOfLines?: number;
  readonly maxLength?: number;
  readonly blurOnSubmit?: boolean;
  readonly submitBehavior?: "submit" | "blurAndSubmit" | "newline";
  readonly secureTextEntry?: boolean;
  readonly allowFontScaling?: boolean;
  readonly autoCapitalize?: "none" | "sentences" | "words" | "characters";
  readonly autoComplete?: TextInputAutoComplete;
  readonly autoCorrect?: boolean;
  readonly autoFocus?: boolean;
  readonly caretHidden?: boolean;
  readonly contextMenuHidden?: boolean;
  readonly cursorColor?: string | null;
  readonly disableFullscreenUI?: boolean;
  readonly enablesReturnKeyAutomatically?: boolean;
  readonly enterKeyHint?: TextInputEnterKeyHint;
  readonly importantForAutofill?:
    "auto" | "no" | "noExcludeDescendants" | "yes" | "yesExcludeDescendants";
  readonly inputMode?: TextInputMode;
  readonly keyboardType?: TextInputKeyboardType;
  readonly keyboardAppearance?: "default" | "light" | "dark";
  readonly maxFontSizeMultiplier?: number | null;
  readonly passwordRules?: string | null;
  readonly returnKeyLabel?: string;
  readonly returnKeyType?: TextInputReturnKeyType;
  readonly scrollEnabled?: boolean;
  readonly selectTextOnFocus?: boolean;
  readonly selectionColor?: string;
  readonly selectionHandleColor?: string | null;
  readonly showSoftInputOnFocus?: boolean;
  readonly smartInsertDelete?: boolean;
  readonly spellCheck?: boolean;
  readonly textAlignVertical?: "auto" | "top" | "bottom" | "center";
  readonly textBreakStrategy?: "simple" | "highQuality" | "balanced";
  readonly textContentType?: TextInputTextContentType;
  readonly underlineColorAndroid?: string;
  /** Opts this field out of automatic next-field focus inside a focus group. */
  readonly focusNextOnSubmit?: boolean;
  readonly selection?: TextInputSelection | undefined;
  /** Receives the validated native event, including its reconciliation count. */
  readonly onChange?: TextInputChangeHandler;
  /** Receives only the current text after native event validation. */
  readonly onChangeText?: TextInputChangeTextHandler;
  readonly onFocus?: NativeEventHandler;
  readonly onBlur?: NativeEventHandler;
  readonly onContentSizeChange?: NativeEventHandler;
  readonly onEndEditing?: NativeEventHandler;
  readonly onKeyPress?: NativeEventHandler;
  readonly onScroll?: NativeEventHandler;
  readonly onSelectionChange?: NativeEventHandler;
  readonly onSubmitEditing?: NativeEventHandler;
}

export interface TextInputFocusGroupProps {
  readonly children?: SolidElement;
  /** Receives focus-command failures without breaking submit delivery. */
  readonly onTraversalError?: (error: unknown) => unknown;
}

export interface TextInputSelection {
  readonly start: number;
  readonly end?: number;
}

export interface ActivityIndicatorProps extends Omit<
  NativeElementProps,
  "children"
> {
  readonly animating?: boolean;
  readonly color?: string;
  readonly hidesWhenStopped?: boolean;
  readonly size?: "small" | "large" | number;
}

export type SwitchValueChangeHandler = (value: boolean) => void | Promise<void>;

export interface SwitchProps extends Omit<NativeElementProps, "children"> {
  readonly disabled?: boolean;
  readonly value?: boolean;
  readonly thumbColor?: string;
  readonly trackColor?: Readonly<{
    readonly false?: string;
    readonly true?: string;
  }>;
  readonly iosBackgroundColor?: string;
  readonly onChange?: NativeEventHandler;
  readonly onValueChange?: SwitchValueChangeHandler;
}

export interface ModalProps extends NativeElementProps {
  readonly visible?: boolean;
  readonly transparent?: boolean;
  readonly animationType?: "none" | "slide" | "fade";
  readonly backdropColor?: string;
  readonly presentationStyle?:
    "fullScreen" | "pageSheet" | "formSheet" | "overFullScreen";
  readonly supportedOrientations?: readonly (
    | "portrait"
    | "portrait-upside-down"
    | "landscape"
    | "landscape-left"
    | "landscape-right"
  )[];
  readonly allowSwipeDismissal?: boolean;
  readonly hardwareAccelerated?: boolean;
  readonly statusBarTranslucent?: boolean;
  readonly navigationBarTranslucent?: boolean;
  readonly onRequestClose?: NativeEventHandler;
  readonly onShow?: NativeEventHandler;
  readonly onDismiss?: NativeEventHandler;
  readonly onOrientationChange?: NativeEventHandler;
  /** Runs after a previously visible native host is parked on either platform. */
  readonly onHidden?: () => unknown;
}

export type ScreenSheetDetents = readonly number[] | "fitToContents";
export type ScreenSheetLargestUndimmedDetent = number | "none" | "last";
export type ScreenSheetInitialDetent = number | "last";
export type ScreenSheetDetentChangePayload = Readonly<{
  readonly index: number;
  readonly isStable: boolean;
}>;
export type ScreenSheetDetentChangeEvent =
  NativeSyntheticEvent<ScreenSheetDetentChangePayload>;
export type ScreenSheetDetentChangeHandler = (
  event: ScreenSheetDetentChangeEvent,
) => unknown;

/** Native form-sheet behavior shared by iOS sheets and Android bottom sheets. */
export interface ScreenSheetPresentationProps {
  /** Ascending height ratios in (0, 1], or content-measured sizing. */
  readonly sheetAllowedDetents?: ScreenSheetDetents | undefined;
  /** Initial detent index. `last` selects the largest allowed detent. */
  readonly sheetInitialDetent?: ScreenSheetInitialDetent | undefined;
  /** Largest detent that leaves the presenting screen undimmed. */
  readonly sheetLargestUndimmedDetent?:
    ScreenSheetLargestUndimmedDetent | undefined;
  readonly sheetGrabberVisible?: boolean | undefined;
  /** Non-negative radius, or the platform default when omitted. */
  readonly sheetCornerRadius?: number | undefined;
  readonly sheetExpandsWhenScrolledToEdge?: boolean | undefined;
  /** Non-negative Android sheet elevation. */
  readonly sheetElevation?: number | undefined;
  readonly sheetShouldOverflowTopInset?: boolean | undefined;
  readonly sheetDefaultResizeAnimationEnabled?: boolean | undefined;
}

export interface ScreenProps
  extends NativeElementProps, ScreenSheetPresentationProps {
  readonly name?: string;
  readonly presentation?: "push" | "modal" | "sheet";
  readonly activityState?: 0 | 1 | 2;
  readonly gestureEnabled?: boolean;
  readonly nativeBackButtonDismissalEnabled?: boolean;
  readonly preventNativeDismiss?: boolean;
  readonly onFocus?: NativeEventHandler;
  readonly onBlur?: NativeEventHandler;
  readonly onDismiss?: NativeEventHandler;
  readonly onGestureCancel?: NativeEventHandler;
  readonly onNativeDismissCancel?: NativeEventHandler;
  readonly onSheetDetentChange?: ScreenSheetDetentChangeHandler;
}

export interface ScreenStackProps extends NativeElementProps {
  readonly activeScreen?: string;
  readonly onTransitionEnd?: NativeEventHandler;
}

/** An iOS system symbol or application asset-catalog image. */
export interface ScreenHeaderBarButtonIcon {
  readonly type: "sfSymbol" | "xcasset";
  readonly name: string;
}

export interface ScreenHeaderBarButtonTitleStyle {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: string;
  readonly color?: string;
}

export interface ScreenHeaderBarButtonBadge {
  readonly value: string;
  readonly style?: Readonly<{
    readonly color?: string;
    readonly backgroundColor?: string;
    readonly fontFamily?: string;
    readonly fontSize?: number;
    readonly fontWeight?: string;
  }>;
}

export interface ScreenHeaderBarButtonShared {
  readonly index?: number;
  readonly title?: string;
  readonly titleStyle?: ScreenHeaderBarButtonTitleStyle;
  readonly icon?: ScreenHeaderBarButtonIcon;
  readonly variant?: "plain" | "done" | "prominent";
  readonly tintColor?: string;
  readonly disabled?: boolean;
  readonly width?: number;
  readonly hidesSharedBackground?: boolean;
  readonly sharesBackground?: boolean;
  readonly identifier?: string;
  readonly badge?: ScreenHeaderBarButtonBadge;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
}

export interface ScreenHeaderBarButtonAction extends ScreenHeaderBarButtonShared {
  readonly type: "button";
  readonly onPress: () => unknown;
  readonly selected?: boolean;
}

export interface ScreenHeaderBarButtonMenuAction {
  readonly type: "action";
  readonly title: string;
  readonly subtitle?: string;
  readonly onPress: () => unknown;
  readonly icon?: ScreenHeaderBarButtonIcon;
  readonly state?: "on" | "off" | "mixed";
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly hidden?: boolean;
  readonly keepsMenuPresented?: boolean;
  readonly discoverabilityLabel?: string;
}

export interface ScreenHeaderBarButtonSubmenu {
  readonly type: "submenu";
  readonly title: string;
  readonly icon?: ScreenHeaderBarButtonIcon;
  readonly items: readonly ScreenHeaderBarButtonMenuElement[];
  readonly displayInline?: boolean;
  readonly destructive?: boolean;
  readonly singleSelection?: boolean;
  readonly displayAsPalette?: boolean;
}

export type ScreenHeaderBarButtonMenuElement =
  ScreenHeaderBarButtonMenuAction | ScreenHeaderBarButtonSubmenu;

export interface ScreenHeaderBarButtonMenu extends ScreenHeaderBarButtonShared {
  readonly type: "menu";
  readonly menu: Readonly<{
    readonly title?: string;
    readonly items: readonly ScreenHeaderBarButtonMenuElement[];
    readonly singleSelection?: boolean;
    readonly displayAsPalette?: boolean;
  }>;
  readonly changesSelectionAsPrimaryAction?: boolean;
}

export interface ScreenHeaderBarButtonSpacing {
  readonly type: "spacing";
  readonly spacing: number;
  readonly index?: number;
}

/** A transport-safe native iOS navigation-bar item. */
export type ScreenHeaderBarButtonItem =
  | ScreenHeaderBarButtonAction
  | ScreenHeaderBarButtonMenu
  | ScreenHeaderBarButtonSpacing;

/** Basic platform navigation-header configuration owned by a Screen. */
export interface ScreenHeaderProps extends Omit<NativeElementProps, "style"> {
  readonly backgroundColor?: string;
  readonly backTitle?: string;
  readonly backTitleVisible?: boolean;
  readonly backButtonDisplayMode?: "minimal" | "default" | "generic";
  readonly color?: string;
  readonly direction?: "rtl" | "ltr";
  /**
   * Opts out of the safe-area inset normally consumed by a visible header.
   * Use this only when an ancestor header already owns the top inset.
   */
  readonly disableTopInsetApplication?: boolean;
  readonly disableBackButtonMenu?: boolean;
  readonly hideBackButton?: boolean;
  readonly hideShadow?: boolean;
  /** Native iOS bar items. Android uses ScreenHeaderSubview slots instead. */
  readonly headerLeftBarButtonItems?: readonly ScreenHeaderBarButtonItem[];
  /** Native iOS bar items. Android uses ScreenHeaderSubview slots instead. */
  readonly headerRightBarButtonItems?: readonly ScreenHeaderBarButtonItem[];
  readonly largeTitle?: boolean;
  readonly largeTitleBackgroundColor?: string;
  readonly largeTitleColor?: string;
  readonly largeTitleFontFamily?: string;
  readonly largeTitleFontSize?: number;
  readonly largeTitleFontWeight?: string;
  readonly translucent?: boolean;
  readonly title?: string;
  readonly titleColor?: string;
  readonly titleFontFamily?: string;
  readonly titleFontSize?: number;
  readonly titleFontWeight?: string;
}

export type ScreenHeaderSubviewType = "back" | "left" | "right" | "center";

/** A native slot rendered directly inside a ScreenHeader configuration. */
export interface ScreenHeaderSubviewProps extends NativeElementProps {
  readonly type: ScreenHeaderSubviewType;
  /** iOS 26+ bar-item background policy for left and right slots. */
  readonly hidesSharedBackground?: boolean;
}

/**
 * Low-level control props for the pinned native tabs host. The upstream
 * component is experimental; applications should normally use NativeTabs.
 */
export interface TabsHostProps extends Omit<NativeElementProps, "style"> {
  readonly selectedKey: string;
  readonly baseProvenance: number;
  readonly rejectStaleNavStateUpdates?: boolean | undefined;
  readonly tabBarHidden?: boolean | undefined;
  readonly nativeContainerBackgroundColor?: string | undefined;
  readonly direction?: "inherit" | "ltr" | "rtl" | undefined;
  readonly colorScheme?: "inherit" | "light" | "dark" | undefined;
  readonly tabBarRespectsIMEInsets?: boolean | undefined;
  readonly tabBarTintColor?: string | undefined;
  readonly tabBarMinimizeBehavior?:
    "automatic" | "never" | "onScrollDown" | "onScrollUp" | undefined;
  readonly tabBarControllerMode?:
    "automatic" | "tabBar" | "tabSidebar" | undefined;
  readonly onTabSelected?: NativeEventHandler;
  readonly onTabSelectionRejected?: NativeEventHandler;
  readonly onTabSelectionPrevented?: NativeEventHandler;
  readonly onMoreTabSelected?: NativeEventHandler;
}

export type TabsScreenAndroidIcon =
  | Readonly<{
      /** Android drawable resource compiled into the application. */
      readonly type: "drawableResource";
      readonly name: string;
    }>
  | Readonly<{
      /** URI-backed image source parsed directly by the pinned native view. */
      readonly type: "imageSource";
      readonly source: ImageSource;
    }>;

export type TabsScreenIOSIcon =
  | Readonly<{
      /** iOS system symbol. */
      readonly type: "sfSymbol";
      readonly name: string;
    }>
  | Readonly<{
      /** Application asset catalog entry. */
      readonly type: "xcasset";
      readonly name: string;
    }>
  | Readonly<{
      /** URI-backed image rendered with its original colors. */
      readonly type: "imageSource";
      readonly source: ImageSource;
    }>
  | Readonly<{
      /** URI-backed image rendered as a tintable template. */
      readonly type: "templateSource";
      readonly source: ImageSource;
    }>;

export interface TabsScreenIcon {
  readonly android?: TabsScreenAndroidIcon;
  readonly ios?: TabsScreenIOSIcon;
}

export type TabsScreenFontWeight =
  | "normal"
  | "bold"
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900";

export type TabsScreenFontStyle = "normal" | "italic";

export interface TabsScreenItemStateAppearanceAndroid {
  readonly tabBarItemTitleFontColor?: string;
  readonly tabBarItemIconColor?: string;
}

export type TabsScreenItemLabelVisibilityMode =
  "auto" | "selected" | "labeled" | "unlabeled";

/** Transport-safe Android appearance accepted by the pinned native tabs view. */
export interface TabsScreenAppearanceAndroid {
  readonly tabBarBackgroundColor?: string;
  readonly tabBarItemRippleColor?: string;
  readonly tabBarItemLabelVisibilityMode?: TabsScreenItemLabelVisibilityMode;
  readonly normal?: TabsScreenItemStateAppearanceAndroid;
  readonly selected?: TabsScreenItemStateAppearanceAndroid;
  readonly focused?: TabsScreenItemStateAppearanceAndroid;
  readonly disabled?: TabsScreenItemStateAppearanceAndroid;
  readonly tabBarItemActiveIndicatorColor?: string;
  readonly tabBarItemActiveIndicatorEnabled?: boolean;
  readonly tabBarItemTitleFontFamily?: string;
  readonly tabBarItemTitleSmallLabelFontSize?: number;
  readonly tabBarItemTitleLargeLabelFontSize?: number;
  readonly tabBarItemTitleFontWeight?: TabsScreenFontWeight;
  readonly tabBarItemTitleFontStyle?: TabsScreenFontStyle;
  readonly tabBarItemBadgeBackgroundColor?: string;
  readonly tabBarItemBadgeTextColor?: string;
}

export interface TabsScreenTitlePositionAdjustment {
  readonly horizontal?: number;
  readonly vertical?: number;
}

export interface TabsScreenItemStateAppearanceIOS {
  readonly tabBarItemTitleFontFamily?: string;
  readonly tabBarItemTitleFontSize?: number;
  readonly tabBarItemTitleFontWeight?: TabsScreenFontWeight;
  readonly tabBarItemTitleFontStyle?: TabsScreenFontStyle;
  readonly tabBarItemTitleFontColor?: string;
  readonly tabBarItemTitlePositionAdjustment?: TabsScreenTitlePositionAdjustment;
  readonly tabBarItemIconColor?: string;
  readonly tabBarItemBadgeBackgroundColor?: string;
}

export interface TabsScreenItemAppearanceIOS {
  readonly normal?: TabsScreenItemStateAppearanceIOS;
  readonly selected?: TabsScreenItemStateAppearanceIOS;
  readonly focused?: TabsScreenItemStateAppearanceIOS;
  readonly disabled?: TabsScreenItemStateAppearanceIOS;
}

export type TabsScreenBlurEffect =
  | "none"
  | "systemDefault"
  | "extraLight"
  | "light"
  | "dark"
  | "regular"
  | "prominent"
  | "systemUltraThinMaterial"
  | "systemThinMaterial"
  | "systemMaterial"
  | "systemThickMaterial"
  | "systemChromeMaterial"
  | "systemUltraThinMaterialLight"
  | "systemThinMaterialLight"
  | "systemMaterialLight"
  | "systemThickMaterialLight"
  | "systemChromeMaterialLight"
  | "systemUltraThinMaterialDark"
  | "systemThinMaterialDark"
  | "systemMaterialDark"
  | "systemThickMaterialDark"
  | "systemChromeMaterialDark";

/** Transport-safe iOS appearance accepted by the pinned native tabs view. */
export interface TabsScreenAppearanceIOS {
  readonly stacked?: TabsScreenItemAppearanceIOS;
  readonly inline?: TabsScreenItemAppearanceIOS;
  readonly compactInline?: TabsScreenItemAppearanceIOS;
  readonly tabBarBackgroundColor?: string;
  readonly tabBarBlurEffect?: TabsScreenBlurEffect;
  readonly tabBarShadowColor?: string;
}

/** Platform branches are selected before the appearance crosses the host contract. */
export interface TabsScreenAppearance {
  readonly android?: TabsScreenAppearanceAndroid;
  readonly ios?: TabsScreenAppearanceIOS;
}

export interface TabsScreenScrollEdgeAppearance {
  readonly ios?: TabsScreenAppearanceIOS;
}

/** One retained child of the pinned experimental native tabs host. */
export interface TabsScreenProps extends NativeElementProps {
  readonly screenKey: string;
  readonly preventNativeSelection?: boolean | undefined;
  readonly title?: string | undefined;
  readonly badgeValue?: string | undefined;
  readonly icon?: TabsScreenIcon | undefined;
  readonly selectedIcon?: TabsScreenIcon | undefined;
  readonly standardAppearance?: TabsScreenAppearance | undefined;
  readonly scrollEdgeAppearance?: TabsScreenScrollEdgeAppearance | undefined;
  readonly tabBarItemTestID?: string | undefined;
  readonly tabBarItemAccessibilityLabel?: string | undefined;
  readonly specialEffects?:
    | Readonly<{
        repeatedTabSelection?: Readonly<{
          popToRoot?: boolean;
          scrollToTop?: boolean;
        }>;
      }>
    | undefined;
  readonly orientation?:
    | "inherit"
    | "all"
    | "allButUpsideDown"
    | "portrait"
    | "portraitUp"
    | "portraitDown"
    | "landscape"
    | "landscapeLeft"
    | "landscapeRight"
    | undefined;
  readonly onWillAppear?: NativeEventHandler;
  readonly onDidAppear?: NativeEventHandler;
  readonly onWillDisappear?: NativeEventHandler;
  readonly onDidDisappear?: NativeEventHandler;
}

export interface VirtualizedListRenderItemInfo<Item> {
  /** Fine-grained accessor for the current item with this stable key. */
  readonly item: Accessor<Item>;
  /** Fine-grained accessor because keyed items can move without remounting. */
  readonly index: Accessor<number>;
  /** True while any part of this item intersects the logical viewport. */
  readonly isVisible: Accessor<boolean>;
  readonly key: string;
  /** Scroll-axis fraction of this item's extent inside the viewport, from 0 through 1. */
  readonly visibleFraction: Accessor<number>;
}

export interface VirtualizedListEndReachedInfo {
  readonly distanceFromEnd: number;
}

export interface VirtualizedListStartReachedInfo {
  readonly distanceFromStart: number;
}

export interface VirtualizedListScrollOptions {
  readonly animated?: boolean;
}

export interface VirtualizedListScrollToIndexOptions extends VirtualizedListScrollOptions {
  readonly index: number;
  /** Additional distance before the aligned item, in density-independent pixels. */
  readonly viewOffset?: number;
  /** Aligns the item from 0 (start) through 1 (end) within the viewport. */
  readonly viewPosition?: number;
}

export interface VirtualizedListScrollToKeyOptions extends VirtualizedListScrollOptions {
  /** Stable key returned by this list's keyExtractor. */
  readonly key: string;
  /** Additional distance before the aligned item, in density-independent pixels. */
  readonly viewOffset?: number;
  /** Aligns the item from 0 (start) through 1 (end) within the viewport. */
  readonly viewPosition?: number;
}

export interface VirtualizedListScrollToOffsetOptions extends VirtualizedListScrollOptions {
  readonly offset: number;
}

export interface VirtualizedListHandle {
  /** The backing ScrollView for event identity, measurement, and escape hatches. */
  readonly nativeNode: NativeNode;
  scrollToEnd(options?: VirtualizedListScrollOptions): Promise<void>;
  scrollToIndex(options: VirtualizedListScrollToIndexOptions): Promise<void>;
  scrollToKey(options: VirtualizedListScrollToKeyOptions): Promise<void>;
  scrollToOffset(options: VirtualizedListScrollToOffsetOptions): Promise<void>;
}

export interface VirtualizedListItemLayout {
  readonly index: number;
  readonly length: number;
  readonly offset: number;
}

interface VirtualizedListCommonProps<Item> extends Omit<
  ScrollViewProps,
  | "children"
  | "contentContainerStyle"
  | "maintainVisibleContentPosition"
  | "onScroll"
  | "ref"
> {
  readonly data: readonly Item[];
  /** Exact viewport extent along the scroll axis, in density-independent pixels. */
  readonly viewportSize: number;
  readonly keyExtractor: (item: Item, index: number) => string;
  readonly renderItem: (info: VirtualizedListRenderItemInfo<Item>) => unknown;
  readonly horizontal?: boolean;
  /** Keeps the first eligible visible key at or after this logical data index anchored. */
  readonly maintainVisibleContentPosition?: Readonly<ScrollViewMaintainVisibleContentPosition>;
  /** Extra whole items retained before and after the visible window. */
  readonly overscan?: number;
  /**
   * Construction-time policy that reuses bounded native row-wrapper views as
   * keys enter and leave the window. Each `renderItem` owner remains keyed and
   * is disposed before its wrapper is assigned to a different key.
   */
  readonly recycleRowViews?: boolean;
  readonly onEndReached?: (info: VirtualizedListEndReachedInfo) => unknown;
  /** Distance from the end expressed as a fraction of the viewport. */
  readonly onEndReachedThreshold?: number;
  readonly onStartReached?: (info: VirtualizedListStartReachedInfo) => unknown;
  /** Distance from the start expressed as a fraction of the viewport. */
  readonly onStartReachedThreshold?: number;
  readonly onScroll?: NativeEventHandler;
  readonly ref?: (handle: VirtualizedListHandle) => void;
}

interface VirtualizedListWithoutRefreshProps {
  readonly colors?: never;
  readonly enabled?: never;
  readonly onRefresh?: never;
  readonly progressBackgroundColor?: never;
  readonly progressViewOffset?: never;
  readonly refreshing?: never;
  readonly size?: never;
  readonly tintColor?: never;
  readonly title?: never;
  readonly titleColor?: never;
}

export interface VirtualizedListRefreshProps extends Pick<
  RefreshableScrollViewProps,
  | "colors"
  | "enabled"
  | "progressBackgroundColor"
  | "progressViewOffset"
  | "refreshing"
  | "size"
  | "tintColor"
  | "title"
  | "titleColor"
> {
  readonly horizontal?: false;
  readonly onRefresh: () => unknown;
}

type VirtualizedListInitialPositionProps =
  | {
      readonly initialScrollIndex?: never;
      readonly initialScrollKey?: never;
    }
  | {
      /** Construction-time logical index placed at the viewport start on the first native mount. */
      readonly initialScrollIndex: number;
      readonly initialScrollKey?: never;
    }
  | {
      readonly initialScrollIndex?: never;
      /** Construction-time stable key placed at the viewport start on the first native mount. */
      readonly initialScrollKey: string;
    };

const VIRTUALIZED_LIST_REFRESH_PROPERTIES = new Set<string | symbol>([
  "colors",
  "enabled",
  "onRefresh",
  "progressBackgroundColor",
  "progressViewOffset",
  "refreshing",
  "size",
  "tintColor",
  "title",
  "titleColor",
]);

export type VirtualizedListProps<Item = unknown> =
  VirtualizedListCommonProps<Item> &
    (VirtualizedListWithoutRefreshProps | VirtualizedListRefreshProps) &
    VirtualizedListInitialPositionProps &
    (
      | {
          /** Exact fixed extent along the scroll axis, in density-independent pixels. */
          readonly itemSize: number;
          readonly getItemLayout?: never;
          readonly estimatedItemSize?: never;
        }
      | {
          readonly itemSize?: never;
          readonly estimatedItemSize?: never;
          /**
           * Exact layout for one item. Offsets must be ordered and
           * non-overlapping; gaps may represent separators.
           */
          readonly getItemLayout: (
            data: readonly Item[],
            index: number,
          ) => Readonly<VirtualizedListItemLayout>;
        }
      | {
          readonly itemSize?: never;
          readonly getItemLayout?: never;
          /**
           * Initial extent for unmeasured rows. Mounted rows replace the
           * estimate with their native layout while retaining keyed ownership.
           */
          readonly estimatedItemSize: number;
        }
    );

const NATIVE_COMPONENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertNativeComponentName(name: string): void {
  if (name.length > 128 || !NATIVE_COMPONENT_NAME.test(name)) {
    throw new TypeError(
      `Native component names must be 1-128 character identifiers, received ${JSON.stringify(name)}.`,
    );
  }
}

export function createNativeComponent<Props extends object>(
  name: string,
): NativeComponent<Props> {
  assertNativeComponentName(name);
  return (props) => {
    const node = createElement(name);
    spread(node, props);
    return node;
  };
}

function keyboardAvoidingViewNativeProps(
  props: KeyboardAvoidingViewProps,
  ref: NativeRef,
  onLayout: NativeLayoutEventHandler,
): ViewProps {
  const privateProperties = new Set<string | symbol>([
    "children",
    "keyboard",
    "keyboardVerticalOffset",
    "onAvoidanceChange",
    "onMeasurementError",
  ]);
  return new Proxy({} as ViewProps, {
    get(_target, property) {
      if (privateProperties.has(property)) return undefined;
      if (property === "ref") return ref;
      if (property === "onLayout") return onLayout;
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (privateProperties.has(property)) return undefined;
      if (property === "ref" || property === "onLayout") {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !privateProperties.has(property),
      );
      if (!keys.includes("ref")) keys.push("ref");
      if (!keys.includes("onLayout")) keys.push("onLayout");
      return keys;
    },
  });
}

function createKeyboardAvoidingView(
  props: KeyboardAvoidingViewProps,
): NativeNode {
  const view = createElement("View");
  const spacer = createElement("View");
  const [avoidanceInset, setAvoidanceInset] = createSignal(0);
  const verticalOffset = createMemo(() =>
    finiteKeyboardCoordinate(
      props.keyboardVerticalOffset ?? 0,
      "keyboardVerticalOffset",
    ),
  );
  let target: NativeNode | undefined;
  let layoutObserved = false;
  let measurementRevision = 0;
  let active = true;

  const reportError = (error: unknown): void => {
    reportKeyboardAvoidanceError(error, props.onMeasurementError);
  };
  const applyInset = (next: number): void => {
    if (!active || Object.is(untrack(avoidanceInset), next)) return;
    setAvoidanceInset(next);
    try {
      const result = props.onAvoidanceChange?.(next);
      void Promise.resolve(result).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  };
  const measureFor = (
    metrics: KeyboardMetrics,
    offset: number,
    deferUntilAfterEffect = false,
  ): Promise<void> => {
    const measuredTarget = target;
    if (!active || !layoutObserved || measuredTarget === undefined) {
      return Promise.resolve();
    }
    const revision = ++measurementRevision;
    const scope = nativeNodeRoot(measuredTarget).createCausalScope(
      "keyboard.avoidance.measurement",
    );
    const startMeasurement = (): Promise<void> => {
      if (!active || revision !== measurementRevision) {
        scope.cancel();
        return Promise.resolve();
      }
      let pendingMeasurement: Promise<NativeMeasurement>;
      try {
        pendingMeasurement = scope.run(() => measuredTarget.measure());
      } catch (error) {
        scope.fail(error);
        reportError(error);
        return Promise.resolve();
      }
      return pendingMeasurement.then(
        (measurement: NativeMeasurement) => {
          if (!active || revision !== measurementRevision) {
            scope.cancel();
            return;
          }
          try {
            scope.run(() =>
              applyInset(
                calculateKeyboardAvoidanceInset(measurement, metrics, offset),
              ),
            );
            scope.finish();
          } catch (error) {
            scope.fail(error);
            reportError(error);
          }
        },
        (error: unknown) => {
          scope.fail(error);
          if (active && revision === measurementRevision) reportError(error);
        },
      );
    };
    if (!deferUntilAfterEffect) return startMeasurement();
    return Promise.resolve().then(startMeasurement);
  };
  const ref: NativeRef = (node) => {
    target = node;
    props.ref?.(node);
  };
  const onLayout: NativeLayoutEventHandler = (event) => {
    layoutObserved = true;
    const metrics = untrack(props.keyboard.metrics);
    const measurement =
      metrics === undefined
        ? Promise.resolve()
        : measureFor(metrics, untrack(verticalOffset));
    let callback: unknown;
    try {
      callback = props.onLayout?.(event);
    } catch (error) {
      void measurement.catch(() => undefined);
      throw error;
    }
    return Promise.all([measurement, Promise.resolve(callback)]).then(
      () => undefined,
    );
  };

  effect(
    () => ({
      metrics: props.keyboard.metrics(),
      offset: verticalOffset(),
    }),
    ({ metrics, offset }) => {
      measurementRevision++;
      if (metrics === undefined) {
        applyInset(0);
        return;
      }
      void measureFor(metrics, offset, true);
    },
  );
  onCleanup(() => {
    active = false;
    measurementRevision++;
  });

  insert(view, props.children);
  spread(spacer, {
    accessible: false,
    collapsable: false,
    pointerEvents: "none",
    get style() {
      return {
        flexShrink: 0,
        height: avoidanceInset(),
      } satisfies NativeStyle;
    },
  });
  insert(view, spacer);
  spread(view, keyboardAvoidingViewNativeProps(props, ref, onLayout));
  return view;
}

const IMAGE_BASE_STYLE: NativeStyle = {
  overflow: "hidden",
};

interface NativeImageProps extends Omit<ImageProps, "source"> {
  readonly source: readonly Readonly<ImageURISource>[];
  readonly shouldNotifyLoadEvents: boolean;
}

function imageNativeProps(props: ImageProps): NativeImageProps {
  const source = createMemo<readonly Readonly<ImageURISource>[]>(() => [
    typeof props.source === "string" ? { uri: props.source } : props.source,
  ]);
  const style = createMemo<StyleProp>(() => {
    const imageSource = source()[0];
    return [
      imageSource === undefined
        ? undefined
        : { width: imageSource.width, height: imageSource.height },
      IMAGE_BASE_STYLE,
      props.style,
    ];
  });
  const resizeMode = createMemo(() => props.resizeMode ?? "cover");
  const shouldNotifyLoadEvents = createMemo(
    () => props.onLoad !== undefined || props.onError !== undefined,
  );

  const overriddenProperties = new Set<string | symbol>([
    "source",
    "style",
    "resizeMode",
    "shouldNotifyLoadEvents",
  ]);
  return new Proxy({} as NativeImageProps, {
    get(_target, property) {
      if (property === "source") return source();
      if (property === "style") return style();
      if (property === "resizeMode") return resizeMode();
      if (property === "shouldNotifyLoadEvents") {
        return shouldNotifyLoadEvents();
      }
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (overriddenProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props);
      for (const property of overriddenProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
}

function createImage(props: ImageProps): NativeNode {
  const image = createElement("Image");
  spread(image, imageNativeProps(props));
  return image;
}

interface NativePressableProps extends Omit<
  PressableProps,
  | "android_ripple"
  | "children"
  | "delayHoverIn"
  | "delayHoverOut"
  | "delayLongPress"
  | "disabled"
  | "onLayout"
  | "onLongPress"
  | "pressRetentionOffset"
  | "style"
  | "unstable_pressDelay"
> {
  readonly accessible: boolean;
  readonly accessibilityState: NonNullable<
    PressableProps["accessibilityState"]
  >;
  readonly collapsable: false;
  readonly focusable: boolean;
  readonly nativeBackgroundAndroid?: Readonly<Record<string, HostValue>>;
  readonly nativeForegroundAndroid?: Readonly<Record<string, HostValue>>;
  readonly onLayout?: NativeLayoutEventHandler;
  readonly onPressCancel?: NativeEventHandler;
  readonly onPress?: NativeEventHandler;
  readonly onPressIn?: NativeEventHandler;
  readonly onPressMove?: NativeEventHandler;
  readonly onPressOut?: NativeEventHandler;
  readonly style?: StyleProp;
}

interface NativeTimerGlobals {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

const nativeTimers = globalThis as unknown as NativeTimerGlobals;

function pressableDelay(
  name:
    "delayHoverIn" | "delayHoverOut" | "delayLongPress" | "unstable_pressDelay",
  value: number | undefined,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`Pressable ${name} must be non-negative.`);
  }
  return Math.max(minimum, value);
}

function longPressEvent(event: NativeSyntheticEvent): NativeSyntheticEvent {
  return Object.freeze({
    name: "longPress",
    target: event.target,
    currentTarget: event.currentTarget,
    observedSequence: event.observedSequence,
    timestamp: event.timestamp,
    priority: "discrete",
    bubbles: event.bubbles,
    coalescible: false,
    payload: event.payload,
    stopPropagation() {
      event.stopPropagation();
    },
  });
}

function pressTransitionEvent(
  event: NativeSyntheticEvent,
  name: "pressIn" | "pressOut",
): NativeSyntheticEvent {
  if (event.name === name) return event;
  return Object.freeze({
    name,
    target: event.target,
    currentTarget: event.currentTarget,
    observedSequence: event.observedSequence,
    timestamp: event.timestamp,
    priority: event.priority,
    bubbles: event.bubbles,
    coalescible: false,
    payload: event.payload,
    stopPropagation() {
      event.stopPropagation();
    },
  });
}

const DEFAULT_PRESS_RETENTION_INSETS = Object.freeze({
  top: 20,
  right: 20,
  bottom: 30,
  left: 20,
});
const ZERO_PRESSABLE_INSETS = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});
const PRESSABLE_INSET_NAMES = new Set(["top", "right", "bottom", "left"]);
const ANDROID_RIPPLE_NAMES = new Set([
  "alpha",
  "borderless",
  "color",
  "foreground",
  "radius",
]);

interface NormalizedAndroidRipple {
  readonly foreground: boolean;
  readonly drawable: Readonly<Record<string, HostValue>>;
}

function normalizedAndroidRipple(
  value: PressableProps["android_ripple"],
): NormalizedAndroidRipple | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError("Pressable android_ripple must be a plain object.");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !ANDROID_RIPPLE_NAMES.has(key)) {
      throw new TypeError(
        "Pressable android_ripple contains an unknown option.",
      );
    }
  }
  if (value.color !== undefined && typeof value.color !== "string") {
    throw new TypeError("Pressable android_ripple.color must be a string.");
  }
  for (const name of ["borderless", "foreground"] as const) {
    if (value[name] !== undefined && typeof value[name] !== "boolean") {
      throw new TypeError(
        `Pressable android_ripple.${name} must be a boolean.`,
      );
    }
  }
  if (
    value.radius !== undefined &&
    (typeof value.radius !== "number" ||
      !Number.isFinite(value.radius) ||
      value.radius < 0)
  ) {
    throw new TypeError(
      "Pressable android_ripple.radius must be a finite non-negative number.",
    );
  }
  if (
    value.alpha !== undefined &&
    (typeof value.alpha !== "number" ||
      !Number.isFinite(value.alpha) ||
      value.alpha < 0 ||
      value.alpha > 1)
  ) {
    throw new TypeError(
      "Pressable android_ripple.alpha must be a finite number between 0 and 1.",
    );
  }
  if (
    value.color === undefined &&
    value.borderless === undefined &&
    value.radius === undefined
  ) {
    return undefined;
  }
  return {
    foreground: value.foreground === true,
    drawable: {
      type: "RippleAndroid",
      color: value.color ?? null,
      borderless: value.borderless === true,
      rippleRadius: value.radius ?? null,
      alpha: value.alpha ?? null,
    },
  };
}

function finitePressableInset(
  value: unknown,
  property: "hitSlop" | "pressRetentionOffset",
  name?: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    const suffix = name === undefined ? "" : `.${name}`;
    throw new TypeError(
      `Pressable ${property}${suffix} must be a finite non-negative number.`,
    );
  }
  return value;
}

function normalizedPressableInsets(
  value: number | Readonly<PressableInsets> | undefined,
  property: "hitSlop" | "pressRetentionOffset",
  defaults: Readonly<Required<PressableInsets>>,
): Readonly<Required<PressableInsets>> {
  if (value === undefined) return defaults;
  if (typeof value === "number") {
    const inset = finitePressableInset(value, property);
    return { top: inset, right: inset, bottom: inset, left: inset };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `Pressable ${property} must be a non-negative number or inset object.`,
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !PRESSABLE_INSET_NAMES.has(key)) {
      throw new TypeError(`Pressable ${property} contains an unknown inset.`);
    }
  }
  return {
    top:
      value.top === undefined
        ? defaults.top
        : finitePressableInset(value.top, property, "top"),
    right:
      value.right === undefined
        ? defaults.right
        : finitePressableInset(value.right, property, "right"),
    bottom:
      value.bottom === undefined
        ? defaults.bottom
        : finitePressableInset(value.bottom, property, "bottom"),
    left:
      value.left === undefined
        ? defaults.left
        : finitePressableInset(value.left, property, "left"),
  };
}

function hostValueRecord(
  value: HostValue,
): Readonly<Record<string, HostValue>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, HostValue>>;
}

function finiteHostNumber(value: HostValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function pressableEventLocation(
  event: NativeSyntheticEvent,
): { readonly x: number; readonly y: number } | undefined {
  const payload = hostValueRecord(event.payload);
  if (payload === undefined) return undefined;
  const touches = Array.isArray(payload.touches) ? payload.touches : undefined;
  const changedTouches = Array.isArray(payload.changedTouches)
    ? payload.changedTouches
    : undefined;
  const touch = hostValueRecord(touches?.[0] ?? changedTouches?.[0] ?? payload);
  if (touch === undefined) return undefined;
  const x = finiteHostNumber(touch.offsetX ?? touch.locationX);
  const y = finiteHostNumber(touch.offsetY ?? touch.locationY);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function pressableEventPageLocation(
  event: NativeSyntheticEvent,
): { readonly x: number; readonly y: number } | undefined {
  const payload = hostValueRecord(event.payload);
  if (payload === undefined) return undefined;
  const touches = Array.isArray(payload.touches) ? payload.touches : undefined;
  const changedTouches = Array.isArray(payload.changedTouches)
    ? payload.changedTouches
    : undefined;
  const touch = hostValueRecord(touches?.[0] ?? changedTouches?.[0] ?? payload);
  if (touch === undefined) return undefined;
  const x = finiteHostNumber(touch.pageX);
  const y = finiteHostNumber(touch.pageY);
  return x === undefined || y === undefined ? undefined : { x, y };
}

interface PressableScrollArbitration {
  register(cancel: () => void): () => void;
}

const PressableScrollArbitrationContext =
  createContext<PressableScrollArbitration | null>(null);
const PressableScrollArbitrationProvider =
  PressableScrollArbitrationContext as Component<{
    readonly value: PressableScrollArbitration;
    readonly children?: SolidElement;
  }>;

function currentPressableScrollArbitration(): PressableScrollArbitration | null {
  return getOwner() === null
    ? null
    : useContext(PressableScrollArbitrationContext);
}

function createPressable(props: PressableProps): NativeNode {
  const pressable = createElement("Pressable");
  const platform = nativeNodePlatform(pressable);
  const scrollArbitration = currentPressableScrollArbitration();
  const androidRipple = createMemo(() =>
    platform === "android"
      ? normalizedAndroidRipple(props.android_ripple)
      : undefined,
  );
  const [pressed, setPressed] = createSignal(false);
  const state = Object.freeze({
    get pressed() {
      return pressed();
    },
  });
  let pressInTimer: unknown;
  let longPressTimer: unknown;
  let hoverInTimer: unknown;
  let hoverOutTimer: unknown;
  let hoverInside = false;
  let hoverActive = false;
  let longPressFired = false;
  let gestureActive = false;
  let pressActivated = false;
  let pressDelayElapsed = false;
  let pressWithinRetention = false;
  let pressSuppressed = false;
  let pendingPressInEvent: NativeSyntheticEvent | undefined;
  let pressActivationLocation:
    { readonly x: number; readonly y: number } | undefined;
  let pressTargetPageOrigin:
    { readonly x: number; readonly y: number } | undefined;
  let pressRegionInsets: Readonly<Required<PressableInsets>> | undefined;
  let layoutWidth: number | undefined;
  let layoutHeight: number | undefined;
  let nativeRipplePressed = false;
  let latestGestureEvent: NativeSyntheticEvent | undefined;
  let unregisterScrollCancellation: (() => void) | undefined;

  const clearPressInTimer = (): void => {
    if (pressInTimer === undefined) return;
    nativeTimers.clearTimeout(pressInTimer);
    pressInTimer = undefined;
  };
  const clearLongPressTimer = (): void => {
    if (longPressTimer === undefined) return;
    nativeTimers.clearTimeout(longPressTimer);
    longPressTimer = undefined;
  };
  const clearHoverInTimer = (): void => {
    if (hoverInTimer === undefined) return;
    nativeTimers.clearTimeout(hoverInTimer);
    hoverInTimer = undefined;
  };
  const clearHoverOutTimer = (): void => {
    if (hoverOutTimer === undefined) return;
    nativeTimers.clearTimeout(hoverOutTimer);
    hoverOutTimer = undefined;
  };
  const clearScrollCancellation = (): void => {
    unregisterScrollCancellation?.();
    unregisterScrollCancellation = undefined;
  };
  const activateHover = (event: NativeSyntheticEvent): void => {
    hoverInTimer = undefined;
    if (!hoverInside || hoverActive) return;
    hoverActive = true;
    props.onHoverIn?.(event);
  };
  const deactivateHover = (event: NativeSyntheticEvent): void => {
    hoverOutTimer = undefined;
    if (hoverInside || !hoverActive) return;
    hoverActive = false;
    props.onHoverOut?.(event);
  };
  const dispatchDelayedHoverIn = createCausalPlatformEventHandler(
    "pressable.delayed-hover-in",
    activateHover,
  );
  const dispatchDelayedHoverOut = createCausalPlatformEventHandler(
    "pressable.delayed-hover-out",
    deactivateHover,
  );
  const handleHoverIn: NativeEventHandler = (event) => {
    if (hoverInside) return;
    hoverInside = true;
    clearHoverOutTimer();
    if (hoverActive) return;
    clearHoverInTimer();
    const delay = pressableDelay("delayHoverIn", props.delayHoverIn, 0, 0);
    if (delay === 0) {
      activateHover(event);
      return;
    }
    hoverInTimer = nativeTimers.setTimeout(
      () => dispatchDelayedHoverIn(event),
      delay,
    );
  };
  const handleHoverOut: NativeEventHandler = (event) => {
    if (!hoverInside) return;
    hoverInside = false;
    clearHoverInTimer();
    if (!hoverActive) return;
    clearHoverOutTimer();
    const delay = pressableDelay("delayHoverOut", props.delayHoverOut, 0, 0);
    if (delay === 0) {
      deactivateHover(event);
      return;
    }
    hoverOutTimer = nativeTimers.setTimeout(
      () => dispatchDelayedHoverOut(event),
      delay,
    );
  };
  const dispatchLongPress = createCausalPlatformEventHandler(
    "pressable.long-press",
    (event: NativeSyntheticEvent) => props.onLongPress?.(event),
    { priority: "discrete" },
  );
  const observeRippleCommand = (command: Promise<void>): void => {
    // NativeRoot retains command failures for the next flush; this observer
    // prevents a framework-owned fire-and-forget command from being unhandled.
    void command.catch(() => undefined);
  };
  const updateAndroidRippleHotspot = (event: NativeSyntheticEvent): void => {
    if (androidRipple() === undefined) return;
    const location = stablePressableEventLocation(event);
    observeRippleCommand(
      pressable.dispatchCommand(
        "hotspotUpdate",
        location?.x ?? 0,
        location?.y ?? 0,
      ),
    );
  };
  const stablePressableEventLocation = (
    event: NativeSyntheticEvent,
  ): { readonly x: number; readonly y: number } | undefined => {
    const pageLocation = pressableEventPageLocation(event);
    if (pageLocation !== undefined && pressTargetPageOrigin !== undefined) {
      return {
        x: pageLocation.x - pressTargetPageOrigin.x,
        y: pageLocation.y - pressTargetPageOrigin.y,
      };
    }
    return pressableEventLocation(event);
  };
  const setAndroidRipplePressed = (
    next: boolean,
    event?: NativeSyntheticEvent,
  ): void => {
    if (next) {
      if (androidRipple() === undefined) return;
      if (event !== undefined) updateAndroidRippleHotspot(event);
    } else if (!nativeRipplePressed) {
      return;
    }
    nativeRipplePressed = next;
    observeRippleCommand(pressable.dispatchCommand("setPressed", next));
  };
  const activatePress = (event: NativeSyntheticEvent): void => {
    pressInTimer = undefined;
    pendingPressInEvent = undefined;
    if (
      props.disabled === true ||
      !gestureActive ||
      !pressWithinRetention ||
      pressActivated
    ) {
      return;
    }
    pressActivated = true;
    const localLocation = pressableEventLocation(event);
    const pageLocation = pressableEventPageLocation(event);
    if (
      pressTargetPageOrigin === undefined &&
      pageLocation !== undefined &&
      localLocation !== undefined
    ) {
      pressTargetPageOrigin = {
        x: pageLocation.x - localLocation.x,
        y: pageLocation.y - localLocation.y,
      };
    }
    pressActivationLocation = stablePressableEventLocation(event);
    setAndroidRipplePressed(true, event);
    setPressed(true);
    props.onPressIn?.(pressTransitionEvent(event, "pressIn"));
  };
  const dispatchDelayedPressIn = createCausalPlatformEventHandler(
    "pressable.delayed-press-in",
    (event: NativeSyntheticEvent) => {
      pressDelayElapsed = true;
      activatePress(event);
    },
    { priority: "discrete" },
  );
  const handlePressIn: NativeEventHandler = (event) => {
    if (props.disabled === true || gestureActive) return;
    const pressDelay = pressableDelay(
      "unstable_pressDelay",
      props.unstable_pressDelay,
      0,
      0,
    );
    const longPressDelay =
      props.onLongPress === undefined
        ? undefined
        : pressableDelay("delayLongPress", props.delayLongPress, 500, 10);
    const retentionInsets = normalizedPressableInsets(
      props.pressRetentionOffset,
      "pressRetentionOffset",
      DEFAULT_PRESS_RETENTION_INSETS,
    );
    const hitSlopInsets = normalizedPressableInsets(
      props.hitSlop,
      "hitSlop",
      ZERO_PRESSABLE_INSETS,
    );
    const nextPressRegionInsets = {
      top: hitSlopInsets.top + retentionInsets.top,
      right: hitSlopInsets.right + retentionInsets.right,
      bottom: hitSlopInsets.bottom + retentionInsets.bottom,
      left: hitSlopInsets.left + retentionInsets.left,
    };
    clearPressInTimer();
    clearLongPressTimer();
    clearScrollCancellation();
    longPressFired = false;
    gestureActive = true;
    pressActivated = false;
    pressActivationLocation = undefined;
    pressTargetPageOrigin = undefined;
    pressDelayElapsed = pressDelay === 0;
    pressWithinRetention = true;
    pressSuppressed = false;
    pressRegionInsets = nextPressRegionInsets;
    pendingPressInEvent = event;
    latestGestureEvent = event;
    unregisterScrollCancellation = scrollArbitration?.register(() => {
      if (latestGestureEvent !== undefined) {
        handlePressCancel(latestGestureEvent);
      }
    });
    if (pressDelay === 0) {
      activatePress(event);
    } else {
      pressInTimer = nativeTimers.setTimeout(
        () => dispatchDelayedPressIn(event),
        pressDelay,
      );
    }
    if (longPressDelay === undefined) return;
    longPressTimer = nativeTimers.setTimeout(() => {
      longPressTimer = undefined;
      if (
        props.disabled === true ||
        !gestureActive ||
        !pressActivated ||
        !pressWithinRetention
      ) {
        return;
      }
      longPressFired = true;
      dispatchLongPress(longPressEvent(event));
    }, pressDelay + longPressDelay);
  };
  const deactivatePress = (event: NativeSyntheticEvent): unknown => {
    if (!pressActivated) return undefined;
    pressActivated = false;
    setAndroidRipplePressed(false);
    setPressed(false);
    return props.onPressOut?.(pressTransitionEvent(event, "pressOut"));
  };
  const isInsideRetention = (event: NativeSyntheticEvent): boolean => {
    if (layoutWidth === undefined || layoutHeight === undefined) return true;
    const location = stablePressableEventLocation(event);
    if (location === undefined) return true;
    const insets = pressRegionInsets;
    if (insets === undefined) return true;
    return (
      location.x > -insets.left &&
      location.x < layoutWidth + insets.right &&
      location.y > -insets.top &&
      location.y < layoutHeight + insets.bottom
    );
  };
  const handlePressMove: NativeEventHandler = (event) => {
    if (props.disabled === true || !gestureActive) return;
    latestGestureEvent = event;
    updateAndroidRippleHotspot(event);
    const result = props.onPressMove?.(event);
    const location = stablePressableEventLocation(event);
    if (
      location !== undefined &&
      pressActivationLocation !== undefined &&
      Math.hypot(
        location.x - pressActivationLocation.x,
        location.y - pressActivationLocation.y,
      ) > 10
    ) {
      clearLongPressTimer();
    }
    const inside = isInsideRetention(event);
    if (inside === pressWithinRetention) return result;
    pressWithinRetention = inside;
    if (!inside) {
      clearLongPressTimer();
      return deactivatePress(event);
    }
    if (pressDelayElapsed) activatePress(event);
    return result;
  };
  const handlePressOut: NativeEventHandler = (event) => {
    if (props.disabled === true) {
      clearPressInTimer();
      clearLongPressTimer();
      pendingPressInEvent = undefined;
      gestureActive = false;
      pressActivated = false;
      pressDelayElapsed = false;
      pressWithinRetention = false;
      pressSuppressed = false;
      pressActivationLocation = undefined;
      pressTargetPageOrigin = undefined;
      pressRegionInsets = undefined;
      latestGestureEvent = undefined;
      clearScrollCancellation();
      setAndroidRipplePressed(false);
      setPressed(false);
      return;
    }
    if (!gestureActive) return;
    const pendingEvent = pendingPressInEvent;
    clearPressInTimer();
    clearLongPressTimer();
    if (pressWithinRetention && !pressActivated && pendingEvent !== undefined) {
      pressDelayElapsed = true;
      activatePress(pendingEvent);
    }
    pressSuppressed = !pressWithinRetention;
    const result = deactivatePress(event);
    gestureActive = false;
    pressDelayElapsed = false;
    pressWithinRetention = false;
    pressActivationLocation = undefined;
    pressTargetPageOrigin = undefined;
    pressRegionInsets = undefined;
    pendingPressInEvent = undefined;
    latestGestureEvent = undefined;
    clearScrollCancellation();
    return result;
  };
  const handlePressCancel: NativeEventHandler = (event) => {
    if (!gestureActive) return;
    clearPressInTimer();
    clearLongPressTimer();
    const result = deactivatePress(event);
    gestureActive = false;
    pressDelayElapsed = false;
    pressWithinRetention = false;
    pressSuppressed = true;
    longPressFired = false;
    pressActivationLocation = undefined;
    pressTargetPageOrigin = undefined;
    pressRegionInsets = undefined;
    pendingPressInEvent = undefined;
    latestGestureEvent = undefined;
    clearScrollCancellation();
    return result;
  };
  const handlePress: NativeEventHandler = (event) => {
    if (props.disabled === true) return;
    const suppressPress =
      pressSuppressed || (longPressFired && props.onLongPress !== undefined);
    pressSuppressed = false;
    longPressFired = false;
    if (!suppressPress) return props.onPress?.(event);
  };
  const handleLayout: NativeLayoutEventHandler = (event) => {
    const payload = hostValueRecord(event.payload);
    const layoutValue = payload?.layout;
    const layout =
      layoutValue === undefined ? undefined : hostValueRecord(layoutValue);
    const width =
      layout === undefined ? undefined : finiteHostNumber(layout.width);
    const height =
      layout === undefined ? undefined : finiteHostNumber(layout.height);
    if (
      width !== undefined &&
      height !== undefined &&
      width >= 0 &&
      height >= 0
    ) {
      layoutWidth = width;
      layoutHeight = height;
    }
    return props.onLayout?.(event);
  };
  const accessibilityState = createMemo(() => ({
    ...props.accessibilityState,
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
  }));
  const nativeStyle = createMemo<StyleProp>(() => {
    const style = props.style;
    return typeof style === "function" ? style(state) : style;
  });
  const childrenDescriptor = Reflect.getOwnPropertyDescriptor(
    props,
    "children",
  );
  const childrenCallback =
    childrenDescriptor !== undefined &&
    "value" in childrenDescriptor &&
    typeof childrenDescriptor.value === "function"
      ? (childrenDescriptor.value as (state: PressableState) => unknown)
      : undefined;
  const usesPressedState = (): boolean =>
    typeof props.style === "function" || childrenCallback !== undefined;
  const usesPressInteraction = (): boolean =>
    props.onPress !== undefined ||
    props.onPressIn !== undefined ||
    props.onPressOut !== undefined ||
    props.onPressMove !== undefined ||
    props.onLongPress !== undefined ||
    androidRipple() !== undefined ||
    usesPressedState();
  const usesHoverInteraction = (): boolean =>
    props.onHoverIn !== undefined || props.onHoverOut !== undefined;
  const translatedProperties = new Set<string | symbol>([
    "android_ripple",
    "delayHoverIn",
    "delayHoverOut",
    "delayLongPress",
    "disabled",
    "onLongPress",
    "pressRetentionOffset",
    "unstable_pressDelay",
  ]);
  if (childrenCallback !== undefined) translatedProperties.add("children");
  const nativeProperties = new Set<string | symbol>([
    "accessible",
    "accessibilityState",
    "collapsable",
    "focusable",
    "nativeBackgroundAndroid",
    "nativeForegroundAndroid",
    "onLayout",
    "onHoverIn",
    "onHoverOut",
    "onPress",
    "onPressCancel",
    "onPressIn",
    "onPressMove",
    "onPressOut",
    "pointerEvents",
    "style",
  ]);
  const nativeProps = new Proxy({} as NativePressableProps, {
    get(_target, property) {
      if (translatedProperties.has(property)) return undefined;
      if (property === "accessible") return props.accessible ?? true;
      if (property === "accessibilityState") return accessibilityState();
      if (property === "collapsable") return false;
      if (property === "focusable") return props.focusable ?? true;
      if (property === "pointerEvents")
        return props.pointerEvents ?? "box-only";
      if (
        property === "nativeBackgroundAndroid" ||
        property === "nativeForegroundAndroid"
      ) {
        const ripple = androidRipple();
        if (ripple === undefined) return undefined;
        const foreground = property === "nativeForegroundAndroid";
        return ripple.foreground === foreground ? ripple.drawable : undefined;
      }
      if (property === "onLayout") {
        return props.onLayout === undefined && !usesPressInteraction()
          ? undefined
          : handleLayout;
      }
      if (property === "onHoverIn") {
        return usesHoverInteraction() ? handleHoverIn : undefined;
      }
      if (property === "onHoverOut") {
        return usesHoverInteraction() ? handleHoverOut : undefined;
      }
      if (property === "onPress") {
        return props.onPress === undefined ? undefined : handlePress;
      }
      if (property === "onPressCancel") {
        return usesPressInteraction() ? handlePressCancel : undefined;
      }
      if (property === "onPressIn") {
        return usesPressInteraction() ? handlePressIn : undefined;
      }
      if (property === "onPressOut") {
        return usesPressInteraction() ? handlePressOut : undefined;
      }
      if (property === "onPressMove") {
        return usesPressInteraction() ? handlePressMove : undefined;
      }
      if (property === "style") return nativeStyle();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (translatedProperties.has(property)) return undefined;
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !translatedProperties.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });

  effect(
    () => props.disabled === true,
    (disabled) => {
      if (!disabled) return;
      clearPressInTimer();
      clearLongPressTimer();
      longPressFired = false;
      gestureActive = false;
      pressActivated = false;
      pressDelayElapsed = false;
      pressWithinRetention = false;
      pressSuppressed = false;
      pressActivationLocation = undefined;
      pressTargetPageOrigin = undefined;
      pressRegionInsets = undefined;
      latestGestureEvent = undefined;
      clearScrollCancellation();
      setAndroidRipplePressed(false);
      pendingPressInEvent = undefined;
      setPressed(false);
    },
  );
  onCleanup(() => {
    clearPressInTimer();
    clearLongPressTimer();
    clearHoverInTimer();
    clearHoverOutTimer();
    clearScrollCancellation();
    hoverInside = false;
    hoverActive = false;
    gestureActive = false;
    pressActivated = false;
    pressActivationLocation = undefined;
    pressTargetPageOrigin = undefined;
    pressRegionInsets = undefined;
    latestGestureEvent = undefined;
    nativeRipplePressed = false;
  });
  if (childrenCallback !== undefined) {
    insert(
      pressable,
      createMemo(() => childrenCallback(state)),
    );
  }
  spread(pressable, nativeProps);
  return pressable;
}

const BUTTON_ANDROID_STYLE: NativeStyle = {
  elevation: 4,
  backgroundColor: "#2196f3",
  borderRadius: 2,
};
const BUTTON_ANDROID_DISABLED_STYLE: NativeStyle = {
  elevation: 0,
  backgroundColor: "#dfdfdf",
};
const BUTTON_ANDROID_TEXT_STYLE: NativeStyle = {
  color: "#ffffff",
  fontWeight: "500",
  margin: 8,
  textAlign: "center",
};
const BUTTON_ANDROID_DISABLED_TEXT_STYLE: NativeStyle = {
  color: "#a1a1a1",
};
const BUTTON_IOS_TEXT_STYLE: NativeStyle = {
  color: "#007aff",
  fontSize: 18,
  padding: 8,
  textAlign: "center",
};
const BUTTON_IOS_DISABLED_TEXT_STYLE: NativeStyle = {
  color: "#cdcdcd",
};
const BUTTON_ANDROID_RIPPLE = Object.freeze({ color: "#ffffff33" });
const BUTTON_PRIVATE_PROPERTIES = new Set<string | symbol>([
  "accessibilityRole",
  "children",
  "color",
  "role",
  "style",
  "textStyle",
  "title",
]);

function buttonString(value: unknown, property: "color" | "title"): string {
  if (typeof value !== "string") {
    throw new TypeError(`Button ${property} must be a string.`);
  }
  return value;
}

function createButton(props: ButtonProps): NativeNode {
  const text = createElement("Text");
  const hostPlatform = nativeNodePlatform(text);
  // The public in-memory testing host intentionally reports `test`; use the
  // Android presentation as its deterministic non-UIKit baseline.
  const platform = hostPlatform === "test" ? "android" : hostPlatform;
  if (platform !== "android" && platform !== "ios") {
    throw new Error(
      `Button requires an android or ios host platform, received ${JSON.stringify(hostPlatform)}.`,
    );
  }
  const title = createMemo(() => buttonString(props.title, "title"));
  const color = createMemo(() =>
    props.color === undefined ? undefined : buttonString(props.color, "color"),
  );
  spread(text, {
    accessible: false,
    numberOfLines: 1,
    get style(): StyleProp {
      return [
        platform === "android"
          ? BUTTON_ANDROID_TEXT_STYLE
          : BUTTON_IOS_TEXT_STYLE,
        platform === "ios" && color() !== undefined
          ? { color: color() }
          : undefined,
        props.disabled === true
          ? platform === "android"
            ? BUTTON_ANDROID_DISABLED_TEXT_STYLE
            : BUTTON_IOS_DISABLED_TEXT_STYLE
          : undefined,
        props.textStyle,
      ];
    },
    get children() {
      const value = title();
      return platform === "android" ? value.toUpperCase() : value;
    },
  } satisfies TextProps);

  const nativeProperties = new Set<string | symbol>([
    "accessibilityLabel",
    "accessibilityRole",
    "android_ripple",
    "children",
    "style",
  ]);
  const nativeProps = new Proxy({} as PressableProps, {
    get(_target, property) {
      if (property === "accessibilityLabel") {
        return props.accessibilityLabel ?? title();
      }
      if (property === "accessibilityRole") return "button";
      if (property === "android_ripple") {
        return props.android_ripple ?? BUTTON_ANDROID_RIPPLE;
      }
      if (property === "children") return text;
      if (property === "style") {
        return (state: PressableState): StyleProp => [
          platform === "android" ? BUTTON_ANDROID_STYLE : undefined,
          platform === "android" && color() !== undefined
            ? { backgroundColor: color() }
            : undefined,
          props.disabled === true && platform === "android"
            ? BUTTON_ANDROID_DISABLED_STYLE
            : undefined,
          platform === "ios" && state.pressed ? { opacity: 0.65 } : undefined,
          typeof props.style === "function" ? props.style(state) : props.style,
        ];
      }
      if (BUTTON_PRIVATE_PROPERTIES.has(property)) return undefined;
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      if (BUTTON_PRIVATE_PROPERTIES.has(property)) return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !BUTTON_PRIVATE_PROPERTIES.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
  return createPressable(nativeProps);
}

const SCROLL_VIEW_BASE_STYLE: NativeStyle = {
  flexGrow: 1,
  flexShrink: 1,
  flexDirection: "column",
  overflow: "scroll",
};

const HORIZONTAL_SCROLL_VIEW_BASE_STYLE: NativeStyle = {
  flexGrow: 1,
  flexShrink: 1,
  flexDirection: "row",
  overflow: "scroll",
};

const HORIZONTAL_SCROLL_CONTENT_STYLE: NativeStyle = {
  flexDirection: "row",
};

const MAX_NATIVE_SCROLL_INDEX = 2_147_483_647;
const MAINTAIN_VISIBLE_CONTENT_POSITION_KEYS = new Set([
  "autoscrollToTopThreshold",
  "minIndexForVisible",
]);
const SCROLL_TO_OPTION_KEYS = new Set(["animated", "x", "y"]);
const SCROLL_TO_END_OPTION_KEYS = new Set(["animated"]);
const EMPTY_SCROLL_TO_END_OPTIONS: ScrollViewScrollToEndOptions = Object.freeze(
  {},
);

function scrollViewOptions(
  value: unknown,
  operation: "scrollTo" | "scrollToEnd",
  allowedKeys: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(
      `ScrollView ${operation} options must be a plain object.`,
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new TypeError(
        `ScrollView ${operation} contains an unknown option.`,
      );
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

function scrollViewAnimated(
  options: Readonly<Record<string, unknown>>,
  operation: "scrollTo" | "scrollToEnd",
): boolean {
  const animated = options.animated ?? true;
  if (typeof animated !== "boolean") {
    throw new TypeError(`ScrollView ${operation} animated must be a boolean.`);
  }
  return animated;
}

function scrollViewCoordinate(value: unknown, axis: "x" | "y"): number {
  const coordinate = value ?? 0;
  if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
    throw new TypeError(`ScrollView scrollTo ${axis} must be a finite number.`);
  }
  if (coordinate < 0) {
    throw new RangeError(`ScrollView scrollTo ${axis} must be non-negative.`);
  }
  return coordinate;
}

function createScrollViewHandle(scrollView: NativeNode): ScrollViewHandle {
  return Object.freeze({
    nativeNode: scrollView,
    scrollTo(options: ScrollViewScrollToOptions) {
      const candidate = scrollViewOptions(
        options,
        "scrollTo",
        SCROLL_TO_OPTION_KEYS,
      );
      return scrollView.dispatchCommand(
        "scrollTo",
        scrollViewCoordinate(candidate.x, "x"),
        scrollViewCoordinate(candidate.y, "y"),
        scrollViewAnimated(candidate, "scrollTo"),
      );
    },
    scrollToEnd(
      options: ScrollViewScrollToEndOptions = EMPTY_SCROLL_TO_END_OPTIONS,
    ) {
      const candidate = scrollViewOptions(
        options,
        "scrollToEnd",
        SCROLL_TO_END_OPTION_KEYS,
      );
      return scrollView.dispatchCommand(
        "scrollToEnd",
        scrollViewAnimated(candidate, "scrollToEnd"),
      );
    },
  });
}

function nativeScrollIndex(value: unknown, name: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_NATIVE_SCROLL_INDEX
  ) {
    throw new RangeError(
      `ScrollView maintainVisibleContentPosition.${name} must be an integer from 0 to ${String(MAX_NATIVE_SCROLL_INDEX)}.`,
    );
  }
  return value as number;
}

function normalizedMaintainVisibleContentPosition(
  value: ScrollViewProps["maintainVisibleContentPosition"],
): Readonly<ScrollViewMaintainVisibleContentPosition> | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(
      "ScrollView maintainVisibleContentPosition must be a plain object.",
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !MAINTAIN_VISIBLE_CONTENT_POSITION_KEYS.has(key)
    ) {
      throw new TypeError(
        "ScrollView maintainVisibleContentPosition contains an unknown option.",
      );
    }
  }
  const minIndexForVisible = nativeScrollIndex(
    value.minIndexForVisible,
    "minIndexForVisible",
  );
  const autoscrollToTopThreshold =
    value.autoscrollToTopThreshold === undefined
      ? undefined
      : nativeScrollIndex(
          value.autoscrollToTopThreshold,
          "autoscrollToTopThreshold",
        );
  return autoscrollToTopThreshold === undefined
    ? { minIndexForVisible }
    : { minIndexForVisible, autoscrollToTopThreshold };
}

function scrollViewNativeProps(
  props: ScrollViewProps,
  style: () => StyleProp,
  maintainVisibleContentPosition: () =>
    Readonly<ScrollViewMaintainVisibleContentPosition> | undefined,
  onScrollBeginDrag: NativeEventHandler,
): ScrollViewProps {
  return new Proxy({} as ScrollViewProps, {
    get(_target, property) {
      if (
        property === "children" ||
        property === "contentContainerStyle" ||
        property === "ref"
      ) {
        return undefined;
      }
      if (property === "style") {
        return style();
      }
      if (property === "maintainVisibleContentPosition") {
        return maintainVisibleContentPosition();
      }
      if (property === "onScrollBeginDrag") return onScrollBeginDrag;
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (
        property === "children" ||
        property === "contentContainerStyle" ||
        property === "ref"
      ) {
        return undefined;
      }
      if (property === "style") {
        return { configurable: true, enumerable: true };
      }
      if (property === "maintainVisibleContentPosition") {
        return Reflect.has(props, property)
          ? { configurable: true, enumerable: true }
          : undefined;
      }
      if (property === "onScrollBeginDrag") {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) =>
          property !== "children" &&
          property !== "contentContainerStyle" &&
          property !== "ref",
      );
      if (!keys.includes("style")) keys.push("style");
      if (!keys.includes("onScrollBeginDrag")) keys.push("onScrollBeginDrag");
      return keys;
    },
  });
}

function createScrollView(
  props: ScrollViewProps,
  leadingChild?: NativeNode,
): NativeNode {
  const parentPressArbitration = currentPressableScrollArbitration();
  const activePressCancellations = new Set<() => void>();
  const pressArbitration: PressableScrollArbitration = Object.freeze({
    register(cancel: () => void): () => void {
      activePressCancellations.add(cancel);
      const unregisterParent = parentPressArbitration?.register(cancel);
      return () => {
        activePressCancellations.delete(cancel);
        unregisterParent?.();
      };
    },
  });
  const handleScrollBeginDrag: NativeEventHandler = (event) => {
    for (const cancel of [...activePressCancellations]) cancel();
    return props.onScrollBeginDrag?.(event);
  };
  const initialMaintainVisibleContentPosition = untrack(
    () => props.maintainVisibleContentPosition,
  );
  const normalizedInitialMaintainVisibleContentPosition =
    normalizedMaintainVisibleContentPosition(
      initialMaintainVisibleContentPosition,
    );
  let canUseInitialMaintainVisibleContentPosition = true;
  const maintainVisibleContentPosition = createMemo(() => {
    const current = props.maintainVisibleContentPosition;
    if (
      canUseInitialMaintainVisibleContentPosition &&
      current === initialMaintainVisibleContentPosition
    ) {
      canUseInitialMaintainVisibleContentPosition = false;
      return normalizedInitialMaintainVisibleContentPosition;
    }
    canUseInitialMaintainVisibleContentPosition = false;
    return normalizedMaintainVisibleContentPosition(current);
  });
  const scrollView = createElement("ScrollView");
  const contentView = createElement("ScrollContentView");
  const nativeStyle = createMemo<StyleProp>(() => [
    props.horizontal
      ? HORIZONTAL_SCROLL_VIEW_BASE_STYLE
      : SCROLL_VIEW_BASE_STYLE,
    props.style,
  ]);
  const contentStyle = createMemo<StyleProp>(() => [
    props.horizontal ? HORIZONTAL_SCROLL_CONTENT_STYLE : undefined,
    props.contentContainerStyle,
  ]);
  spread(contentView, {
    collapsable: false,
    get style() {
      return contentStyle();
    },
  });
  const providedContentView = solidCreateComponent(
    PressableScrollArbitrationProvider,
    {
      value: pressArbitration,
      get children() {
        insert(contentView, () => props.children);
        return contentView;
      },
    },
  ) as NativeNode;
  if (leadingChild !== undefined) insert(scrollView, leadingChild);
  insert(scrollView, providedContentView);
  spread(
    scrollView,
    scrollViewNativeProps(
      props,
      nativeStyle,
      maintainVisibleContentPosition,
      handleScrollBeginDrag,
    ),
  );
  const handle = createScrollViewHandle(scrollView);
  untrack(() => props.ref?.(handle));
  return scrollView;
}

const REFRESHABLE_SCROLL_VIEW_PROPERTIES = new Set<string | symbol>([
  "colors",
  "enabled",
  "onRefresh",
  "progressBackgroundColor",
  "progressViewOffset",
  "refreshing",
  "size",
  "tintColor",
  "title",
  "titleColor",
]);

const REFRESHABLE_SCROLL_OUTER_STYLE_PROPERTIES = new Set([
  "alignSelf",
  "bottom",
  "columnGap",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
  "gap",
  "height",
  "left",
  "margin",
  "marginBottom",
  "marginHorizontal",
  "marginLeft",
  "marginRight",
  "marginTop",
  "marginVertical",
  "maxHeight",
  "maxWidth",
  "minHeight",
  "minWidth",
  "position",
  "right",
  "rowGap",
  "top",
  "transform",
  "transformOrigin",
  "width",
]);

interface RefreshableScrollStyleSplit {
  readonly inner: NativeStyle;
  readonly outer: NativeStyle;
}

function splitRefreshableScrollStyle(
  value: StyleProp,
): RefreshableScrollStyleSplit {
  const flattened: Record<string, HostValue | undefined> = {};
  const flatten = (entry: StyleProp): void => {
    if (entry === undefined || entry === null || entry === false) return;
    if (Array.isArray(entry)) {
      for (const child of entry) flatten(child);
      return;
    }
    if (typeof entry !== "object") {
      throw new TypeError("Native style values must be objects or arrays.");
    }
    Object.assign(flattened, entry);
  };
  flatten(value);
  const inner: Record<string, HostValue | undefined> = {};
  const outer: Record<string, HostValue | undefined> = {};
  for (const [name, entry] of Object.entries(flattened)) {
    (REFRESHABLE_SCROLL_OUTER_STYLE_PROPERTIES.has(name) ? outer : inner)[
      name
    ] = entry;
  }
  return { inner, outer };
}

function refreshBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`RefreshableScrollView ${name} must be a boolean.`);
  }
  return value;
}

function refreshColor(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(
      `RefreshableScrollView ${name} must be a color string.`,
    );
  }
  return value;
}

function refreshOffset(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(
      "RefreshableScrollView progressViewOffset must be finite and non-negative.",
    );
  }
  return value;
}

function refreshColors(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new TypeError(
      "RefreshableScrollView colors must be a non-empty array of color strings.",
    );
  }
  return [...value] as readonly string[];
}

function refreshableScrollNativeProps(
  props: RefreshableScrollViewProps,
  horizontal: () => false,
  style?: () => StyleProp,
  nestedScrollEnabled?: () => boolean,
): ScrollViewProps {
  const nativeProperties = new Set<string | symbol>(["horizontal"]);
  if (style !== undefined) nativeProperties.add("style");
  if (nestedScrollEnabled !== undefined) {
    nativeProperties.add("nestedScrollEnabled");
  }
  return new Proxy({} as ScrollViewProps, {
    get(_target, property) {
      if (REFRESHABLE_SCROLL_VIEW_PROPERTIES.has(property)) return undefined;
      if (property === "horizontal") return horizontal();
      if (property === "style" && style !== undefined) return style();
      if (
        property === "nestedScrollEnabled" &&
        nestedScrollEnabled !== undefined
      ) {
        return nestedScrollEnabled();
      }
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (REFRESHABLE_SCROLL_VIEW_PROPERTIES.has(property)) return undefined;
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !REFRESHABLE_SCROLL_VIEW_PROPERTIES.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
}

interface RefreshableScrollViewTree {
  readonly root: NativeNode;
  readonly scrollView: NativeNode;
}

function createRefreshableScrollViewTree(
  props: RefreshableScrollViewProps,
): RefreshableScrollViewTree {
  const refreshControl = createElement("RefreshControl");
  const platform = nativeNodePlatform(refreshControl);
  if (platform !== "android" && platform !== "ios") {
    throw new Error(
      `RefreshableScrollView requires an android or ios host platform, received ${JSON.stringify(platform)}.`,
    );
  }
  const horizontal = createMemo<false>(() => {
    if (props.horizontal !== undefined && props.horizontal !== false) {
      throw new TypeError(
        "RefreshableScrollView only supports vertical scrolling.",
      );
    }
    return false;
  });
  const refreshing = createMemo(() =>
    refreshBoolean(props.refreshing, "refreshing"),
  );
  const enabled = createMemo(() =>
    refreshBoolean(props.enabled ?? true, "enabled"),
  );
  const colors = createMemo(() => refreshColors(props.colors));
  const progressBackgroundColor = createMemo(() =>
    refreshColor(props.progressBackgroundColor, "progressBackgroundColor"),
  );
  const size = createMemo(() => {
    const value = props.size ?? "default";
    if (value !== "default" && value !== "large") {
      throw new TypeError(
        "RefreshableScrollView size must be default or large.",
      );
    }
    return value;
  });
  const progressViewOffset = createMemo(() =>
    refreshOffset(props.progressViewOffset),
  );
  const tintColor = createMemo(() =>
    refreshColor(props.tintColor, "tintColor"),
  );
  const title = createMemo(() => {
    if (props.title !== undefined && typeof props.title !== "string") {
      throw new TypeError("RefreshableScrollView title must be a string.");
    }
    return props.title;
  });
  const titleColor = createMemo(() =>
    refreshColor(props.titleColor, "titleColor"),
  );
  const [nativeRefreshRevision, setNativeRefreshRevision] = createSignal(0);
  const handleRefresh = (): unknown => {
    setNativeRefreshRevision((revision) => revision + 1);
    return props.onRefresh?.();
  };

  // Pull-to-refresh changes native state before its event is delivered. If
  // the controlled Solid value rejects that change, restore the platform view
  // through its command even though the refreshing prop itself did not change.
  effect(
    () => {
      const revision = nativeRefreshRevision();
      return revision > 0 && !refreshing() ? revision : undefined;
    },
    (revision) => {
      if (revision === undefined) return;
      void refreshControl.dispatchCommand("setNativeRefreshing", false);
    },
  );

  const nativeRefreshProps =
    platform === "android"
      ? {
          get colors() {
            return colors();
          },
          get enabled() {
            return enabled();
          },
          onRefresh: handleRefresh,
          get progressBackgroundColor() {
            return progressBackgroundColor();
          },
          get progressViewOffset() {
            return progressViewOffset();
          },
          get refreshing() {
            return refreshing();
          },
          get size() {
            return size();
          },
        }
      : {
          onRefresh: handleRefresh,
          get progressViewOffset() {
            return progressViewOffset();
          },
          get refreshing() {
            return refreshing();
          },
          get tintColor() {
            return tintColor();
          },
          get title() {
            return title();
          },
          get titleColor() {
            return titleColor();
          },
        };

  if (platform === "ios") {
    spread(refreshControl, nativeRefreshProps);
    const scrollView = createScrollView(
      refreshableScrollNativeProps(props, horizontal),
      refreshControl,
    );
    return { root: scrollView, scrollView };
  }

  const style = createMemo(() => splitRefreshableScrollStyle(props.style));
  const scrollView = createScrollView(
    refreshableScrollNativeProps(
      props,
      horizontal,
      () => style().inner,
      () => props.nestedScrollEnabled ?? true,
    ),
  );
  insert(refreshControl, scrollView);
  spread(refreshControl, nativeRefreshProps);
  spread(refreshControl, {
    get style() {
      return [SCROLL_VIEW_BASE_STYLE, style().outer];
    },
  });
  return { root: refreshControl, scrollView };
}

function createRefreshableScrollView(
  props: RefreshableScrollViewProps,
): NativeNode {
  return createRefreshableScrollViewTree(props).root;
}

interface KeyboardAwareScrollController {
  focus(target: NativeNode): Promise<void> | undefined;
  blur(target: NativeNode): void;
}

const KEYBOARD_AWARE_SCROLL_CONTROLLERS = new WeakMap<
  NativeNode,
  KeyboardAwareScrollController
>();

function keyboardAwareScrollController(
  target: NativeNode,
): KeyboardAwareScrollController | undefined {
  for (
    let ancestor = target.parentNode;
    ancestor !== undefined;
    ancestor = ancestor.parentNode
  ) {
    const controller = KEYBOARD_AWARE_SCROLL_CONTROLLERS.get(ancestor);
    if (controller !== undefined) return controller;
  }
  return undefined;
}

function keyboardAwareScrollOffset(event: NativeSyntheticEvent): number {
  if (event.name !== "scroll") {
    throw new TypeError(
      "KeyboardAwareScrollView received a non-scroll native event.",
    );
  }
  const payload = event.payload;
  const contentOffset =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Readonly<Record<string, HostValue>>).contentOffset
      : undefined;
  const offset =
    typeof contentOffset === "object" &&
    contentOffset !== null &&
    !Array.isArray(contentOffset)
      ? (contentOffset as Readonly<Record<string, HostValue>>).y
      : undefined;
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    throw new TypeError(
      "KeyboardAwareScrollView scroll events must include a finite vertical offset.",
    );
  }
  return Math.max(0, offset);
}

function keyboardAwareScrollViewNativeProps(
  props: KeyboardAwareScrollViewProps,
  ref: (handle: ScrollViewHandle) => void,
  onScroll: NativeEventHandler,
): ScrollViewProps {
  const privateProperties = new Set<string | symbol>([
    "animated",
    "extraScrollHeight",
    "horizontal",
    "keyboard",
    "keyboardVerticalOffset",
    "onFocusedFieldScroll",
    "onVisibilityError",
  ]);
  return new Proxy({} as ScrollViewProps, {
    get(_target, property) {
      if (privateProperties.has(property)) return undefined;
      if (property === "ref") return ref;
      if (property === "onScroll") return onScroll;
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (privateProperties.has(property)) return undefined;
      if (property === "ref" || property === "onScroll") {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !privateProperties.has(property),
      );
      if (!keys.includes("ref")) keys.push("ref");
      if (!keys.includes("onScroll")) keys.push("onScroll");
      return keys;
    },
  });
}

function createKeyboardAwareScrollView(
  props: KeyboardAwareScrollViewProps,
): NativeNode {
  const extraScrollHeight = createMemo(() => {
    const value = finiteKeyboardCoordinate(
      props.extraScrollHeight ?? 0,
      "extraScrollHeight",
    );
    if (value < 0) {
      throw new RangeError(
        "KeyboardAwareScrollView extraScrollHeight must be non-negative.",
      );
    }
    return value;
  });
  const verticalOffset = createMemo(() =>
    finiteKeyboardCoordinate(
      props.keyboardVerticalOffset ?? 0,
      "keyboardVerticalOffset",
    ),
  );
  const animated = createMemo(() => {
    const value = props.animated ?? true;
    if (typeof value !== "boolean") {
      throw new TypeError("KeyboardAwareScrollView animated must be boolean.");
    }
    return value;
  });
  let scrollView: NativeNode;
  let focusedField: NativeNode | undefined;
  let currentScrollOffset = 0;
  let visibilityRevision = 0;
  let active = true;

  const reportError = (error: unknown): void => {
    try {
      const result = props.onVisibilityError?.(error);
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Diagnostics cannot break native focus delivery or owner disposal.
    }
  };
  const ensureVisible = (
    target: NativeNode,
    metrics: KeyboardMetrics,
    options: Required<FocusedFieldScrollOptions>,
    shouldAnimate: boolean,
  ): Promise<void> => {
    if (!active || focusedField !== target) return Promise.resolve();
    const revision = ++visibilityRevision;
    const scope = nativeNodeRoot(scrollView).createCausalScope(
      "keyboard.focus.visibility",
    );
    const start = async (): Promise<void> => {
      if (!active || revision !== visibilityRevision) {
        scope.cancel();
        return;
      }
      try {
        const [scrollFrame, fieldFrame] = await scope.run(() =>
          Promise.all([scrollView.measure(), target.measure()]),
        );
        if (
          !active ||
          revision !== visibilityRevision ||
          focusedField !== target
        ) {
          scope.cancel();
          return;
        }
        const destination = calculateFocusedFieldScrollOffset(
          scrollFrame,
          fieldFrame,
          currentScrollOffset,
          metrics,
          options,
        );
        if (Math.abs(destination - currentScrollOffset) <= 0.5) {
          scope.finish();
          return;
        }
        await scope.run(() =>
          scrollView.dispatchCommand("scrollTo", 0, destination, shouldAnimate),
        );
        if (
          !active ||
          revision !== visibilityRevision ||
          focusedField !== target
        ) {
          scope.cancel();
          return;
        }
        currentScrollOffset = destination;
        const callback = scope.run(() =>
          props.onFocusedFieldScroll?.(destination),
        );
        await Promise.resolve(callback);
        scope.finish();
      } catch (error) {
        scope.fail(error);
        if (active && revision === visibilityRevision) reportError(error);
      }
    };
    return Promise.resolve().then(start);
  };
  const requestVisibility = (target: NativeNode): Promise<void> | undefined => {
    const metrics = untrack(props.keyboard.metrics);
    if (metrics === undefined) return undefined;
    return ensureVisible(
      target,
      metrics,
      {
        extraScrollHeight: untrack(extraScrollHeight),
        keyboardVerticalOffset: untrack(verticalOffset),
      },
      untrack(animated),
    );
  };
  const controller: KeyboardAwareScrollController = {
    focus(target) {
      visibilityRevision++;
      focusedField = target;
      return requestVisibility(target);
    },
    blur(target) {
      if (focusedField !== target) return;
      visibilityRevision++;
      focusedField = undefined;
    },
  };
  const ref = (handle: ScrollViewHandle): void => {
    props.ref?.(handle);
  };
  const onScroll: NativeEventHandler = (event) => {
    currentScrollOffset = keyboardAwareScrollOffset(event);
    return props.onScroll?.(event);
  };
  scrollView = createScrollView(
    keyboardAwareScrollViewNativeProps(props, ref, onScroll),
  );
  KEYBOARD_AWARE_SCROLL_CONTROLLERS.set(scrollView, controller);
  effect(
    () => ({
      animated: animated(),
      extraScrollHeight: extraScrollHeight(),
      keyboardVerticalOffset: verticalOffset(),
      metrics: props.keyboard.metrics(),
    }),
    (state) => {
      visibilityRevision++;
      const target = focusedField;
      if (state.metrics === undefined || target === undefined) return;
      void ensureVisible(
        target,
        state.metrics,
        {
          extraScrollHeight: state.extraScrollHeight,
          keyboardVerticalOffset: state.keyboardVerticalOffset,
        },
        state.animated,
      );
    },
  );
  onCleanup(() => {
    active = false;
    visibilityRevision++;
    KEYBOARD_AWARE_SCROLL_CONTROLLERS.delete(scrollView);
  });
  return scrollView;
}

interface VirtualizedListState<Item> {
  readonly items: readonly Item[];
  readonly keys: readonly string[];
  readonly indexByKey: ReadonlyMap<string, number>;
}

interface VirtualizedListLayoutModel {
  readonly contentSize: number;
  readonly measuresItems: boolean;
  firstVisibleIndex(offset: number): number;
  visibleEndIndex(offset: number): number;
  itemLength(index: number): number;
  itemOffset(index: number): number;
}

interface VirtualizedListScrollInput {
  readonly offset: number;
}

interface VirtualizedListViewModel<Item> {
  readonly input: VirtualizedListScrollInput;
  readonly state: VirtualizedListState<Item>;
  readonly layout: VirtualizedListLayoutModel;
  readonly offset: number;
  readonly viewportSize: number;
}

function positiveListExtent(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `VirtualizedList ${name} must be finite and positive.`,
    );
  }
  return value;
}

function virtualizedListContentSize(length: number, itemSize: number): number {
  const contentSize = length * itemSize;
  if (!Number.isFinite(contentSize)) {
    throw new RangeError(
      "VirtualizedList data length and itemSize must produce a finite content extent.",
    );
  }
  return contentSize;
}

function virtualizedListFixedLayout(
  length: number,
  itemSize: number,
): VirtualizedListLayoutModel {
  const contentSize = virtualizedListContentSize(length, itemSize);
  return {
    contentSize,
    measuresItems: false,
    firstVisibleIndex(offset) {
      return Math.min(length, Math.floor(offset / itemSize));
    },
    visibleEndIndex(offset) {
      return Math.min(length, Math.ceil(offset / itemSize));
    },
    itemLength(index) {
      return index >= 0 && index < length ? itemSize : 0;
    },
    itemOffset(index) {
      return index * itemSize;
    },
  };
}

function virtualizedListLayoutObject(
  value: unknown,
  index: number,
): Readonly<VirtualizedListItemLayout> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(
      `VirtualizedList getItemLayout result ${String(index)} must be a plain object.`,
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      (key !== "index" && key !== "length" && key !== "offset")
    ) {
      throw new TypeError(
        `VirtualizedList getItemLayout result ${String(index)} contains an unknown field.`,
      );
    }
  }
  return value as Readonly<VirtualizedListItemLayout>;
}

function firstIndexWhere(
  length: number,
  predicate: (index: number) => boolean,
): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (predicate(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

function virtualizedListVariableLayout<Item>(
  items: readonly Item[],
  getItemLayout: (
    data: readonly Item[],
    index: number,
  ) => Readonly<VirtualizedListItemLayout>,
): VirtualizedListLayoutModel {
  const offsets: number[] = [];
  const lengths: number[] = [];
  const ends: number[] = [];
  let previousEnd = 0;
  for (let index = 0; index < items.length; index++) {
    const layout = virtualizedListLayoutObject(
      getItemLayout(items, index),
      index,
    );
    if (layout.index !== index) {
      throw new RangeError(
        `VirtualizedList getItemLayout result ${String(index)} must report the requested index.`,
      );
    }
    const length = positiveListExtent(
      layout.length,
      `getItemLayout result ${String(index)} length`,
    );
    const offset = layout.offset;
    if (!Number.isFinite(offset) || offset < 0) {
      throw new RangeError(
        `VirtualizedList getItemLayout result ${String(index)} offset must be finite and non-negative.`,
      );
    }
    if (index > 0 && offset < previousEnd) {
      throw new RangeError(
        `VirtualizedList getItemLayout result ${String(index)} overlaps the preceding item.`,
      );
    }
    const end = offset + length;
    if (!Number.isFinite(end)) {
      throw new RangeError(
        `VirtualizedList getItemLayout result ${String(index)} must produce a finite end offset.`,
      );
    }
    offsets.push(offset);
    lengths.push(length);
    ends.push(end);
    previousEnd = end;
  }
  const contentSize = ends.at(-1) ?? 0;
  return {
    contentSize,
    measuresItems: false,
    firstVisibleIndex(offset) {
      return firstIndexWhere(items.length, (index) => ends[index]! > offset);
    },
    visibleEndIndex(offset) {
      return firstIndexWhere(
        items.length,
        (index) => offsets[index]! >= offset,
      );
    },
    itemLength(index) {
      return lengths[index] ?? 0;
    },
    itemOffset(index) {
      return offsets[index] ?? 0;
    },
  };
}

function virtualizedListMeasuredLayout(
  keys: readonly string[],
  estimatedItemSize: number,
  measuredItemSizes: ReadonlyMap<string, number>,
): VirtualizedListLayoutModel {
  const estimate = positiveListExtent(estimatedItemSize, "estimatedItemSize");
  const offsets: number[] = [];
  const lengths: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const [index, key] of keys.entries()) {
    const length = measuredItemSizes.get(key) ?? estimate;
    const end = offset + length;
    if (!Number.isFinite(end)) {
      throw new RangeError(
        "VirtualizedList measured and estimated rows must produce a finite content extent.",
      );
    }
    offsets[index] = offset;
    lengths[index] = length;
    ends[index] = end;
    offset = end;
  }
  return {
    contentSize: offset,
    measuresItems: true,
    firstVisibleIndex(visibleOffset) {
      return firstIndexWhere(
        keys.length,
        (index) => ends[index]! > visibleOffset,
      );
    },
    visibleEndIndex(visibleOffset) {
      return firstIndexWhere(
        keys.length,
        (index) => offsets[index]! >= visibleOffset,
      );
    },
    itemLength(index) {
      return lengths[index] ?? 0;
    },
    itemOffset(index) {
      return offsets[index] ?? 0;
    },
  };
}

function virtualizedListLayout<Item>(
  items: readonly Item[],
  keys: readonly string[],
  itemSize: number | undefined,
  getItemLayout:
    | ((
        data: readonly Item[],
        index: number,
      ) => Readonly<VirtualizedListItemLayout>)
    | undefined,
  estimatedItemSize: number | undefined,
  measuredItemSizes: ReadonlyMap<string, number>,
): VirtualizedListLayoutModel {
  const configuredGeometryCount =
    Number(itemSize !== undefined) +
    Number(getItemLayout !== undefined) +
    Number(estimatedItemSize !== undefined);
  if (configuredGeometryCount > 1) {
    throw new TypeError(
      "VirtualizedList accepts only one of itemSize, getItemLayout, or estimatedItemSize.",
    );
  }
  if (itemSize !== undefined) {
    return virtualizedListFixedLayout(
      items.length,
      positiveListExtent(itemSize, "itemSize"),
    );
  }
  if (typeof getItemLayout !== "function") {
    if (estimatedItemSize !== undefined) {
      return virtualizedListMeasuredLayout(
        keys,
        estimatedItemSize,
        measuredItemSizes,
      );
    }
    throw new TypeError(
      "VirtualizedList requires itemSize, getItemLayout, or estimatedItemSize.",
    );
  }
  return virtualizedListVariableLayout(items, getItemLayout);
}

function virtualizedListOverscan(value: number | undefined): number {
  const overscan = value ?? 2;
  if (!Number.isSafeInteger(overscan) || overscan < 0 || overscan > 1_000) {
    throw new RangeError(
      "VirtualizedList overscan must be an integer from 0 to 1000.",
    );
  }
  return overscan;
}

function virtualizedListThreshold(
  value: number | undefined,
  name: "onEndReachedThreshold" | "onStartReachedThreshold",
): number {
  const threshold = value ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError(
      `VirtualizedList ${name} must be between 0 and 100 viewport lengths.`,
    );
  }
  return threshold;
}

function virtualizedListOptions(
  value: unknown,
  operation: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(
      `VirtualizedList ${operation} options must be an object.`,
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function virtualizedListAnimated(
  options: Readonly<Record<string, unknown>>,
  operation: string,
): boolean {
  const animated = options.animated ?? true;
  if (typeof animated !== "boolean") {
    throw new TypeError(
      `VirtualizedList ${operation} animated must be a boolean.`,
    );
  }
  return animated;
}

function virtualizedListFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`VirtualizedList ${name} must be a finite number.`);
  }
  return value;
}

function virtualizedListState<Item>(
  data: readonly Item[],
  keyExtractor: (item: Item, index: number) => string,
): VirtualizedListState<Item> {
  const candidate: unknown = data;
  if (!Array.isArray(candidate)) {
    throw new TypeError("VirtualizedList data must be an array.");
  }
  const items = candidate as readonly Item[];
  const keys: string[] = [];
  const indexByKey = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    const key = keyExtractor(item, index);
    if (typeof key !== "string" || key.length === 0 || key.length > 256) {
      throw new TypeError(
        "VirtualizedList keys must be non-empty strings of at most 256 characters.",
      );
    }
    if (indexByKey.has(key)) {
      throw new TypeError(
        `VirtualizedList keyExtractor returned the duplicate key ${JSON.stringify(key)}.`,
      );
    }
    keys.push(key);
    indexByKey.set(key, index);
  }
  return { items, keys, indexByKey };
}

function virtualizedListScrollOffset(
  event: Parameters<NativeEventHandler>[0],
  horizontal: boolean,
): number {
  if (event.name !== "scroll") {
    throw new TypeError("VirtualizedList received a non-scroll event.");
  }
  const payload = event.payload;
  const contentOffset =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Readonly<Record<string, HostValue>>).contentOffset
      : undefined;
  const offset =
    typeof contentOffset === "object" &&
    contentOffset !== null &&
    !Array.isArray(contentOffset)
      ? (contentOffset as Readonly<Record<string, HostValue>>)[
          horizontal ? "x" : "y"
        ]
      : undefined;
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    throw new TypeError(
      "VirtualizedList scroll events must include a finite content offset.",
    );
  }
  return offset;
}

function virtualizedListMeasuredExtent(
  event: Parameters<NativeLayoutEventHandler>[0],
  horizontal: boolean,
): number | undefined {
  if (event.name !== "layout") {
    throw new TypeError("VirtualizedList received a non-layout row event.");
  }
  const payload = hostValueRecord(event.payload);
  const layoutValue = payload?.layout;
  const layout =
    layoutValue === undefined ? undefined : hostValueRecord(layoutValue);
  const extent = finiteHostNumber(layout?.[horizontal ? "width" : "height"]);
  if (extent === undefined || extent < 0) {
    throw new TypeError(
      "VirtualizedList row layout events must include a finite non-negative scroll-axis extent.",
    );
  }
  // Yoga can transiently report zero before intrinsically sized descendants
  // settle. Keep the estimate until a useful positive measurement arrives.
  return extent === 0 ? undefined : extent;
}

function virtualizedListClampedOffset(
  offset: number,
  contentSize: number,
  viewportSize: number,
): number {
  return Math.min(Math.max(0, offset), Math.max(0, contentSize - viewportSize));
}

function virtualizedListVisibleFraction(
  index: number,
  layout: VirtualizedListLayoutModel,
  offset: number,
  viewportSize: number,
): number {
  const itemStart = layout.itemOffset(index);
  const itemLength = layout.itemLength(index);
  if (itemLength <= 0) return 0;
  const visibleLength =
    Math.min(itemStart + itemLength, offset + viewportSize) -
    Math.max(itemStart, offset);
  return Math.min(1, Math.max(0, visibleLength / itemLength));
}

function virtualizedListInitialOffset<Item>(
  state: VirtualizedListState<Item>,
  layout: VirtualizedListLayoutModel,
  viewportSize: number,
  initialScrollIndex: number | undefined,
  initialScrollKey: string | undefined,
): number | undefined {
  if (initialScrollIndex !== undefined && initialScrollKey !== undefined) {
    throw new TypeError(
      "VirtualizedList accepts only one of initialScrollIndex or initialScrollKey.",
    );
  }
  if (initialScrollIndex === undefined && initialScrollKey === undefined) {
    return undefined;
  }
  let index: number;
  if (initialScrollKey !== undefined) {
    if (
      typeof initialScrollKey !== "string" ||
      initialScrollKey.length === 0 ||
      initialScrollKey.length > 256
    ) {
      throw new TypeError(
        "VirtualizedList initialScrollKey must be a non-empty string of at most 256 characters.",
      );
    }
    const resolved = state.indexByKey.get(initialScrollKey);
    if (resolved === undefined) {
      throw new RangeError(
        `VirtualizedList initialScrollKey ${JSON.stringify(initialScrollKey)} is not present in the initial data.`,
      );
    }
    index = resolved;
  } else {
    if (
      typeof initialScrollIndex !== "number" ||
      !Number.isSafeInteger(initialScrollIndex) ||
      initialScrollIndex < 0
    ) {
      throw new RangeError(
        "VirtualizedList initialScrollIndex must be a non-negative safe integer.",
      );
    }
    if (initialScrollIndex >= state.items.length) {
      throw new RangeError(
        `VirtualizedList initialScrollIndex ${String(initialScrollIndex)} is outside ${String(state.items.length)} initial items.`,
      );
    }
    index = initialScrollIndex;
  }
  return virtualizedListClampedOffset(
    layout.itemOffset(index),
    layout.contentSize,
    viewportSize,
  );
}

function virtualizedListAnchoredOffset<Item>(
  previous: VirtualizedListViewModel<Item>,
  state: VirtualizedListState<Item>,
  layout: VirtualizedListLayoutModel,
  policy: Readonly<ScrollViewMaintainVisibleContentPosition>,
): number {
  // Keep the native anchor mounted even inside autoscrollToTopThreshold. The
  // platform first measures that retained view, applies the prepend delta, and
  // then emits its threshold-driven scroll to zero back through handleScroll.
  const firstVisible = Math.max(
    previous.layout.firstVisibleIndex(previous.offset),
    policy.minIndexForVisible,
  );
  const visibleEnd = previous.layout.visibleEndIndex(
    previous.offset + previous.viewportSize,
  );
  for (let index = firstVisible; index < visibleEnd; index++) {
    const key = previous.state.keys[index];
    if (key === undefined) break;
    const nextIndex = state.indexByKey.get(key);
    if (nextIndex === undefined) continue;
    const viewportPosition =
      previous.layout.itemOffset(index) - previous.offset;
    return layout.itemOffset(nextIndex) - viewportPosition;
  }
  return previous.offset;
}

function combinePendingCallbackResults(
  ...results: readonly unknown[]
): PromiseLike<unknown> | undefined {
  const pending = results.filter(
    (result): result is PromiseLike<unknown> =>
      (typeof result === "object" || typeof result === "function") &&
      result !== null &&
      "then" in result &&
      typeof result.then === "function",
  );
  if (pending.length === 1) return pending[0];
  if (pending.length > 1) return Promise.all(pending);
  return undefined;
}

function createVirtualizedList<Item>(
  props: VirtualizedListProps<Item>,
): NativeNode {
  const usesRefreshControl = untrack(() => {
    const configured = [...VIRTUALIZED_LIST_REFRESH_PROPERTIES].some(
      (property) => Reflect.get(props, property, props) !== undefined,
    );
    if (!configured) return false;
    if (typeof props.onRefresh !== "function") {
      throw new TypeError(
        "VirtualizedList pull-to-refresh requires an onRefresh callback.",
      );
    }
    if (typeof props.refreshing !== "boolean") {
      throw new TypeError(
        "VirtualizedList pull-to-refresh requires a controlled refreshing boolean.",
      );
    }
    return true;
  });
  const {
    initialData,
    initialEstimatedItemSize,
    initialGetItemLayout,
    initialHorizontal,
    initialScrollIndex,
    initialScrollKey,
    initialItemSize,
    initialKeyExtractor,
    initialMaintainVisibleContentPosition,
    initialOverscan,
    initialRecycleRowViews,
    initialEndThreshold,
    initialStartThreshold,
    initialViewportSize,
  } = untrack(() => ({
    initialData: props.data,
    initialEstimatedItemSize: props.estimatedItemSize,
    initialGetItemLayout: props.getItemLayout,
    initialHorizontal: props.horizontal === true,
    initialScrollIndex: props.initialScrollIndex,
    initialScrollKey: props.initialScrollKey,
    initialItemSize: props.itemSize,
    initialKeyExtractor: props.keyExtractor,
    initialMaintainVisibleContentPosition: props.maintainVisibleContentPosition,
    initialOverscan: props.overscan,
    initialRecycleRowViews: props.recycleRowViews,
    initialEndThreshold: props.onEndReachedThreshold,
    initialStartThreshold: props.onStartReachedThreshold,
    initialViewportSize: props.viewportSize,
  }));
  positiveListExtent(initialViewportSize, "viewportSize");
  virtualizedListOverscan(initialOverscan);
  virtualizedListThreshold(initialEndThreshold, "onEndReachedThreshold");
  virtualizedListThreshold(initialStartThreshold, "onStartReachedThreshold");
  if (
    initialRecycleRowViews !== undefined &&
    typeof initialRecycleRowViews !== "boolean"
  ) {
    throw new TypeError("VirtualizedList recycleRowViews must be a boolean.");
  }
  const initialState = virtualizedListState(initialData, initialKeyExtractor);
  const measuredItemSizes = new Map<string, number>();
  const initialLayout = virtualizedListLayout(
    initialState.items,
    initialState.keys,
    initialItemSize,
    initialGetItemLayout,
    initialEstimatedItemSize,
    measuredItemSizes,
  );
  const normalizedInitialMaintainVisibleContentPosition =
    normalizedMaintainVisibleContentPosition(
      initialMaintainVisibleContentPosition,
    );
  const initialScrollOffset = virtualizedListInitialOffset(
    initialState,
    initialLayout,
    initialViewportSize,
    initialScrollIndex,
    initialScrollKey,
  );
  const initialContentOffset =
    initialScrollOffset === undefined
      ? undefined
      : initialHorizontal
        ? { x: initialScrollOffset, y: 0 }
        : { x: 0, y: initialScrollOffset };
  let canUseInitialState = true;
  let canUseInitialLayout = true;
  let canUseInitialMaintainVisibleContentPosition = true;

  const [scrollInput, setScrollInput] =
    createSignal<VirtualizedListScrollInput>({
      offset: initialScrollOffset ?? 0,
    });
  const [measurementRevision, setMeasurementRevision] = createSignal(0);
  const viewportSize = createMemo(() =>
    positiveListExtent(props.viewportSize, "viewportSize"),
  );
  const overscan = createMemo(() => virtualizedListOverscan(props.overscan));
  const endThreshold = createMemo(() =>
    virtualizedListThreshold(
      props.onEndReachedThreshold,
      "onEndReachedThreshold",
    ),
  );
  const startThreshold = createMemo(() =>
    virtualizedListThreshold(
      props.onStartReachedThreshold,
      "onStartReachedThreshold",
    ),
  );
  const maintainVisibleContentPosition = createMemo(() => {
    const current = props.maintainVisibleContentPosition;
    if (
      canUseInitialMaintainVisibleContentPosition &&
      current === initialMaintainVisibleContentPosition
    ) {
      canUseInitialMaintainVisibleContentPosition = false;
      return normalizedInitialMaintainVisibleContentPosition;
    }
    canUseInitialMaintainVisibleContentPosition = false;
    return normalizedMaintainVisibleContentPosition(current);
  });
  const state = createMemo(() => {
    const data = props.data;
    const keyExtractor = props.keyExtractor;
    if (
      canUseInitialState &&
      data === initialData &&
      keyExtractor === initialKeyExtractor
    ) {
      canUseInitialState = false;
      return initialState;
    }
    canUseInitialState = false;
    return virtualizedListState(data, keyExtractor);
  });
  const layout = createMemo(() => {
    const current = state();
    const itemSize = props.itemSize;
    const getItemLayout = props.getItemLayout;
    const estimatedItemSize = props.estimatedItemSize;
    if (estimatedItemSize !== undefined) measurementRevision();
    for (const key of measuredItemSizes.keys()) {
      if (!current.indexByKey.has(key)) measuredItemSizes.delete(key);
    }
    if (
      canUseInitialLayout &&
      current === initialState &&
      itemSize === initialItemSize &&
      getItemLayout === initialGetItemLayout &&
      estimatedItemSize === initialEstimatedItemSize
    ) {
      canUseInitialLayout = false;
      return initialLayout;
    }
    canUseInitialLayout = false;
    return virtualizedListLayout(
      current.items,
      current.keys,
      itemSize,
      getItemLayout,
      estimatedItemSize,
      measuredItemSizes,
    );
  });
  const contentSize = createMemo(() => layout().contentSize);
  const viewModel = createMemo<VirtualizedListViewModel<Item>>((previous) => {
    const input = scrollInput();
    const currentState = state();
    const currentLayout = layout();
    const currentViewportSize = viewportSize();
    const policy = maintainVisibleContentPosition();
    let offset = previous?.offset ?? input.offset;
    if (previous === undefined || input !== previous.input) {
      offset = input.offset;
    } else if (
      policy !== undefined &&
      (currentState !== previous.state || currentLayout !== previous.layout)
    ) {
      offset = virtualizedListAnchoredOffset(
        previous,
        currentState,
        currentLayout,
        policy,
      );
    }
    return {
      input,
      state: currentState,
      layout: currentLayout,
      offset: virtualizedListClampedOffset(
        offset,
        currentLayout.contentSize,
        currentViewportSize,
      ),
      viewportSize: currentViewportSize,
    };
  });
  const scrollOffset = createMemo(() => viewModel().offset);
  const visibleKeys = createMemo<readonly string[]>(() => {
    const offset = scrollOffset();
    const { keys } = state();
    if (keys.length === 0) return [];
    const geometry = layout();
    const firstVisible = geometry.firstVisibleIndex(offset);
    const visibleEnd = geometry.visibleEndIndex(offset + viewportSize());
    const retained = overscan();
    const start = Math.max(0, firstVisible - retained);
    const end = Math.min(
      keys.length,
      Math.max(visibleEnd, Math.min(keys.length, firstVisible + 1)) + retained,
    );
    return keys.slice(start, end);
  });
  const nativeMaintainVisibleContentPosition = createMemo<
    Readonly<ScrollViewMaintainVisibleContentPosition> | undefined
  >(() => {
    const policy = maintainVisibleContentPosition();
    if (policy === undefined) return undefined;
    const current = state();
    const mountedIndex = visibleKeys().findIndex((key) => {
      const logicalIndex = current.indexByKey.get(key);
      return (
        logicalIndex !== undefined && logicalIndex >= policy.minIndexForVisible
      );
    });
    if (mountedIndex < 0) return undefined;
    return policy.autoscrollToTopThreshold === undefined
      ? { minIndexForVisible: mountedIndex }
      : {
          minIndexForVisible: mountedIndex,
          autoscrollToTopThreshold: policy.autoscrollToTopThreshold,
        };
  });
  const createRowBindings = (
    readKey: Accessor<string>,
    toleratePendingReassignment = false,
  ) => {
    let lastIndex: number | undefined;
    let lastItem: Item | undefined;
    let hasLastItem = false;
    const index = createMemo(() => {
      const key = readKey();
      const value = state().indexByKey.get(key);
      if (value === undefined) {
        if (toleratePendingReassignment && lastIndex !== undefined) {
          return lastIndex;
        }
        throw new Error("A mounted VirtualizedList key disappeared from data.");
      }
      lastIndex = value;
      return value;
    });
    const item = createMemo(() => {
      const current = state();
      const key = readKey();
      const itemIndex = current.indexByKey.get(key);
      if (itemIndex === undefined) {
        if (toleratePendingReassignment && hasLastItem) {
          return lastItem as Item;
        }
        throw new Error("A mounted VirtualizedList item is unavailable.");
      }
      if (itemIndex < 0 || itemIndex >= current.items.length) {
        throw new Error("A mounted VirtualizedList item is unavailable.");
      }
      const value = current.items[itemIndex] as Item;
      lastItem = value;
      hasLastItem = true;
      return value;
    });
    const visibleFraction = createMemo(() =>
      virtualizedListVisibleFraction(
        index(),
        layout(),
        scrollOffset(),
        viewportSize(),
      ),
    );
    const isVisible = createMemo(() => visibleFraction() > 0);
    return { index, isVisible, item, visibleFraction };
  };
  const createRowView = (
    readKey: Accessor<string>,
    index: Accessor<number>,
    content: unknown,
    minimumObservedSequence: Accessor<number> = () => 0,
  ): NativeNode => {
    const row = createElement("View");
    insert(row, content);
    const handleLayout: NativeLayoutEventHandler = (event) => {
      if (!layout().measuresItems) return;
      if (event.observedSequence < minimumObservedSequence()) return;
      const key = readKey();
      const extent = virtualizedListMeasuredExtent(
        event,
        props.horizontal === true,
      );
      if (extent === undefined || measuredItemSizes.get(key) === extent) return;
      measuredItemSizes.set(key, extent);
      setMeasurementRevision((revision) =>
        revision >= Number.MAX_SAFE_INTEGER ? 0 : revision + 1,
      );
    };
    spread(row, {
      collapsable: false,
      get onLayout() {
        return layout().measuresItems ? handleLayout : undefined;
      },
      get style(): NativeStyle {
        readKey();
        const itemIndex = index();
        const geometry = layout();
        const offset = geometry.itemOffset(itemIndex);
        const length = geometry.itemLength(itemIndex);
        return props.horizontal
          ? geometry.measuresItems
            ? {
                bottom: 0,
                left: offset,
                position: "absolute",
                top: 0,
              }
            : {
                bottom: 0,
                left: offset,
                position: "absolute",
                top: 0,
                width: length,
              }
          : geometry.measuresItems
            ? {
                left: 0,
                position: "absolute",
                right: 0,
                top: offset,
              }
            : {
                height: length,
                left: 0,
                position: "absolute",
                right: 0,
                top: offset,
              };
      },
    });
    return row;
  };
  let rows: Accessor<readonly NativeNode[]>;
  if (initialRecycleRowViews === true) {
    interface RecycledRowSlot {
      readonly key: Accessor<string>;
      readonly setKey: (key: string) => void;
      minimumObservedSequence: number;
      row?: NativeNode;
    }
    let recycledSlotsByKey = new Map<string, RecycledRowSlot>();
    const [recycledSlots, setRecycledSlots] = createSignal<
      readonly RecycledRowSlot[]
    >([], { ownedWrite: true });
    effect(visibleKeys, (keys) => {
      const nextKeys = new Set(keys);
      const available = [...recycledSlotsByKey]
        .filter(([key]) => !nextKeys.has(key))
        .map(([, slot]) => slot);
      const nextSlotsByKey = new Map<string, RecycledRowSlot>();
      const ordered = keys.map((key) => {
        let slot = recycledSlotsByKey.get(key);
        if (slot === undefined) {
          slot = available.shift();
          if (slot === undefined) {
            const [slotKey, setSlotKey] = createSignal(key, {
              ownedWrite: true,
            });
            slot = {
              key: slotKey,
              setKey: setSlotKey,
              minimumObservedSequence: 0,
            };
          } else {
            slot.minimumObservedSequence =
              slot.row === undefined
                ? 0
                : nativeNodeRoot(slot.row).lastCommittedSequence + 1;
            slot.setKey(key);
          }
        }
        nextSlotsByKey.set(key, slot);
        return slot;
      });
      recycledSlotsByKey = nextSlotsByKey;
      setRecycledSlots(ordered);
    });
    rows = mapArray(recycledSlots, (slot) => {
      const rowBindings = createRowBindings(slot.key, true);
      const content = mapArray(
        () => [slot.key()],
        (key) => {
          const readKey = () => key;
          const { index, isVisible, item, visibleFraction } = createRowBindings(
            readKey,
            true,
          );
          return props.renderItem({
            item,
            index,
            isVisible,
            key,
            visibleFraction,
          });
        },
      );
      const row = createRowView(
        slot.key,
        rowBindings.index,
        content,
        () => slot.minimumObservedSequence,
      );
      slot.row = row;
      return row;
    });
  } else {
    rows = mapArray(visibleKeys, (key) => {
      const readKey = () => key;
      const { index, isVisible, item, visibleFraction } =
        createRowBindings(readKey);
      return createRowView(
        readKey,
        index,
        props.renderItem({ item, index, isVisible, key, visibleFraction }),
      );
    });
  }
  let endReachedContent: string | undefined;
  let startReachedContent: string | undefined;
  const handleScroll: NativeEventHandler = (event) => {
    const offset = virtualizedListScrollOffset(
      event,
      props.horizontal === true,
    );
    setScrollInput({ offset });
    const current = state();
    const firstKey = current.keys.at(0);
    const lastKey = current.keys.at(-1);
    const currentContentSize = contentSize();
    const endContentIdentity = `${String(current.items.length)}:${JSON.stringify(lastKey)}:${String(currentContentSize)}`;
    const startContentIdentity = `${String(current.items.length)}:${JSON.stringify(firstKey)}:${String(currentContentSize)}`;
    const boundedOffset = virtualizedListClampedOffset(
      offset,
      currentContentSize,
      viewportSize(),
    );
    const distanceFromEnd = Math.max(
      0,
      currentContentSize - (boundedOffset + viewportSize()),
    );
    const distanceFromStart = boundedOffset;
    const shouldReportEnd =
      current.items.length > 0 &&
      props.onEndReached !== undefined &&
      distanceFromEnd <= endThreshold() * viewportSize() &&
      endContentIdentity !== endReachedContent;
    const shouldReportStart =
      current.items.length > 0 &&
      props.onStartReached !== undefined &&
      distanceFromStart <= startThreshold() * viewportSize() &&
      startContentIdentity !== startReachedContent;
    if (shouldReportEnd) {
      endReachedContent = endContentIdentity;
    }
    if (shouldReportStart) {
      startReachedContent = startContentIdentity;
    }
    const scrollResult = props.onScroll?.(event);
    const endReachedResult = shouldReportEnd
      ? props.onEndReached?.({ distanceFromEnd })
      : undefined;
    const startReachedResult = shouldReportStart
      ? props.onStartReached?.({ distanceFromStart })
      : undefined;
    return combinePendingCallbackResults(
      scrollResult,
      endReachedResult,
      startReachedResult,
    );
  };

  const listProperties = new Set<string | symbol>([
    ...VIRTUALIZED_LIST_REFRESH_PROPERTIES,
    "data",
    "estimatedItemSize",
    "getItemLayout",
    "initialScrollIndex",
    "initialScrollKey",
    "itemSize",
    "keyExtractor",
    "maintainVisibleContentPosition",
    "onEndReached",
    "onEndReachedThreshold",
    "onStartReached",
    "onStartReachedThreshold",
    "overscan",
    "recycleRowViews",
    "ref",
    "renderItem",
    "viewportSize",
  ]);
  const nativeProperties = new Set<string | symbol>([
    "children",
    "contentContainerStyle",
    "maintainVisibleContentPosition",
    "onScroll",
    "scrollEventThrottle",
    "style",
  ]);
  if (initialContentOffset !== undefined) {
    nativeProperties.add("contentOffset");
  }
  const scrollProps = new Proxy({} as ScrollViewProps, {
    get(_target, property) {
      if (property === "contentOffset") return initialContentOffset;
      if (property === "maintainVisibleContentPosition") {
        return nativeMaintainVisibleContentPosition();
      }
      if (listProperties.has(property)) return undefined;
      if (property === "children") return rows();
      if (property === "contentContainerStyle") {
        return props.horizontal
          ? { position: "relative", width: contentSize() }
          : { height: contentSize(), position: "relative" };
      }
      if (property === "onScroll") return handleScroll;
      if (property === "scrollEventThrottle") {
        return props.scrollEventThrottle ?? 16;
      }
      if (property === "style") {
        return [
          props.style,
          props.horizontal
            ? { flexGrow: 0, flexShrink: 0, width: viewportSize() }
            : { flexGrow: 0, flexShrink: 0, height: viewportSize() },
        ];
      }
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === "maintainVisibleContentPosition") {
        return { configurable: true, enumerable: true };
      }
      if (listProperties.has(property)) return undefined;
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !listProperties.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
    has(_target, property) {
      return property === "maintainVisibleContentPosition"
        ? true
        : Reflect.has(props, property);
    },
  });
  let root: NativeNode;
  let scrollView: NativeNode;
  if (usesRefreshControl) {
    const refreshableScrollProps = new Proxy({} as RefreshableScrollViewProps, {
      get(_target, property) {
        return VIRTUALIZED_LIST_REFRESH_PROPERTIES.has(property)
          ? Reflect.get(props, property, props)
          : Reflect.get(scrollProps, property, scrollProps);
      },
      getOwnPropertyDescriptor(_target, property) {
        if (VIRTUALIZED_LIST_REFRESH_PROPERTIES.has(property)) {
          return { configurable: true, enumerable: true };
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(
          scrollProps,
          property,
        );
        return descriptor === undefined
          ? undefined
          : { ...descriptor, configurable: true };
      },
      ownKeys() {
        const keys = Reflect.ownKeys(scrollProps);
        for (const property of VIRTUALIZED_LIST_REFRESH_PROPERTIES) {
          if (!keys.includes(property)) keys.push(property);
        }
        return keys;
      },
    });
    const tree = createRefreshableScrollViewTree(refreshableScrollProps);
    root = tree.root;
    scrollView = tree.scrollView;
  } else {
    scrollView = createScrollView(scrollProps);
    root = scrollView;
  }
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const assertHandleActive = (): void => {
    if (disposed) {
      throw new Error("VirtualizedList handle has been disposed.");
    }
  };
  let imperativeTail = Promise.resolve();
  const scheduleScroll = (
    resolveRequestedOffset: () => number,
    animated: boolean,
  ): Promise<void> => {
    const execute = async (): Promise<void> => {
      assertHandleActive();
      const maximumOffset = Math.max(0, contentSize() - viewportSize());
      const offset = Math.min(
        Math.max(0, resolveRequestedOffset()),
        maximumOffset,
      );
      setScrollInput({ offset });
      // The target rows must exist on the platform before the ScrollView moves
      // to them. Keep that structural revision separate from the command-only
      // transaction and wait for its native mount acknowledgement.
      await flushNativeNodeMount(scrollView);
      assertHandleActive();
      await scrollView.dispatchCommand(
        "scrollTo",
        props.horizontal ? offset : 0,
        props.horizontal ? 0 : offset,
        animated,
      );
    };
    const pending = imperativeTail.then(execute, execute);
    imperativeTail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  const alignedItemOffset = (
    index: number,
    viewOffset: number,
    viewPosition: number,
  ): number => {
    const geometry = layout();
    const extent = geometry.itemLength(index);
    return (
      geometry.itemOffset(index) -
      viewPosition * (viewportSize() - extent) -
      viewOffset
    );
  };
  const handle: VirtualizedListHandle = Object.freeze({
    nativeNode: scrollView,
    scrollToEnd(options: VirtualizedListScrollOptions = {}) {
      const candidate = virtualizedListOptions(options, "scrollToEnd");
      const animated = virtualizedListAnimated(candidate, "scrollToEnd");
      return scheduleScroll(
        () => Math.max(0, contentSize() - viewportSize()),
        animated,
      );
    },
    scrollToIndex(options: VirtualizedListScrollToIndexOptions) {
      const candidate = virtualizedListOptions(options, "scrollToIndex");
      const index = candidate.index;
      if (!Number.isSafeInteger(index) || (index as number) < 0) {
        throw new RangeError(
          "VirtualizedList scrollToIndex index must be a non-negative safe integer.",
        );
      }
      const viewOffset = virtualizedListFiniteNumber(
        candidate.viewOffset ?? 0,
        "scrollToIndex viewOffset",
      );
      const viewPosition = virtualizedListFiniteNumber(
        candidate.viewPosition ?? 0,
        "scrollToIndex viewPosition",
      );
      if (viewPosition < 0 || viewPosition > 1) {
        throw new RangeError(
          "VirtualizedList scrollToIndex viewPosition must be between 0 and 1.",
        );
      }
      const animated = virtualizedListAnimated(candidate, "scrollToIndex");
      return scheduleScroll(() => {
        const length = state().items.length;
        if ((index as number) >= length) {
          throw new RangeError(
            `VirtualizedList scrollToIndex index ${String(index)} is outside ${String(length)} items.`,
          );
        }
        return alignedItemOffset(index as number, viewOffset, viewPosition);
      }, animated);
    },
    scrollToKey(options: VirtualizedListScrollToKeyOptions) {
      const candidate = virtualizedListOptions(options, "scrollToKey");
      const key = candidate.key;
      if (typeof key !== "string" || key.length === 0 || key.length > 256) {
        throw new TypeError(
          "VirtualizedList scrollToKey key must be a non-empty string of at most 256 characters.",
        );
      }
      const viewOffset = virtualizedListFiniteNumber(
        candidate.viewOffset ?? 0,
        "scrollToKey viewOffset",
      );
      const viewPosition = virtualizedListFiniteNumber(
        candidate.viewPosition ?? 0,
        "scrollToKey viewPosition",
      );
      if (viewPosition < 0 || viewPosition > 1) {
        throw new RangeError(
          "VirtualizedList scrollToKey viewPosition must be between 0 and 1.",
        );
      }
      const animated = virtualizedListAnimated(candidate, "scrollToKey");
      return scheduleScroll(() => {
        const index = state().indexByKey.get(key);
        if (index === undefined) {
          throw new RangeError(
            `VirtualizedList scrollToKey key ${JSON.stringify(key)} is not present in the latest data.`,
          );
        }
        return alignedItemOffset(index, viewOffset, viewPosition);
      }, animated);
    },
    scrollToOffset(options: VirtualizedListScrollToOffsetOptions) {
      const candidate = virtualizedListOptions(options, "scrollToOffset");
      const offset = virtualizedListFiniteNumber(
        candidate.offset,
        "scrollToOffset offset",
      );
      if (offset < 0) {
        throw new RangeError(
          "VirtualizedList scrollToOffset offset must be non-negative.",
        );
      }
      const animated = virtualizedListAnimated(candidate, "scrollToOffset");
      return scheduleScroll(() => offset, animated);
    },
  });
  props.ref?.(handle);
  return root;
}

const ACTIVITY_INDICATOR_CONTAINER_STYLE: NativeStyle = {
  alignItems: "center",
  justifyContent: "center",
};

interface NativeActivityIndicatorProps extends Omit<
  ActivityIndicatorProps,
  "size" | "style"
> {
  readonly animating: boolean;
  readonly hidesWhenStopped: boolean;
  readonly size?: "small" | "large";
  readonly style: StyleProp;
}

function activityIndicatorNativeProps(
  props: ActivityIndicatorProps,
  nativeStyle: () => StyleProp,
): NativeActivityIndicatorProps {
  const overriddenProperties = new Set<string | symbol>([
    "animating",
    "hidesWhenStopped",
    "size",
    "style",
  ]);
  return new Proxy({} as NativeActivityIndicatorProps, {
    get(_target, property) {
      if (property === "animating") return props.animating ?? true;
      if (property === "hidesWhenStopped") {
        return props.hidesWhenStopped ?? true;
      }
      if (property === "size") {
        const size = props.size ?? "small";
        return typeof size === "number" ? undefined : size;
      }
      if (property === "style") return nativeStyle();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (overriddenProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props);
      for (const property of overriddenProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
}

function createActivityIndicator(props: ActivityIndicatorProps): NativeNode {
  const container = createElement("View");
  const indicator = createElement("ActivityIndicator");
  const size = createMemo(() => props.size ?? "small");
  const nativeStyle = createMemo<StyleProp>(() => {
    const value = size();
    const dimension = value === "small" ? 20 : value === "large" ? 36 : value;
    return { height: dimension, width: dimension };
  });
  const containerStyle = createMemo<StyleProp>(() => [
    ACTIVITY_INDICATOR_CONTAINER_STYLE,
    props.style,
  ]);
  spread(indicator, activityIndicatorNativeProps(props, nativeStyle));
  insert(container, indicator);
  spread(container, {
    get style() {
      return containerStyle();
    },
  });
  return container;
}

const SWITCH_BASE_STYLE: NativeStyle = {
  alignSelf: "flex-start",
};

interface NativeSwitchProps extends Omit<
  SwitchProps,
  "iosBackgroundColor" | "onChange" | "onValueChange" | "trackColor"
> {
  readonly accessibilityRole: "switch";
  readonly disabled: boolean;
  readonly iosBackgroundColor?: string;
  readonly onValueChange: NativeEventHandler;
  readonly trackColorForFalse?: string;
  readonly trackColorForTrue?: string;
  readonly value: boolean;
}

function nativeSwitchValue(event: Parameters<NativeEventHandler>[0]): boolean {
  const payload = event.payload;
  const value =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Readonly<Record<string, HostValue>>).value
      : undefined;
  if (typeof value !== "boolean") {
    throw new TypeError("Native Switch events must include a boolean value.");
  }
  return value;
}

function createSwitch(props: SwitchProps): NativeNode {
  const nativeSwitch = createElement("Switch");
  const [lastNativeValue, setLastNativeValue] = createSignal<
    boolean | undefined
  >(undefined);
  const [nativeChangeRevision, setNativeChangeRevision] = createSignal(0);
  const disabled = createMemo(
    () => props.disabled ?? props.accessibilityState?.disabled ?? false,
  );
  const value = createMemo(() => props.value === true);
  const style = createMemo<StyleProp>(() => [SWITCH_BASE_STYLE, props.style]);
  const accessibilityState = createMemo(() => ({
    ...props.accessibilityState,
    checked: value(),
    disabled: disabled(),
  }));
  const handleValueChange: NativeEventHandler = (event) => {
    const nextValue = nativeSwitchValue(event);
    setLastNativeValue(nextValue);
    setNativeChangeRevision((revision) => revision + 1);
    props.onChange?.(event);
    void props.onValueChange?.(nextValue);
  };

  // React Native's platform switch changes itself before notifying
  // JavaScript. A controlled Solid value that rejects that change must be
  // restored through the platform command even when repeated native events
  // report the same boolean.
  effect(
    () => {
      nativeChangeRevision();
      const observed = lastNativeValue();
      const desired = value();
      return observed !== undefined && observed !== desired
        ? desired
        : undefined;
    },
    (desired) => {
      if (desired === undefined) return;
      void nativeSwitch.dispatchCommand("setValue", desired);
    },
  );

  const translatedProperties = new Set<string | symbol>([
    "iosBackgroundColor",
    "onChange",
    "trackColor",
  ]);
  const nativeProperties = new Set<string | symbol>([
    "accessibilityRole",
    "accessibilityState",
    "disabled",
    "iosBackgroundColor",
    "onValueChange",
    "style",
    "trackColorForFalse",
    "trackColorForTrue",
    "value",
  ]);
  const nativeProps = new Proxy({} as NativeSwitchProps, {
    get(_target, property) {
      if (property === "onChange" || property === "trackColor") {
        return undefined;
      }
      if (property === "accessibilityRole") {
        return props.accessibilityRole ?? "switch";
      }
      if (property === "accessibilityState") return accessibilityState();
      if (property === "disabled") return disabled();
      if (property === "iosBackgroundColor") {
        return props.iosBackgroundColor;
      }
      if (property === "onValueChange") return handleValueChange;
      if (property === "style") return style();
      if (property === "trackColorForFalse") return props.trackColor?.false;
      if (property === "trackColorForTrue") return props.trackColor?.true;
      if (property === "value") return value();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === "onChange" || property === "trackColor") {
        return undefined;
      }
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !translatedProperties.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
  spread(nativeSwitch, nativeProps);
  return nativeSwitch;
}

const MODAL_PORTAL_STYLE: NativeStyle = {
  height: 0,
  width: 0,
};

const MODAL_HOST_STYLE: NativeStyle = {
  position: "absolute",
};

const MODAL_CONTENT_STYLE: NativeStyle = {
  backgroundColor: "#ffffff",
  flex: 1,
  left: 0,
  top: 0,
};

interface NativeModalHostProps {
  readonly allowSwipeDismissal: boolean;
  readonly animationType: "none" | "slide" | "fade";
  readonly hardwareAccelerated: boolean;
  readonly navigationBarTranslucent: boolean;
  readonly onDismiss?: NativeEventHandler | undefined;
  readonly onOrientationChange?: NativeEventHandler | undefined;
  readonly onRequestClose?: NativeEventHandler | undefined;
  readonly onShow?: NativeEventHandler | undefined;
  readonly presentationStyle:
    "fullScreen" | "pageSheet" | "formSheet" | "overFullScreen";
  readonly ref?: NativeRef | undefined;
  readonly statusBarTranslucent: boolean;
  readonly style: NativeStyle;
  readonly supportedOrientations?:
    ModalProps["supportedOrientations"] | undefined;
  readonly testID?: string | undefined;
  readonly transparent: boolean;
  readonly visible: boolean;
}

function createModal(props: ModalProps): NativeNode {
  const portal = createElement("View");
  // A hidden modal is parked under a deliberately unmounted logical View.
  // Android parks after the false prop mounts; iOS parks only after UIKit's
  // asynchronous dismissal event has used the still-mounted event route.
  const parking = createElement("View");
  const modal = createElement("Modal");
  const platform = nativeNodePlatform(modal);
  if (platform !== "android" && platform !== "ios") {
    throw new Error(
      `Modal requires an android or ios host platform, received ${JSON.stringify(platform)}.`,
    );
  }
  if (platform === "android" && props.onRequestClose === undefined) {
    throw new TypeError("An Android Modal requires an onRequestClose handler.");
  }
  const content = createElement("View");
  const visible = createMemo(() => props.visible !== false);
  const [mounted, setMounted] = createSignal(untrack(visible), {
    ownedWrite: true,
  });
  let visibilityRevision = 0;
  let notifiedHiddenRevision = -1;
  let nativeDismissed = false;
  let dismissalNotified = false;
  let disposed = false;
  const notifyHiddenAfterMount = (): void => {
    void flushNativeNodeMount(portal)
      .then(() => {
        const revision = visibilityRevision;
        if (
          disposed ||
          notifiedHiddenRevision === revision ||
          untrack(visible)
        ) {
          return;
        }
        notifiedHiddenRevision = revision;
        props.onHidden?.();
      })
      .catch((error: unknown) => {
        if (!disposed) throw error;
      });
  };
  const transparent = createMemo(() => props.transparent === true);
  const presentationStyle = createMemo(() => {
    const requested = props.presentationStyle;
    if (
      transparent() &&
      requested !== undefined &&
      requested !== "overFullScreen"
    ) {
      throw new TypeError(
        `A transparent Modal cannot use presentationStyle ${JSON.stringify(requested)}.`,
      );
    }
    return requested ?? (transparent() ? "overFullScreen" : "fullScreen");
  });
  const statusBarTranslucent = createMemo(
    () => props.statusBarTranslucent === true,
  );
  const navigationBarTranslucent = createMemo(() => {
    const requested = props.navigationBarTranslucent === true;
    if (requested && !statusBarTranslucent()) {
      throw new TypeError(
        "A navigation-bar-translucent Modal must also be status-bar translucent.",
      );
    }
    return requested;
  });
  const allowSwipeDismissal = createMemo(() => {
    const requested = props.allowSwipeDismissal === true;
    if (requested && props.onRequestClose === undefined) {
      throw new TypeError(
        "A swipe-dismissible Modal requires an onRequestClose handler.",
      );
    }
    return requested;
  });
  const contentStyle = createMemo<StyleProp>(() => [
    MODAL_CONTENT_STYLE,
    props.style,
    transparent()
      ? { backgroundColor: "transparent" }
      : props.backdropColor === undefined
        ? undefined
        : { backgroundColor: props.backdropColor },
  ]);

  const contentProps = {
    collapsable: false,
    get accessible() {
      return props.accessible;
    },
    get accessibilityHint() {
      return props.accessibilityHint;
    },
    get accessibilityLabel() {
      return props.accessibilityLabel;
    },
    get accessibilityRole() {
      return props.accessibilityRole;
    },
    get accessibilityState() {
      return props.accessibilityState;
    },
    get hidden() {
      return props.hidden;
    },
    get nativeID() {
      return props.nativeID;
    },
    get style() {
      return contentStyle();
    },
  };
  insert(content, props.children);
  spread(content, contentProps, true);
  insert(modal, content);

  const completeNativeDismissal = (event: NativeSyntheticEvent): void => {
    // React Native 0.87 reports an allowed interactive iOS dismissal through
    // requestClose after UIAdaptivePresentationControllerDelegate.didDismiss,
    // but does not emit the ModalHostView dismiss event for that path. Treat
    // both native signals as the same completed dismissal and de-duplicate a
    // late dismiss event so the portable facade preserves one lifecycle.
    nativeDismissed = true;
    try {
      if (!dismissalNotified) {
        dismissalNotified = true;
        props.onDismiss?.(event);
      }
    } finally {
      // Application-controlled dismissal already made the false visibility
      // revision observable before UIKit completed. Park synchronously so a
      // caller flushing directly after the native event waits for the move,
      // rather than racing a promise continuation that has not scheduled it
      // yet.
      if (!untrack(visible)) {
        setMounted(false);
        notifyHiddenAfterMount();
        return;
      }
      // A navigation owner may publish controlled visibility through an
      // owned write. Flush that work before deciding whether UIKit's already
      // completed dismissal can park the host.
      void flushNativeNodeMount(portal)
        .then(() => {
          if (disposed) return;
          if (untrack(visible)) {
            nativeDismissed = false;
            return;
          }
          setMounted(false);
          notifyHiddenAfterMount();
        })
        .catch((error: unknown) => {
          if (!disposed) throw error;
        });
    }
  };

  const modalProps: NativeModalHostProps = {
    get allowSwipeDismissal() {
      return allowSwipeDismissal();
    },
    get animationType() {
      return props.animationType ?? "none";
    },
    get hardwareAccelerated() {
      return props.hardwareAccelerated === true;
    },
    get navigationBarTranslucent() {
      return navigationBarTranslucent();
    },
    onDismiss: completeNativeDismissal,
    get onOrientationChange() {
      return props.onOrientationChange;
    },
    get onRequestClose() {
      if (props.onRequestClose === undefined) return undefined;
      return (event: NativeSyntheticEvent): void => {
        const completedInteractiveDismissal =
          platform === "ios" && untrack(allowSwipeDismissal);
        try {
          props.onRequestClose?.(event);
        } finally {
          if (completedInteractiveDismissal) {
            completeNativeDismissal(event);
          }
        }
      };
    },
    get onShow() {
      return props.onShow;
    },
    get presentationStyle() {
      return presentationStyle();
    },
    get ref() {
      return props.ref;
    },
    get statusBarTranslucent() {
      return statusBarTranslucent();
    },
    style: MODAL_HOST_STYLE,
    get supportedOrientations() {
      return props.supportedOrientations;
    },
    get testID() {
      return props.testID;
    },
    get transparent() {
      return transparent();
    },
    get visible() {
      return visible();
    },
  };
  spread(modal, modalProps);

  insert(portal, () => (mounted() ? modal : undefined));
  insert(parking, () => (mounted() ? undefined : modal));
  onCleanup(() => {
    disposed = true;
    releaseDetachedNativeNode(parking);
  });
  effect(visible, (nextVisible) => {
    const revision = ++visibilityRevision;
    if (nextVisible) {
      nativeDismissed = false;
      dismissalNotified = false;
      setMounted(true);
      return;
    }
    if (platform === "ios") {
      if (nativeDismissed) {
        setMounted(false);
        notifyHiddenAfterMount();
      }
      return;
    }
    if (!untrack(mounted)) return;
    void flushNativeNodeMount(modal)
      .then(async () => {
        if (
          platform === "android" &&
          !disposed &&
          revision === visibilityRevision &&
          !untrack(visible)
        ) {
          setMounted(false);
          await flushNativeNodeMount(portal);
          if (
            !disposed &&
            revision === visibilityRevision &&
            !untrack(visible)
          ) {
            notifiedHiddenRevision = revision;
            props.onHidden?.();
          }
        }
      })
      .catch((error: unknown) => {
        if (!disposed) throw error;
      });
  });
  spread(portal, {
    collapsable: false,
    pointerEvents: "box-none",
    style: MODAL_PORTAL_STYLE,
  } satisfies ViewProps);
  return portal;
}

const SCREEN_BASE_STYLE: NativeStyle = {
  flex: 1,
};

type ScreenTranslatedProp =
  "name" | "presentation" | keyof ScreenSheetPresentationProps;

interface NativeScreenProps extends Omit<ScreenProps, ScreenTranslatedProp> {
  readonly screenId?: string;
  readonly stackPresentation?: "push" | "modal" | "formSheet";
  readonly sheetAllowedDetents?: readonly number[];
  readonly sheetInitialDetent?: number;
  readonly sheetLargestUndimmedDetent?: number;
  readonly sheetGrabberVisible?: boolean;
  readonly sheetCornerRadius?: number;
  readonly sheetExpandsWhenScrolledToEdge?: boolean;
  readonly sheetElevation?: number;
  readonly sheetShouldOverflowTopInset?: boolean;
  readonly sheetDefaultResizeAnimationEnabled?: boolean;
}

interface NormalizedScreenSheetPresentation {
  readonly sheetAllowedDetents: readonly number[];
  readonly sheetInitialDetent: number;
  readonly sheetLargestUndimmedDetent: number;
  readonly sheetGrabberVisible: boolean;
  readonly sheetCornerRadius: number;
  readonly sheetExpandsWhenScrolledToEdge: boolean;
  readonly sheetElevation: number;
  readonly sheetShouldOverflowTopInset: boolean;
  readonly sheetDefaultResizeAnimationEnabled: boolean;
}

const SCREEN_SHEET_PUBLIC_PROPERTIES = Object.freeze([
  "sheetAllowedDetents",
  "sheetInitialDetent",
  "sheetLargestUndimmedDetent",
  "sheetGrabberVisible",
  "sheetCornerRadius",
  "sheetExpandsWhenScrolledToEdge",
  "sheetElevation",
  "sheetShouldOverflowTopInset",
  "sheetDefaultResizeAnimationEnabled",
] as const satisfies readonly (keyof ScreenSheetPresentationProps)[]);

function screenSheetFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Screen ${name} must be a finite number.`);
  }
  return value;
}

function screenSheetBoolean(
  value: boolean | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new TypeError(`Screen ${name} must be a boolean.`);
  }
  return value;
}

function screenSheetDetentChangeEvent(
  event: NativeSyntheticEvent,
): ScreenSheetDetentChangeEvent {
  const payload = event.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new TypeError(
      "Native Screen sheet detent events must include an object payload.",
    );
  }
  const record = payload as Readonly<Record<string, HostValue>>;
  const index = record.index;
  const isStable = record.isStable;
  if (!Number.isSafeInteger(index) || (index as number) < 0) {
    throw new TypeError(
      "Native Screen sheet detent events must include a non-negative integer index.",
    );
  }
  if (typeof isStable !== "boolean") {
    throw new TypeError(
      "Native Screen sheet detent events must include a boolean isStable value.",
    );
  }
  return event as ScreenSheetDetentChangeEvent;
}

function normalizeScreenSheetPresentation(
  props: ScreenProps,
  platform: string,
): NormalizedScreenSheetPresentation | undefined {
  if (props.presentation !== "sheet") {
    const configuredProperty = SCREEN_SHEET_PUBLIC_PROPERTIES.find(
      (property) => props[property] !== undefined,
    );
    if (configuredProperty !== undefined) {
      throw new TypeError(
        `Screen ${configuredProperty} requires presentation ${JSON.stringify("sheet")}.`,
      );
    }
    return undefined;
  }

  const requestedDetents = props.sheetAllowedDetents ?? [1];
  const sheetAllowedDetents =
    requestedDetents === "fitToContents"
      ? Object.freeze([-1])
      : (() => {
          if (!Array.isArray(requestedDetents)) {
            throw new TypeError(
              'Screen sheetAllowedDetents must be an array or "fitToContents".',
            );
          }
          if (requestedDetents.length === 0) {
            throw new TypeError(
              "Screen sheetAllowedDetents must contain at least one detent.",
            );
          }
          if (platform === "android" && requestedDetents.length > 3) {
            throw new TypeError(
              "Android Screen sheetAllowedDetents supports at most three detents.",
            );
          }
          let previous = 0;
          const normalized = requestedDetents.map((detent, index) => {
            screenSheetFiniteNumber(detent, `sheetAllowedDetents[${index}]`);
            if (detent <= 0 || detent > 1) {
              throw new RangeError(
                `Screen sheetAllowedDetents[${index}] must be greater than 0 and at most 1.`,
              );
            }
            if (index > 0 && detent <= previous) {
              throw new RangeError(
                "Screen sheetAllowedDetents must be strictly ascending.",
              );
            }
            previous = detent;
            return detent;
          });
          return Object.freeze(normalized);
        })();
  const lastDetentIndex = sheetAllowedDetents.length - 1;
  const requestedInitialDetent = props.sheetInitialDetent ?? 0;
  const sheetInitialDetent =
    requestedInitialDetent === "last"
      ? lastDetentIndex
      : requestedInitialDetent;
  if (
    !Number.isSafeInteger(sheetInitialDetent) ||
    sheetInitialDetent < 0 ||
    sheetInitialDetent > lastDetentIndex
  ) {
    throw new RangeError(
      "Screen sheetInitialDetent must identify an allowed detent.",
    );
  }
  const requestedLargestUndimmed = props.sheetLargestUndimmedDetent ?? "none";
  const sheetLargestUndimmedDetent =
    requestedLargestUndimmed === "none"
      ? -1
      : requestedLargestUndimmed === "last"
        ? lastDetentIndex
        : requestedLargestUndimmed;
  if (
    !Number.isSafeInteger(sheetLargestUndimmedDetent) ||
    sheetLargestUndimmedDetent < -1 ||
    sheetLargestUndimmedDetent > lastDetentIndex
  ) {
    throw new RangeError(
      "Screen sheetLargestUndimmedDetent must identify an allowed detent.",
    );
  }
  const sheetCornerRadius = props.sheetCornerRadius ?? -1;
  screenSheetFiniteNumber(sheetCornerRadius, "sheetCornerRadius");
  if (props.sheetCornerRadius !== undefined && sheetCornerRadius < 0) {
    throw new RangeError(
      "Screen sheetCornerRadius must be non-negative when provided.",
    );
  }
  const sheetElevation = props.sheetElevation ?? 24;
  if (
    !Number.isSafeInteger(sheetElevation) ||
    sheetElevation < 0 ||
    sheetElevation > 2_147_483_647
  ) {
    throw new RangeError(
      "Screen sheetElevation must be a non-negative 32-bit integer.",
    );
  }

  return Object.freeze({
    sheetAllowedDetents,
    sheetInitialDetent,
    sheetLargestUndimmedDetent,
    sheetGrabberVisible: screenSheetBoolean(
      props.sheetGrabberVisible,
      "sheetGrabberVisible",
      false,
    ),
    sheetCornerRadius,
    sheetExpandsWhenScrolledToEdge: screenSheetBoolean(
      props.sheetExpandsWhenScrolledToEdge,
      "sheetExpandsWhenScrolledToEdge",
      true,
    ),
    sheetElevation,
    sheetShouldOverflowTopInset: screenSheetBoolean(
      props.sheetShouldOverflowTopInset,
      "sheetShouldOverflowTopInset",
      false,
    ),
    sheetDefaultResizeAnimationEnabled: screenSheetBoolean(
      props.sheetDefaultResizeAnimationEnabled,
      "sheetDefaultResizeAnimationEnabled",
      true,
    ),
  });
}

function screenNativeProps(
  props: ScreenProps,
  platform: string,
): NativeScreenProps {
  const initialSheetPresentation = untrack(() => {
    // A keyed native screen's presentation kind is structural. Resolve it once
    // so push screens do not subscribe to nine irrelevant sheet defaults.
    return normalizeScreenSheetPresentation(props, platform);
  });
  const ownsSheetPresentation = initialSheetPresentation !== undefined;
  const style = createMemo<StyleProp>(() => [SCREEN_BASE_STYLE, props.style]);
  const screenId = createMemo(() => props.name);
  const stackPresentation = createMemo(() => {
    if (props.presentation === "sheet") return "formSheet";
    return props.presentation;
  });
  const sheetPresentation = ownsSheetPresentation
    ? createMemo(() => normalizeScreenSheetPresentation(props, platform))
    : () => initialSheetPresentation;
  const onSheetDetentChange: NativeEventHandler | undefined =
    props.onSheetDetentChange === undefined
      ? undefined
      : (event) =>
          props.onSheetDetentChange?.(screenSheetDetentChangeEvent(event));
  const translatedProperties = new Set<string | symbol>([
    "name",
    "presentation",
    ...SCREEN_SHEET_PUBLIC_PROPERTIES,
  ]);
  const nativeProperties = new Set<string | symbol>([
    "screenId",
    "stackPresentation",
    ...(ownsSheetPresentation ? SCREEN_SHEET_PUBLIC_PROPERTIES : []),
    "style",
  ]);

  return new Proxy({} as NativeScreenProps, {
    get(_target, property) {
      if (property === "name" || property === "presentation") return undefined;
      if (property === "screenId") return screenId();
      if (property === "stackPresentation") return stackPresentation();
      if (property === "onSheetDetentChange") return onSheetDetentChange;
      if (
        typeof property === "string" &&
        SCREEN_SHEET_PUBLIC_PROPERTIES.includes(
          property as (typeof SCREEN_SHEET_PUBLIC_PROPERTIES)[number],
        )
      ) {
        return sheetPresentation()?.[
          property as keyof NormalizedScreenSheetPresentation
        ];
      }
      if (property === "style") return style();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      if (translatedProperties.has(property)) return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !translatedProperties.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
}

function createScreen(props: ScreenProps): NativeNode {
  const screen = createElement("Screen");
  spread(screen, screenNativeProps(props, nativeNodePlatform(screen)));
  return screen;
}

function screenStackNativeProps(props: ScreenStackProps): ScreenStackProps {
  const style = createMemo<StyleProp>(() => [SCREEN_BASE_STYLE, props.style]);
  return new Proxy({} as ScreenStackProps, {
    get(_target, property) {
      if (property === "activeScreen") return undefined;
      if (property === "style") return style();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === "activeScreen") return undefined;
      if (property === "style") {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => property !== "activeScreen",
      );
      if (!keys.includes("style")) keys.push("style");
      return keys;
    },
  });
}

function createScreenStack(props: ScreenStackProps): NativeNode {
  const screenStack = createElement("ScreenStack");
  spread(screenStack, screenStackNativeProps(props));
  return screenStack;
}

const SCREEN_HEADER_BASE_STYLE: NativeStyle = {
  position: "absolute",
  width: "100%",
  flexDirection: "row",
  justifyContent: "space-between",
};

const SCREEN_HEADER_BAR_BUTTON_LIMIT = 16;
const SCREEN_HEADER_MENU_ELEMENT_LIMIT = 64;
const SCREEN_HEADER_MENU_DEPTH_LIMIT = 6;

type NativeScreenHeaderBarButtonItem = Readonly<Record<string, HostValue>>;

interface NormalizedScreenHeaderBarButtons {
  readonly left: readonly NativeScreenHeaderBarButtonItem[] | undefined;
  readonly right: readonly NativeScreenHeaderBarButtonItem[] | undefined;
  readonly buttonActions: ReadonlyMap<string, () => unknown>;
  readonly menuActions: ReadonlyMap<string, () => unknown>;
}

interface ScreenHeaderMenuNormalizationContext {
  readonly side: "left" | "right";
  readonly itemIndex: number;
  readonly actions: Map<string, () => unknown>;
  elementCount: number;
}

function screenHeaderBarButtonRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function screenHeaderBarButtonString(
  value: unknown,
  path: string,
  required = false,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > 512) {
    throw new TypeError(`${path} must be a string of at most 512 characters.`);
  }
  return value;
}

function screenHeaderBarButtonBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean.`);
  }
  return value;
}

function screenHeaderBarButtonNumber(
  value: unknown,
  path: string,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new TypeError(
      `${path} must be a finite number greater than or equal to ${String(minimum)}.`,
    );
  }
  return value;
}

function screenHeaderBarButtonInteger(
  value: unknown,
  path: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative integer.`);
  }
  return value as number;
}

function screenHeaderBarButtonEnum<TValue extends string>(
  value: unknown,
  path: string,
  values: readonly TValue[],
  required = false,
): TValue | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !values.includes(value as TValue)) {
    throw new TypeError(
      `${path} must be one of ${values.map((entry) => JSON.stringify(entry)).join(", ")}.`,
    );
  }
  return value as TValue;
}

function setScreenHeaderBarButtonProperty(
  target: Record<string, HostValue>,
  property: string,
  value: HostValue | undefined,
): void {
  if (value !== undefined) target[property] = value;
}

function normalizeScreenHeaderBarButtonIcon(
  value: unknown,
  path: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const icon = screenHeaderBarButtonRecord(value, path);
  const type = screenHeaderBarButtonEnum(
    icon.type,
    `${path}.type`,
    ["sfSymbol", "xcasset"] as const,
    true,
  );
  const name = screenHeaderBarButtonString(icon.name, `${path}.name`, true);
  if (name?.length === 0) {
    throw new TypeError(`${path}.name must not be empty.`);
  }
  return type === "sfSymbol"
    ? Object.freeze({ sfSymbolName: name as string })
    : Object.freeze({ xcassetName: name as string });
}

function normalizeScreenHeaderBarButtonTextStyle(
  value: unknown,
  path: string,
): NativeScreenHeaderBarButtonItem | undefined {
  if (value === undefined) return undefined;
  const style = screenHeaderBarButtonRecord(value, path);
  const result: Record<string, HostValue> = {};
  setScreenHeaderBarButtonProperty(
    result,
    "fontFamily",
    screenHeaderBarButtonString(style.fontFamily, `${path}.fontFamily`),
  );
  setScreenHeaderBarButtonProperty(
    result,
    "fontSize",
    screenHeaderBarButtonNumber(style.fontSize, `${path}.fontSize`, 0),
  );
  setScreenHeaderBarButtonProperty(
    result,
    "fontWeight",
    screenHeaderBarButtonString(style.fontWeight, `${path}.fontWeight`),
  );
  setScreenHeaderBarButtonProperty(
    result,
    "color",
    screenHeaderBarButtonString(style.color, `${path}.color`),
  );
  return Object.freeze(result);
}

function normalizeScreenHeaderBarButtonBadge(
  value: unknown,
  path: string,
): NativeScreenHeaderBarButtonItem | undefined {
  if (value === undefined) return undefined;
  const badge = screenHeaderBarButtonRecord(value, path);
  const result: Record<string, HostValue> = {
    value: screenHeaderBarButtonString(
      badge.value,
      `${path}.value`,
      true,
    ) as string,
  };
  const style = normalizeScreenHeaderBarButtonTextStyle(
    badge.style,
    `${path}.style`,
  );
  if (style !== undefined) {
    const source = screenHeaderBarButtonRecord(badge.style, `${path}.style`);
    const normalizedStyle: Record<string, HostValue> = { ...style };
    setScreenHeaderBarButtonProperty(
      normalizedStyle,
      "backgroundColor",
      screenHeaderBarButtonString(
        source.backgroundColor,
        `${path}.style.backgroundColor`,
      ),
    );
    result.style = Object.freeze(normalizedStyle);
  }
  return Object.freeze(result);
}

function normalizeScreenHeaderBarButtonShared(
  item: Readonly<Record<string, unknown>>,
  path: string,
): Record<string, HostValue> {
  const result: Record<string, HostValue> = {};
  setScreenHeaderBarButtonProperty(
    result,
    "index",
    screenHeaderBarButtonInteger(item.index, `${path}.index`),
  );
  setScreenHeaderBarButtonProperty(
    result,
    "title",
    screenHeaderBarButtonString(item.title, `${path}.title`),
  );
  setScreenHeaderBarButtonProperty(
    result,
    "titleStyle",
    normalizeScreenHeaderBarButtonTextStyle(
      item.titleStyle,
      `${path}.titleStyle`,
    ),
  );
  const icon = normalizeScreenHeaderBarButtonIcon(item.icon, `${path}.icon`);
  if (icon !== undefined) Object.assign(result, icon);
  setScreenHeaderBarButtonProperty(
    result,
    "variant",
    screenHeaderBarButtonEnum(item.variant, `${path}.variant`, [
      "plain",
      "done",
      "prominent",
    ] as const),
  );
  setScreenHeaderBarButtonProperty(
    result,
    "tintColor",
    screenHeaderBarButtonString(item.tintColor, `${path}.tintColor`),
  );
  setScreenHeaderBarButtonProperty(
    result,
    "disabled",
    screenHeaderBarButtonBoolean(item.disabled, `${path}.disabled`),
  );
  setScreenHeaderBarButtonProperty(
    result,
    "width",
    screenHeaderBarButtonNumber(item.width, `${path}.width`, 0),
  );
  for (const property of [
    "hidesSharedBackground",
    "sharesBackground",
  ] as const) {
    setScreenHeaderBarButtonProperty(
      result,
      property,
      screenHeaderBarButtonBoolean(item[property], `${path}.${property}`),
    );
  }
  for (const property of [
    "identifier",
    "accessibilityLabel",
    "accessibilityHint",
  ] as const) {
    setScreenHeaderBarButtonProperty(
      result,
      property,
      screenHeaderBarButtonString(item[property], `${path}.${property}`),
    );
  }
  setScreenHeaderBarButtonProperty(
    result,
    "badge",
    normalizeScreenHeaderBarButtonBadge(item.badge, `${path}.badge`),
  );
  if (
    result.title === undefined &&
    result.sfSymbolName === undefined &&
    result.xcassetName === undefined
  ) {
    throw new TypeError(`${path} requires a title or icon.`);
  }
  return result;
}

function normalizeScreenHeaderMenuItems(
  value: unknown,
  path: string,
  identifierPath: string,
  depth: number,
  context: ScreenHeaderMenuNormalizationContext,
): readonly NativeScreenHeaderBarButtonItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty array.`);
  }
  if (depth > SCREEN_HEADER_MENU_DEPTH_LIMIT) {
    throw new RangeError(
      `${path} exceeds the maximum native header menu depth of ${String(SCREEN_HEADER_MENU_DEPTH_LIMIT)}.`,
    );
  }
  return Object.freeze(
    value.map((entry, index) => {
      context.elementCount++;
      if (context.elementCount > SCREEN_HEADER_MENU_ELEMENT_LIMIT) {
        throw new RangeError(
          `Native header menus support at most ${String(SCREEN_HEADER_MENU_ELEMENT_LIMIT)} total elements per bar item.`,
        );
      }
      const itemPath = `${path}[${String(index)}]`;
      const item = screenHeaderBarButtonRecord(entry, itemPath);
      const type = screenHeaderBarButtonEnum(
        item.type,
        `${itemPath}.type`,
        ["action", "submenu"] as const,
        true,
      );
      const result: Record<string, HostValue> = {
        type: type as string,
        title: screenHeaderBarButtonString(
          item.title,
          `${itemPath}.title`,
          true,
        ) as string,
      };
      const icon = normalizeScreenHeaderBarButtonIcon(
        item.icon,
        `${itemPath}.icon`,
      );
      if (icon !== undefined) Object.assign(result, icon);
      const elementPath =
        identifierPath.length === 0
          ? String(index)
          : `${identifierPath}.${String(index)}`;
      if (type === "action") {
        if (typeof item.onPress !== "function") {
          throw new TypeError(`${itemPath}.onPress must be a function.`);
        }
        const menuId = `${elementPath}-${String(context.itemIndex)}-${context.side}`;
        context.actions.set(menuId, item.onPress as () => unknown);
        result.menuId = menuId;
        setScreenHeaderBarButtonProperty(
          result,
          "subtitle",
          screenHeaderBarButtonString(item.subtitle, `${itemPath}.subtitle`),
        );
        setScreenHeaderBarButtonProperty(
          result,
          "state",
          screenHeaderBarButtonEnum(item.state, `${itemPath}.state`, [
            "on",
            "off",
            "mixed",
          ] as const),
        );
        for (const property of [
          "disabled",
          "destructive",
          "hidden",
          "keepsMenuPresented",
        ] as const) {
          setScreenHeaderBarButtonProperty(
            result,
            property,
            screenHeaderBarButtonBoolean(
              item[property],
              `${itemPath}.${property}`,
            ),
          );
        }
        setScreenHeaderBarButtonProperty(
          result,
          "discoverabilityLabel",
          screenHeaderBarButtonString(
            item.discoverabilityLabel,
            `${itemPath}.discoverabilityLabel`,
          ),
        );
      } else {
        for (const property of [
          "displayInline",
          "destructive",
          "singleSelection",
          "displayAsPalette",
        ] as const) {
          setScreenHeaderBarButtonProperty(
            result,
            property,
            screenHeaderBarButtonBoolean(
              item[property],
              `${itemPath}.${property}`,
            ),
          );
        }
        result.items = normalizeScreenHeaderMenuItems(
          item.items,
          `${itemPath}.items`,
          elementPath,
          depth + 1,
          context,
        );
      }
      return Object.freeze(result);
    }),
  );
}

function normalizeScreenHeaderBarButtonSide(
  value: unknown,
  side: "left" | "right",
  buttonActions: Map<string, () => unknown>,
  menuActions: Map<string, () => unknown>,
): readonly NativeScreenHeaderBarButtonItem[] | undefined {
  if (value === undefined) return undefined;
  const path = `Screen header${side === "left" ? "Left" : "Right"}BarButtonItems`;
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  if (value.length > SCREEN_HEADER_BAR_BUTTON_LIMIT) {
    throw new RangeError(
      `${path} supports at most ${String(SCREEN_HEADER_BAR_BUTTON_LIMIT)} items.`,
    );
  }
  return Object.freeze(
    value.map((entry, index) => {
      const itemPath = `${path}[${String(index)}]`;
      const item = screenHeaderBarButtonRecord(entry, itemPath);
      const type = screenHeaderBarButtonEnum(
        item.type,
        `${itemPath}.type`,
        ["button", "menu", "spacing"] as const,
        true,
      );
      if (type === "spacing") {
        const spacing = screenHeaderBarButtonNumber(
          item.spacing,
          `${itemPath}.spacing`,
          0,
        );
        if (spacing === 0) {
          throw new RangeError(`${itemPath}.spacing must be greater than 0.`);
        }
        const result: Record<string, HostValue> = {
          type,
          spacing: spacing as number,
        };
        setScreenHeaderBarButtonProperty(
          result,
          "index",
          screenHeaderBarButtonInteger(item.index, `${itemPath}.index`),
        );
        return Object.freeze(result);
      }
      const result = normalizeScreenHeaderBarButtonShared(item, itemPath);
      result.type = type as string;
      if (type === "button") {
        if (typeof item.onPress !== "function") {
          throw new TypeError(`${itemPath}.onPress must be a function.`);
        }
        const buttonId = `${String(index)}-${side}`;
        buttonActions.set(buttonId, item.onPress as () => unknown);
        result.buttonId = buttonId;
        setScreenHeaderBarButtonProperty(
          result,
          "selected",
          screenHeaderBarButtonBoolean(item.selected, `${itemPath}.selected`),
        );
      } else {
        const menu = screenHeaderBarButtonRecord(item.menu, `${itemPath}.menu`);
        const menuResult: Record<string, HostValue> = {};
        setScreenHeaderBarButtonProperty(
          menuResult,
          "title",
          screenHeaderBarButtonString(menu.title, `${itemPath}.menu.title`),
        );
        for (const property of [
          "singleSelection",
          "displayAsPalette",
        ] as const) {
          setScreenHeaderBarButtonProperty(
            menuResult,
            property,
            screenHeaderBarButtonBoolean(
              menu[property],
              `${itemPath}.menu.${property}`,
            ),
          );
        }
        const context: ScreenHeaderMenuNormalizationContext = {
          side,
          itemIndex: index,
          actions: menuActions,
          elementCount: 0,
        };
        menuResult.items = normalizeScreenHeaderMenuItems(
          menu.items,
          `${itemPath}.menu.items`,
          "",
          1,
          context,
        );
        result.menu = Object.freeze(menuResult);
        setScreenHeaderBarButtonProperty(
          result,
          "changesSelectionAsPrimaryAction",
          screenHeaderBarButtonBoolean(
            item.changesSelectionAsPrimaryAction,
            `${itemPath}.changesSelectionAsPrimaryAction`,
          ),
        );
      }
      return Object.freeze(result);
    }),
  );
}

function normalizeScreenHeaderBarButtons(
  props: ScreenHeaderProps,
  platform: string,
): NormalizedScreenHeaderBarButtons {
  const buttonActions = new Map<string, () => unknown>();
  const menuActions = new Map<string, () => unknown>();
  if (platform !== "ios") {
    return Object.freeze({
      left: undefined,
      right: undefined,
      buttonActions,
      menuActions,
    });
  }
  return Object.freeze({
    left: normalizeScreenHeaderBarButtonSide(
      props.headerLeftBarButtonItems,
      "left",
      buttonActions,
      menuActions,
    ),
    right: normalizeScreenHeaderBarButtonSide(
      props.headerRightBarButtonItems,
      "right",
      buttonActions,
      menuActions,
    ),
    buttonActions,
    menuActions,
  });
}

function screenHeaderBarButtonEventIdentifier(
  event: NativeSyntheticEvent,
  property: "buttonId" | "menuId",
): string {
  const payload = event.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new TypeError(
      `Native ScreenHeader ${property} events must include an object payload.`,
    );
  }
  const identifier = (payload as Readonly<Record<string, HostValue>>)[property];
  if (typeof identifier !== "string" || identifier.length === 0) {
    throw new TypeError(
      `Native ScreenHeader ${property} events must include a non-empty ${property}.`,
    );
  }
  return identifier;
}

interface NativeScreenHeaderProps extends Omit<
  ScreenHeaderProps,
  | "disableTopInsetApplication"
  | "headerLeftBarButtonItems"
  | "headerRightBarButtonItems"
> {
  readonly consumeTopInset: boolean;
  readonly headerLeftBarButtonItems?: readonly NativeScreenHeaderBarButtonItem[];
  readonly headerRightBarButtonItems?: readonly NativeScreenHeaderBarButtonItem[];
  readonly legacyTopInsetBehavior: false;
  readonly onPressHeaderBarButtonItem?: NativeEventHandler;
  readonly onPressHeaderBarButtonMenuItem?: NativeEventHandler;
  readonly pointerEvents: "box-none";
  readonly style: StyleProp;
}

function createScreenHeader(props: ScreenHeaderProps): NativeNode {
  const screenHeader = createElement("ScreenHeader");
  const platform = nativeNodePlatform(screenHeader);
  const style = createMemo<StyleProp>(() => [
    SCREEN_HEADER_BASE_STYLE,
    platform === "ios" ? { alignItems: "center" } : undefined,
  ]);
  const barButtons = createMemo(() =>
    normalizeScreenHeaderBarButtons(props, platform),
  );
  const onPressHeaderBarButtonItem: NativeEventHandler = (event) => {
    const buttonId = screenHeaderBarButtonEventIdentifier(event, "buttonId");
    const action = barButtons().buttonActions.get(buttonId);
    if (action === undefined) {
      throw new Error(
        `Native ScreenHeader emitted unknown buttonId ${JSON.stringify(buttonId)}.`,
      );
    }
    return action();
  };
  const onPressHeaderBarButtonMenuItem: NativeEventHandler = (event) => {
    const menuId = screenHeaderBarButtonEventIdentifier(event, "menuId");
    const action = barButtons().menuActions.get(menuId);
    if (action === undefined) {
      throw new Error(
        `Native ScreenHeader emitted unknown menuId ${JSON.stringify(menuId)}.`,
      );
    }
    return action();
  };
  const translatedProperties = new Set<string | symbol>([
    "disableTopInsetApplication",
    "headerLeftBarButtonItems",
    "headerRightBarButtonItems",
  ]);
  const nativeProperties = new Set<string | symbol>([
    "consumeTopInset",
    ...(platform === "ios"
      ? [
          "headerLeftBarButtonItems",
          "headerRightBarButtonItems",
          "onPressHeaderBarButtonItem",
          "onPressHeaderBarButtonMenuItem",
        ]
      : []),
    "legacyTopInsetBehavior",
    "pointerEvents",
    "style",
  ]);
  const nativeProps = new Proxy({} as NativeScreenHeaderProps, {
    get(_target, property) {
      if (property === "disableTopInsetApplication") return undefined;
      if (property === "consumeTopInset") {
        return (
          props.hidden !== true && props.disableTopInsetApplication !== true
        );
      }
      if (property === "headerLeftBarButtonItems") {
        return barButtons().left;
      }
      if (property === "headerRightBarButtonItems") {
        return barButtons().right;
      }
      if (property === "onPressHeaderBarButtonItem") {
        return onPressHeaderBarButtonItem;
      }
      if (property === "onPressHeaderBarButtonMenuItem") {
        return onPressHeaderBarButtonMenuItem;
      }
      if (property === "legacyTopInsetBehavior") return false;
      if (property === "pointerEvents") return "box-none";
      if (property === "style") return style();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      if (translatedProperties.has(property)) return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !translatedProperties.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
  spread(screenHeader, nativeProps);
  return screenHeader;
}

const SCREEN_HEADER_SUBVIEW_BASE_STYLE: NativeStyle = {
  alignItems: "center",
  flexDirection: "row",
  justifyContent: "center",
};

function createScreenHeaderSubview(
  props: ScreenHeaderSubviewProps,
): NativeNode {
  const subview = createElement("ScreenHeaderSubview");
  const style = createMemo<StyleProp>(() => [
    SCREEN_HEADER_SUBVIEW_BASE_STYLE,
    props.type === "center" ? { flexShrink: 1 } : undefined,
    props.style,
  ]);
  const nativeProps = new Proxy({} as ScreenHeaderSubviewProps, {
    get(_target, property) {
      if (property === "style") return style();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === "style") {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props);
      if (!keys.includes("style")) keys.push("style");
      return keys;
    },
  });
  spread(subview, nativeProps);
  return subview;
}

const TABS_HOST_STYLE: NativeStyle = {
  flex: 1,
  width: "100%",
  height: "100%",
};

interface NativeTabsHostProps extends Omit<
  TabsHostProps,
  "baseProvenance" | "direction" | "selectedKey"
> {
  readonly navStateRequest: Readonly<{
    selectedScreenKey: string;
    baseProvenance: number;
  }>;
  readonly layoutDirection?: "inherit" | "ltr" | "rtl";
  readonly style: StyleProp;
}

function createTabsHost(props: TabsHostProps): NativeNode {
  const tabsHost = createElement("TabsHost");
  const platform = nativeNodePlatform(tabsHost);
  const navStateRequest = createMemo(() => ({
    selectedScreenKey: props.selectedKey,
    baseProvenance: props.baseProvenance,
  }));
  const style = createMemo<StyleProp>(() => [
    TABS_HOST_STYLE,
    platform === "android" && props.direction !== undefined
      ? { direction: props.direction }
      : undefined,
  ]);
  const translatedProperties = new Set<string | symbol>([
    "baseProvenance",
    "direction",
    "selectedKey",
  ]);
  const androidOnlyProperties = new Set<string | symbol>([
    "tabBarRespectsIMEInsets",
  ]);
  const iosOnlyProperties = new Set<string | symbol>([
    "onMoreTabSelected",
    "tabBarControllerMode",
    "tabBarMinimizeBehavior",
    "tabBarTintColor",
  ]);
  const nativeProperties = new Set<string | symbol>([
    "navStateRequest",
    "style",
    ...(platform === "ios" ? ["layoutDirection"] : []),
  ]);
  const shouldOmit = (property: string | symbol): boolean =>
    translatedProperties.has(property) ||
    (platform === "ios" && androidOnlyProperties.has(property)) ||
    (platform === "android" && iosOnlyProperties.has(property));
  const nativeProps = new Proxy({} as NativeTabsHostProps, {
    get(_target, property) {
      if (shouldOmit(property)) return undefined;
      if (property === "navStateRequest") return navStateRequest();
      if (property === "layoutDirection") return props.direction;
      if (property === "style") return style();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (shouldOmit(property)) return undefined;
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !shouldOmit(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
  spread(tabsHost, nativeProps);
  return tabsHost;
}

const TABS_SCREEN_STYLE: NativeStyle = {
  position: "absolute",
  flex: 1,
  width: "100%",
  height: "100%",
};

const TABS_SCREEN_FONT_WEIGHTS = [
  "normal",
  "bold",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
] as const;
const TABS_SCREEN_FONT_STYLES = ["normal", "italic"] as const;
const TABS_SCREEN_ITEM_STATES = [
  "normal",
  "selected",
  "focused",
  "disabled",
] as const;
const TABS_SCREEN_BLUR_EFFECTS = [
  "none",
  "systemDefault",
  "extraLight",
  "light",
  "dark",
  "regular",
  "prominent",
  "systemUltraThinMaterial",
  "systemThinMaterial",
  "systemMaterial",
  "systemThickMaterial",
  "systemChromeMaterial",
  "systemUltraThinMaterialLight",
  "systemThinMaterialLight",
  "systemMaterialLight",
  "systemThickMaterialLight",
  "systemChromeMaterialLight",
  "systemUltraThinMaterialDark",
  "systemThinMaterialDark",
  "systemMaterialDark",
  "systemThickMaterialDark",
  "systemChromeMaterialDark",
] as const;

function tabsScreenAppearanceRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function tabsScreenAppearanceProperties(
  value: Readonly<Record<string, unknown>>,
  path: string,
  allowed: readonly string[],
): void {
  const allowedProperties = new Set(allowed);
  for (const property of Reflect.ownKeys(value)) {
    if (typeof property !== "string" || !allowedProperties.has(property)) {
      throw new TypeError(
        `${path} contains unsupported property ${JSON.stringify(String(property))}.`,
      );
    }
  }
}

function tabsScreenAppearanceString(
  value: unknown,
  path: string,
  maximumLength = 512,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.includes("\0")
  ) {
    throw new TypeError(
      `${path} must be a 1-${String(maximumLength)} character string without null bytes.`,
    );
  }
  return value;
}

function tabsScreenAppearanceNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${path} must be a finite number from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
  return value;
}

function tabsScreenAppearanceBoolean(
  value: unknown,
  path: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean.`);
  }
  return value;
}

function tabsScreenAppearanceEnum<TValue extends string>(
  value: unknown,
  path: string,
  values: readonly TValue[],
): TValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.includes(value as TValue)) {
    throw new TypeError(
      `${path} must be one of ${values.map((entry) => JSON.stringify(entry)).join(", ")}.`,
    );
  }
  return value as TValue;
}

function setTabsScreenAppearanceProperty(
  target: Record<string, HostValue>,
  property: string,
  value: HostValue | undefined,
): void {
  if (value !== undefined) target[property] = value;
}

function normalizeTabsScreenAndroidItemState(
  value: unknown,
  path: string,
): Readonly<Record<string, HostValue>> | undefined {
  if (value === undefined) return undefined;
  const source = tabsScreenAppearanceRecord(value, path);
  tabsScreenAppearanceProperties(source, path, [
    "tabBarItemTitleFontColor",
    "tabBarItemIconColor",
  ]);
  const result: Record<string, HostValue> = {};
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitleFontColor",
    tabsScreenAppearanceString(
      source.tabBarItemTitleFontColor,
      `${path}.tabBarItemTitleFontColor`,
      128,
    ),
  );
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemIconColor",
    tabsScreenAppearanceString(
      source.tabBarItemIconColor,
      `${path}.tabBarItemIconColor`,
      128,
    ),
  );
  return Object.freeze(result);
}

function normalizeTabsScreenAndroidAppearance(
  value: unknown,
  path: string,
): Readonly<Record<string, HostValue>> | undefined {
  if (value === undefined) return undefined;
  const source = tabsScreenAppearanceRecord(value, path);
  const properties = [
    "tabBarBackgroundColor",
    "tabBarItemRippleColor",
    "tabBarItemLabelVisibilityMode",
    ...TABS_SCREEN_ITEM_STATES,
    "tabBarItemActiveIndicatorColor",
    "tabBarItemActiveIndicatorEnabled",
    "tabBarItemTitleFontFamily",
    "tabBarItemTitleSmallLabelFontSize",
    "tabBarItemTitleLargeLabelFontSize",
    "tabBarItemTitleFontWeight",
    "tabBarItemTitleFontStyle",
    "tabBarItemBadgeBackgroundColor",
    "tabBarItemBadgeTextColor",
  ] as const;
  tabsScreenAppearanceProperties(source, path, properties);
  const result: Record<string, HostValue> = {};
  for (const property of [
    "tabBarBackgroundColor",
    "tabBarItemRippleColor",
    "tabBarItemActiveIndicatorColor",
    "tabBarItemBadgeBackgroundColor",
    "tabBarItemBadgeTextColor",
  ] as const) {
    setTabsScreenAppearanceProperty(
      result,
      property,
      tabsScreenAppearanceString(source[property], `${path}.${property}`, 128),
    );
  }
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemLabelVisibilityMode",
    tabsScreenAppearanceEnum(
      source.tabBarItemLabelVisibilityMode,
      `${path}.tabBarItemLabelVisibilityMode`,
      ["auto", "selected", "labeled", "unlabeled"],
    ),
  );
  for (const state of TABS_SCREEN_ITEM_STATES) {
    setTabsScreenAppearanceProperty(
      result,
      state,
      normalizeTabsScreenAndroidItemState(source[state], `${path}.${state}`),
    );
  }
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemActiveIndicatorEnabled",
    tabsScreenAppearanceBoolean(
      source.tabBarItemActiveIndicatorEnabled,
      `${path}.tabBarItemActiveIndicatorEnabled`,
    ),
  );
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitleFontFamily",
    tabsScreenAppearanceString(
      source.tabBarItemTitleFontFamily,
      `${path}.tabBarItemTitleFontFamily`,
    ),
  );
  for (const property of [
    "tabBarItemTitleSmallLabelFontSize",
    "tabBarItemTitleLargeLabelFontSize",
  ] as const) {
    setTabsScreenAppearanceProperty(
      result,
      property,
      tabsScreenAppearanceNumber(
        source[property],
        `${path}.${property}`,
        0,
        512,
      ),
    );
  }
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitleFontWeight",
    tabsScreenAppearanceEnum(
      source.tabBarItemTitleFontWeight,
      `${path}.tabBarItemTitleFontWeight`,
      TABS_SCREEN_FONT_WEIGHTS,
    ),
  );
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitleFontStyle",
    tabsScreenAppearanceEnum(
      source.tabBarItemTitleFontStyle,
      `${path}.tabBarItemTitleFontStyle`,
      TABS_SCREEN_FONT_STYLES,
    ),
  );
  return Object.freeze(result);
}

function normalizeTabsScreenTitlePositionAdjustment(
  value: unknown,
  path: string,
): Readonly<Record<string, HostValue>> | undefined {
  if (value === undefined) return undefined;
  const source = tabsScreenAppearanceRecord(value, path);
  tabsScreenAppearanceProperties(source, path, ["horizontal", "vertical"]);
  const result: Record<string, HostValue> = {};
  for (const property of ["horizontal", "vertical"] as const) {
    setTabsScreenAppearanceProperty(
      result,
      property,
      tabsScreenAppearanceNumber(
        source[property],
        `${path}.${property}`,
        -10_000,
        10_000,
      ),
    );
  }
  return Object.freeze(result);
}

function normalizeTabsScreenIOSItemState(
  value: unknown,
  path: string,
): Readonly<Record<string, HostValue>> | undefined {
  if (value === undefined) return undefined;
  const source = tabsScreenAppearanceRecord(value, path);
  tabsScreenAppearanceProperties(source, path, [
    "tabBarItemTitleFontFamily",
    "tabBarItemTitleFontSize",
    "tabBarItemTitleFontWeight",
    "tabBarItemTitleFontStyle",
    "tabBarItemTitleFontColor",
    "tabBarItemTitlePositionAdjustment",
    "tabBarItemIconColor",
    "tabBarItemBadgeBackgroundColor",
  ]);
  const result: Record<string, HostValue> = {};
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitleFontFamily",
    tabsScreenAppearanceString(
      source.tabBarItemTitleFontFamily,
      `${path}.tabBarItemTitleFontFamily`,
    ),
  );
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitleFontSize",
    tabsScreenAppearanceNumber(
      source.tabBarItemTitleFontSize,
      `${path}.tabBarItemTitleFontSize`,
      0,
      512,
    ),
  );
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitleFontWeight",
    tabsScreenAppearanceEnum(
      source.tabBarItemTitleFontWeight,
      `${path}.tabBarItemTitleFontWeight`,
      TABS_SCREEN_FONT_WEIGHTS,
    ),
  );
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitleFontStyle",
    tabsScreenAppearanceEnum(
      source.tabBarItemTitleFontStyle,
      `${path}.tabBarItemTitleFontStyle`,
      TABS_SCREEN_FONT_STYLES,
    ),
  );
  for (const property of [
    "tabBarItemTitleFontColor",
    "tabBarItemIconColor",
    "tabBarItemBadgeBackgroundColor",
  ] as const) {
    setTabsScreenAppearanceProperty(
      result,
      property,
      tabsScreenAppearanceString(source[property], `${path}.${property}`, 128),
    );
  }
  setTabsScreenAppearanceProperty(
    result,
    "tabBarItemTitlePositionAdjustment",
    normalizeTabsScreenTitlePositionAdjustment(
      source.tabBarItemTitlePositionAdjustment,
      `${path}.tabBarItemTitlePositionAdjustment`,
    ),
  );
  return Object.freeze(result);
}

function normalizeTabsScreenIOSItemAppearance(
  value: unknown,
  path: string,
): Readonly<Record<string, HostValue>> | undefined {
  if (value === undefined) return undefined;
  const source = tabsScreenAppearanceRecord(value, path);
  tabsScreenAppearanceProperties(source, path, TABS_SCREEN_ITEM_STATES);
  const result: Record<string, HostValue> = {};
  for (const state of TABS_SCREEN_ITEM_STATES) {
    setTabsScreenAppearanceProperty(
      result,
      state,
      normalizeTabsScreenIOSItemState(source[state], `${path}.${state}`),
    );
  }
  return Object.freeze(result);
}

function normalizeTabsScreenIOSAppearance(
  value: unknown,
  path: string,
): Readonly<Record<string, HostValue>> | undefined {
  if (value === undefined) return undefined;
  const source = tabsScreenAppearanceRecord(value, path);
  tabsScreenAppearanceProperties(source, path, [
    "stacked",
    "inline",
    "compactInline",
    "tabBarBackgroundColor",
    "tabBarBlurEffect",
    "tabBarShadowColor",
  ]);
  const result: Record<string, HostValue> = {};
  for (const layout of ["stacked", "inline", "compactInline"] as const) {
    setTabsScreenAppearanceProperty(
      result,
      layout,
      normalizeTabsScreenIOSItemAppearance(source[layout], `${path}.${layout}`),
    );
  }
  for (const property of [
    "tabBarBackgroundColor",
    "tabBarShadowColor",
  ] as const) {
    setTabsScreenAppearanceProperty(
      result,
      property,
      tabsScreenAppearanceString(source[property], `${path}.${property}`, 128),
    );
  }
  setTabsScreenAppearanceProperty(
    result,
    "tabBarBlurEffect",
    tabsScreenAppearanceEnum(
      source.tabBarBlurEffect,
      `${path}.tabBarBlurEffect`,
      TABS_SCREEN_BLUR_EFFECTS,
    ),
  );
  return Object.freeze(result);
}

function normalizeTabsScreenStandardAppearance(
  value: TabsScreenAppearance | undefined,
  platform: string,
): Readonly<Record<string, HostValue>> | undefined {
  if (value === undefined) return undefined;
  const source = tabsScreenAppearanceRecord(
    value,
    "TabsScreen standardAppearance",
  );
  tabsScreenAppearanceProperties(source, "TabsScreen standardAppearance", [
    "android",
    "ios",
  ]);
  if (platform === "android") {
    return normalizeTabsScreenAndroidAppearance(
      source.android,
      "TabsScreen standardAppearance.android",
    );
  }
  if (platform === "ios") {
    return normalizeTabsScreenIOSAppearance(
      source.ios,
      "TabsScreen standardAppearance.ios",
    );
  }
  return undefined;
}

function normalizeTabsScreenScrollEdgeAppearance(
  value: TabsScreenScrollEdgeAppearance | undefined,
  platform: string,
): Readonly<Record<string, HostValue>> | undefined {
  if (value === undefined) return undefined;
  const source = tabsScreenAppearanceRecord(
    value,
    "TabsScreen scrollEdgeAppearance",
  );
  tabsScreenAppearanceProperties(source, "TabsScreen scrollEdgeAppearance", [
    "ios",
  ]);
  if (platform !== "ios") return undefined;
  return normalizeTabsScreenIOSAppearance(
    source.ios,
    "TabsScreen scrollEdgeAppearance.ios",
  );
}

interface NativeTabsScreenProps extends Omit<
  TabsScreenProps,
  "icon" | "scrollEdgeAppearance" | "selectedIcon" | "standardAppearance"
> {
  readonly collapsable: false;
  readonly drawableIconResourceName?: string;
  readonly imageIconResource?: Readonly<ImageURISource>;
  readonly iconImageSource?: Readonly<ImageURISource>;
  readonly iconResourceName?: string;
  readonly iconType?: "image" | "template" | "sfSymbol" | "xcasset";
  readonly isTitleUndefined?: boolean;
  readonly selectedDrawableIconResourceName?: string;
  readonly selectedImageIconResource?: Readonly<ImageURISource>;
  readonly selectedIconImageSource?: Readonly<ImageURISource>;
  readonly selectedIconResourceName?: string;
  readonly standardAppearance?: Readonly<Record<string, HostValue>>;
  readonly scrollEdgeAppearance?: Readonly<Record<string, HostValue>>;
  readonly style: StyleProp;
}

interface NativeTabsScreenIconProps {
  readonly drawableIconResourceName?: string;
  readonly imageIconResource?: Readonly<ImageURISource>;
  readonly iconImageSource?: Readonly<ImageURISource>;
  readonly iconResourceName?: string;
  readonly iconType?: "image" | "template" | "sfSymbol" | "xcasset";
  readonly selectedDrawableIconResourceName?: string;
  readonly selectedImageIconResource?: Readonly<ImageURISource>;
  readonly selectedIconImageSource?: Readonly<ImageURISource>;
  readonly selectedIconResourceName?: string;
}

function tabsScreenIconName(
  value: unknown,
  path: string,
  platform: "android" | "ios",
): string {
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
  if (platform === "android" && !/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new TypeError(
      `${path} must be a lowercase Android drawable resource identifier.`,
    );
  }
  return value;
}

function tabsScreenImageSource(
  value: ImageSource,
  path: string,
): Readonly<ImageURISource> {
  const source =
    typeof value === "string"
      ? { uri: value }
      : tabsScreenAppearanceRecord(value, path);
  tabsScreenAppearanceProperties(source, path, [
    "uri",
    "width",
    "height",
    "scale",
  ]);
  const uri = tabsScreenAppearanceString(source.uri, `${path}.uri`, 1_048_576);
  if (uri === undefined || /[\u0000-\u001f\u007f]/u.test(uri)) {
    throw new TypeError(
      `${path}.uri must be a 1-1048576 character string without control characters.`,
    );
  }
  const width = tabsScreenAppearanceNumber(
    source.width,
    `${path}.width`,
    Number.MIN_VALUE,
    16_384,
  );
  const height = tabsScreenAppearanceNumber(
    source.height,
    `${path}.height`,
    Number.MIN_VALUE,
    16_384,
  );
  if ((width === undefined) !== (height === undefined)) {
    throw new TypeError(
      `${path}.width and ${path}.height must be set together.`,
    );
  }
  const scale = tabsScreenAppearanceNumber(
    source.scale,
    `${path}.scale`,
    Number.MIN_VALUE,
    64,
  );
  return Object.freeze({
    uri,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(scale === undefined ? {} : { scale }),
  });
}

function tabsScreenPlatformIcon(
  icon: TabsScreenIcon | undefined,
  platform: "android",
  path: string,
): TabsScreenIcon["android"] | undefined;
function tabsScreenPlatformIcon(
  icon: TabsScreenIcon | undefined,
  platform: "ios",
  path: string,
): TabsScreenIcon["ios"] | undefined;
function tabsScreenPlatformIcon(
  icon: TabsScreenIcon | undefined,
  platform: "android" | "ios",
  path: string,
): TabsScreenIcon["android"] | TabsScreenIcon["ios"] | undefined {
  if (icon === undefined) return undefined;
  if (icon === null || typeof icon !== "object" || Array.isArray(icon)) {
    throw new TypeError(`${path} must be an icon descriptor object.`);
  }
  const platformIcon = icon[platform];
  if (platformIcon === undefined) return undefined;
  if (
    platformIcon === null ||
    typeof platformIcon !== "object" ||
    Array.isArray(platformIcon)
  ) {
    throw new TypeError(`${path}.${platform} must be an icon descriptor.`);
  }
  if (
    platform === "android" &&
    platformIcon.type !== "drawableResource" &&
    platformIcon.type !== "imageSource"
  ) {
    throw new TypeError(
      `${path}.android.type must be ${JSON.stringify("drawableResource")} or ${JSON.stringify("imageSource")}.`,
    );
  }
  if (
    platform === "ios" &&
    platformIcon.type !== "sfSymbol" &&
    platformIcon.type !== "xcasset" &&
    platformIcon.type !== "imageSource" &&
    platformIcon.type !== "templateSource"
  ) {
    throw new TypeError(
      `${path}.ios.type must be ${JSON.stringify("sfSymbol")}, ${JSON.stringify("xcasset")}, ${JSON.stringify("imageSource")}, or ${JSON.stringify("templateSource")}.`,
    );
  }
  if (
    platformIcon.type === "drawableResource" ||
    platformIcon.type === "sfSymbol" ||
    platformIcon.type === "xcasset"
  ) {
    tabsScreenIconName(platformIcon.name, `${path}.${platform}.name`, platform);
  } else {
    tabsScreenImageSource(platformIcon.source, `${path}.${platform}.source`);
  }
  return platformIcon;
}

function nativeTabsScreenIcons(
  platform: string,
  icon: TabsScreenIcon | undefined,
  selectedIcon: TabsScreenIcon | undefined,
): NativeTabsScreenIconProps {
  if (platform !== "android" && platform !== "ios") return {};
  if (platform === "android") {
    const base = tabsScreenPlatformIcon(icon, "android", "TabsScreen icon");
    const selected = tabsScreenPlatformIcon(
      selectedIcon,
      "android",
      "TabsScreen selectedIcon",
    );
    if (selected !== undefined && base === undefined) {
      throw new TypeError(
        "TabsScreen selectedIcon.android requires icon.android.",
      );
    }
    return {
      ...(base === undefined
        ? {}
        : base.type === "drawableResource"
          ? { drawableIconResourceName: base.name }
          : {
              imageIconResource: tabsScreenImageSource(
                base.source,
                "TabsScreen icon.android.source",
              ),
            }),
      ...(selected === undefined
        ? {}
        : selected.type === "drawableResource"
          ? { selectedDrawableIconResourceName: selected.name }
          : {
              selectedImageIconResource: tabsScreenImageSource(
                selected.source,
                "TabsScreen selectedIcon.android.source",
              ),
            }),
    };
  }
  const base = tabsScreenPlatformIcon(icon, "ios", "TabsScreen icon");
  const selected = tabsScreenPlatformIcon(
    selectedIcon,
    "ios",
    "TabsScreen selectedIcon",
  );
  if (selected !== undefined && base === undefined) {
    throw new TypeError("TabsScreen selectedIcon.ios requires icon.ios.");
  }
  if (
    base !== undefined &&
    selected !== undefined &&
    base.type !== selected.type
  ) {
    throw new TypeError(
      "TabsScreen icon.ios and selectedIcon.ios must use the same type.",
    );
  }
  return {
    ...(base === undefined
      ? {}
      : base.type === "sfSymbol" || base.type === "xcasset"
        ? { iconType: base.type, iconResourceName: base.name }
        : {
            iconType: base.type === "imageSource" ? "image" : "template",
            iconImageSource: tabsScreenImageSource(
              base.source,
              "TabsScreen icon.ios.source",
            ),
          }),
    ...(selected === undefined
      ? {}
      : selected.type === "sfSymbol" || selected.type === "xcasset"
        ? { selectedIconResourceName: selected.name }
        : {
            selectedIconImageSource: tabsScreenImageSource(
              selected.source,
              "TabsScreen selectedIcon.ios.source",
            ),
          }),
  };
}

function createTabsScreen(props: TabsScreenProps): NativeNode {
  const tabsScreen = createElement("TabsScreen");
  const platform = nativeNodePlatform(tabsScreen);
  const style = createMemo<StyleProp>(() => [props.style, TABS_SCREEN_STYLE]);
  const icons = createMemo(() =>
    nativeTabsScreenIcons(platform, props.icon, props.selectedIcon),
  );
  const standardAppearance = createMemo(() =>
    normalizeTabsScreenStandardAppearance(props.standardAppearance, platform),
  );
  const scrollEdgeAppearance = createMemo(() =>
    normalizeTabsScreenScrollEdgeAppearance(
      props.scrollEdgeAppearance,
      platform,
    ),
  );
  const translatedProperties = new Set<string | symbol>([
    "icon",
    "selectedIcon",
  ]);
  const nativeProperties = new Set<string | symbol>(["collapsable", "style"]);
  if (platform === "android") {
    nativeProperties.add("drawableIconResourceName");
    nativeProperties.add("imageIconResource");
    nativeProperties.add("selectedDrawableIconResourceName");
    nativeProperties.add("selectedImageIconResource");
    nativeProperties.add("standardAppearance");
  }
  if (platform === "ios") {
    nativeProperties.add("iconImageSource");
    nativeProperties.add("iconResourceName");
    nativeProperties.add("iconType");
    nativeProperties.add("isTitleUndefined");
    nativeProperties.add("scrollEdgeAppearance");
    nativeProperties.add("selectedIconImageSource");
    nativeProperties.add("selectedIconResourceName");
    nativeProperties.add("standardAppearance");
  }
  const shouldOmit = (property: string | symbol): boolean =>
    translatedProperties.has(property) ||
    (platform === "android" &&
      (property === "orientation" || property === "scrollEdgeAppearance"));
  const nativeProps = new Proxy({} as NativeTabsScreenProps, {
    get(_target, property) {
      if (shouldOmit(property)) return undefined;
      if (property === "collapsable") return false;
      if (property === "standardAppearance") return standardAppearance();
      if (property === "scrollEdgeAppearance") return scrollEdgeAppearance();
      if (nativeProperties.has(property) && property !== "style") {
        const icon = Reflect.get(icons(), property);
        if (icon !== undefined) return icon;
      }
      if (property === "isTitleUndefined") return props.title === undefined;
      if (property === "style") return style();
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (shouldOmit(property)) return undefined;
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !shouldOmit(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
  spread(tabsScreen, nativeProps);
  return tabsScreen;
}

interface TextInputFocusRegistration {
  hasNext(): boolean;
  focusNext(): Promise<void> | undefined;
}

interface TextInputFocusGroupController {
  register(
    node: NativeNode,
    focusable: Accessor<boolean>,
  ): TextInputFocusRegistration;
}

interface TextInputFocusEntry {
  readonly node: NativeNode;
  readonly focusable: Accessor<boolean>;
  readonly registrationOrder: number;
  active: boolean;
}

const TextInputFocusGroupContext =
  createContext<TextInputFocusGroupController | null>(null);
const TextInputFocusGroupProvider = TextInputFocusGroupContext as Component<{
  readonly value: TextInputFocusGroupController;
  readonly children?: SolidElement;
}>;

/**
 * Provides zero-wrapper, render-order TextInput focus traversal to its nearest
 * descendant group. Registration and pending traversal belong to this owner.
 */
export function TextInputFocusGroup(
  props: TextInputFocusGroupProps,
): SolidElement {
  const [entryRevision, setEntryRevision] = createSignal(0, {
    ownedWrite: true,
  });
  let entries: TextInputFocusEntry[] = [];
  let nextRegistrationOrder = 0;
  let traversalRevision = 0;
  let active = true;

  const reportError = (error: unknown): void => {
    try {
      const result = props.onTraversalError?.(error);
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Diagnostics cannot break native submit delivery or owner disposal.
    }
  };
  const nextEntry = (
    current: TextInputFocusEntry,
  ): TextInputFocusEntry | undefined => {
    entryRevision();
    const ordered = entries
      .filter((candidate) => candidate.active)
      .sort((left, right) => {
        try {
          return compareNativeNodeOrder(left.node, right.node);
        } catch {
          return left.registrationOrder - right.registrationOrder;
        }
      });
    const index = ordered.indexOf(current);
    if (index < 0) return undefined;
    return ordered.slice(index + 1).find((candidate) => candidate.focusable());
  };
  const controller: TextInputFocusGroupController = {
    register(node, focusable) {
      if (!active) {
        throw new Error(
          "Cannot register a TextInput with a disposed focus group.",
        );
      }
      const entry: TextInputFocusEntry = {
        node,
        focusable,
        registrationOrder: nextRegistrationOrder++,
        active: true,
      };
      entries = [...entries, entry];
      setEntryRevision((revision) => revision + 1);
      void Promise.resolve().then(() => {
        if (active && entry.active) {
          setEntryRevision((revision) => revision + 1);
        }
      });
      onCleanup(() => {
        if (!entry.active) return;
        entry.active = false;
        entries = entries.filter((candidate) => candidate !== entry);
        traversalRevision++;
        setEntryRevision((revision) => revision + 1);
      });
      return {
        hasNext() {
          return nextEntry(entry) !== undefined;
        },
        focusNext() {
          if (!active || !entry.active) return undefined;
          const revision = ++traversalRevision;
          if (untrack(() => nextEntry(entry)) === undefined) return undefined;
          const scope = nativeNodeRoot(entry.node).createCausalScope(
            "input.focus.traversal",
          );
          const start = async (): Promise<void> => {
            if (!active || !entry.active || revision !== traversalRevision) {
              scope.cancel();
              return;
            }
            const next = untrack(() => nextEntry(entry));
            if (next === undefined) {
              scope.cancel();
              return;
            }
            try {
              await scope.run(() => next.node.focus());
              scope.finish();
            } catch (error) {
              scope.fail(error);
              if (active && revision === traversalRevision) reportError(error);
            }
          };
          return Promise.resolve().then(start);
        },
      };
    },
  };
  onCleanup(() => {
    active = false;
    traversalRevision++;
    for (const entry of entries) entry.active = false;
    entries = [];
  });
  return solidCreateComponent(TextInputFocusGroupProvider, {
    value: controller,
    get children() {
      const value = props.children;
      void Promise.resolve().then(() => {
        if (active) setEntryRevision((revision) => revision + 1);
      });
      return value;
    },
  });
}

const TEXT_INPUT_ENTER_KEY_HINT_RETURN_TYPES = Object.freeze({
  done: "done",
  enter: "default",
  go: "go",
  next: "next",
  previous: "previous",
  search: "search",
  send: "send",
} as const satisfies Record<TextInputEnterKeyHint, TextInputReturnKeyType>);

const TEXT_INPUT_ANDROID_AUTOCOMPLETE: Readonly<
  Partial<Record<TextInputAutoComplete, TextInputAutoComplete>>
> = Object.freeze({
  "additional-name": "name-middle",
  "address-line1": "postal-address-region",
  "address-line2": "postal-address-locality",
  "current-password": "password",
  "family-name": "name-family",
  "given-name": "name-given",
  "honorific-prefix": "name-prefix",
  "honorific-suffix": "name-suffix",
  "new-password": "password-new",
  "one-time-code": "sms-otp",
});

const TEXT_INPUT_IOS_AUTOCOMPLETE: Readonly<
  Partial<Record<TextInputAutoComplete, TextInputTextContentType>>
> = Object.freeze({
  "additional-name": "middleName",
  "address-line1": "streetAddressLine1",
  "address-line2": "streetAddressLine2",
  "birthdate-day": "birthdateDay",
  "birthdate-full": "birthdate",
  "birthdate-month": "birthdateMonth",
  "birthdate-year": "birthdateYear",
  "cc-csc": "creditCardSecurityCode",
  "cc-exp": "creditCardExpiration",
  "cc-exp-month": "creditCardExpirationMonth",
  "cc-exp-year": "creditCardExpirationYear",
  "cc-family-name": "creditCardFamilyName",
  "cc-given-name": "creditCardGivenName",
  "cc-middle-name": "creditCardMiddleName",
  "cc-name": "creditCardName",
  "cc-number": "creditCardNumber",
  "cc-type": "creditCardType",
  country: "countryName",
  "current-password": "password",
  email: "emailAddress",
  "family-name": "familyName",
  "flight-number": "flightNumber",
  "given-name": "givenName",
  "honorific-prefix": "namePrefix",
  "honorific-suffix": "nameSuffix",
  name: "name",
  "new-password": "newPassword",
  nickname: "nickname",
  off: "none",
  "one-time-code": "oneTimeCode",
  organization: "organizationName",
  "organization-title": "jobTitle",
  "postal-code": "postalCode",
  "street-address": "fullStreetAddress",
  tel: "telephoneNumber",
  url: "URL",
  username: "username",
});

const TEXT_INPUT_VERTICAL_ALIGN = Object.freeze({
  auto: "auto",
  bottom: "bottom",
  middle: "center",
  top: "top",
} as const);

function flattenTextInputStyle(
  value: StyleProp,
  target: Record<string, HostValue | undefined>,
): boolean {
  if (value === null || value === undefined || value === false) return true;
  if (Array.isArray(value)) {
    return value.every((entry) => flattenTextInputStyle(entry, target));
  }
  if (typeof value !== "object") return false;
  Object.assign(target, value);
  return true;
}

function normalizeTextInputStyle(
  value: StyleProp,
  platform: string,
  multiline: boolean,
): StyleProp {
  const flattened: Record<string, HostValue | undefined> = {};
  if (!flattenTextInputStyle(value, flattened)) return value;

  const overrides: Record<string, HostValue | undefined> = {};
  if (typeof flattened.fontWeight === "number") {
    overrides.fontWeight = String(flattened.fontWeight);
  }

  const verticalAlign = flattened.verticalAlign;
  if (verticalAlign !== null && verticalAlign !== undefined) {
    overrides.textAlignVertical =
      typeof verticalAlign === "string"
        ? TEXT_INPUT_VERTICAL_ALIGN[
            verticalAlign as keyof typeof TEXT_INPUT_VERTICAL_ALIGN
          ]
        : undefined;
    overrides.verticalAlign = undefined;
  }

  if (
    platform === "ios" &&
    multiline &&
    flattened.padding == null &&
    flattened.paddingVertical == null &&
    flattened.paddingTop == null
  ) {
    overrides.paddingTop = 5;
  }

  return Object.keys(overrides).length === 0 ? value : [value, overrides];
}

interface NativeTextInputProps extends Omit<
  TextInputProps,
  | "allowFontScaling"
  | "autoCapitalize"
  | "autoComplete"
  | "blurOnSubmit"
  | "caretHidden"
  | "cursorColor"
  | "defaultValue"
  | "editable"
  | "enterKeyHint"
  | "focusNextOnSubmit"
  | "inputMode"
  | "keyboardType"
  | "onChange"
  | "onChangeText"
  | "onFocus"
  | "onBlur"
  | "onSubmitEditing"
  | "onSelectionChange"
  | "placeholder"
  | "readOnly"
  | "returnKeyType"
  | "selection"
  | "selectionHandleColor"
  | "showSoftInputOnFocus"
  | "style"
  | "textContentType"
  | "underlineColorAndroid"
  | "value"
> {
  readonly allowFontScaling: boolean;
  readonly autoCapitalize?: TextInputProps["autoCapitalize"];
  readonly autoComplete?: TextInputAutoComplete;
  readonly caretHidden?: boolean;
  readonly cursorColor?: string | null;
  readonly editable?: boolean;
  readonly keyboardType?: TextInputKeyboardType;
  readonly mostRecentEventCount: number;
  readonly onChangeText: NativeEventHandler;
  readonly onFocus: NativeEventHandler;
  readonly onBlur: NativeEventHandler;
  readonly onSubmitEditing?: NativeEventHandler;
  readonly onSelectionChange: NativeEventHandler;
  readonly placeholder?: string;
  readonly returnKeyType?: TextInputProps["returnKeyType"];
  readonly selection?: Required<TextInputSelection>;
  readonly selectionHandleColor?: string | null;
  readonly showSoftInputOnFocus?: boolean;
  readonly style?: StyleProp;
  readonly text?: string;
  readonly textContentType?: TextInputTextContentType;
  readonly underlineColorAndroid?: string;
}

const MAX_TEXT_INPUT_OFFSET = 2_147_483_647;

function textInputOffset(value: HostValue | undefined, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_TEXT_INPUT_OFFSET
  ) {
    throw new TypeError(
      `TextInput selection ${name} must be a non-negative 32-bit integer.`,
    );
  }
  return value;
}

function textInputSelection(
  value: TextInputSelection | undefined,
): Required<TextInputSelection> | undefined {
  if (value === undefined) return undefined;
  const start = textInputOffset(value.start, "start");
  const end = textInputOffset(value.end ?? start, "end");
  return { start, end };
}

function textInputEventSelection(
  event: Parameters<NativeEventHandler>[0],
): Required<TextInputSelection> {
  const payload = event.payload;
  const selection =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Readonly<Record<string, HostValue>>).selection
      : undefined;
  if (
    typeof selection !== "object" ||
    selection === null ||
    Array.isArray(selection)
  ) {
    throw new TypeError(
      "Native TextInput selection events must include a selection range.",
    );
  }
  const range = selection as Readonly<Record<string, HostValue>>;
  return {
    start: textInputOffset(range.start, "start"),
    end: textInputOffset(range.end, "end"),
  };
}

function textInputChange(event: Parameters<NativeEventHandler>[0]): {
  readonly eventCount: number;
  readonly text: string;
} {
  const payload = event.payload;
  const record =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Readonly<Record<string, HostValue>>)
      : undefined;
  const eventCount = record?.eventCount;
  if (
    typeof eventCount !== "number" ||
    !Number.isSafeInteger(eventCount) ||
    eventCount < 0
  ) {
    throw new TypeError(
      "Native TextInput change events must include a non-negative integer eventCount.",
    );
  }
  const nativeText = record?.text;
  if (typeof nativeText !== "string") {
    throw new TypeError(
      "Native TextInput change events must include the current text.",
    );
  }
  return { eventCount, text: nativeText };
}

function createTextInput(props: TextInputProps): NativeNode {
  const textInput = createElement("TextInput");
  const platform = nativeNodePlatform(textInput);
  const focusGroup = useContext(TextInputFocusGroupContext);
  const [mostRecentEventCount, setMostRecentEventCount] = createSignal(0);
  const [lastNativeText, setLastNativeText] = createSignal<string | undefined>(
    untrack(() => props.value),
    { ownedWrite: true },
  );
  const [lastNativeSelection, setLastNativeSelection] = createSignal<
    Required<TextInputSelection>
  >({ start: -1, end: -1 }, { ownedWrite: true });
  const text = createMemo(() => props.value ?? props.defaultValue);
  const selection = createMemo(() => textInputSelection(props.selection));
  const style = createMemo(() =>
    normalizeTextInputStyle(props.style, platform, props.multiline === true),
  );
  const allowFontScaling = createMemo(() => props.allowFontScaling ?? true);
  const autoCapitalize = createMemo(() =>
    platform === "android"
      ? (props.autoCapitalize ?? "sentences")
      : props.autoCapitalize,
  );
  const editable = createMemo(() =>
    props.readOnly === undefined ? props.editable : !props.readOnly,
  );
  const keyboardType = createMemo<TextInputKeyboardType | undefined>(() => {
    switch (props.inputMode) {
      case "decimal":
        return "decimal-pad";
      case "email":
        return "email-address";
      case "none":
      case "text":
        return "default";
      case "numeric":
        return "number-pad";
      case "search":
        return platform === "ios" ? "web-search" : "default";
      case "tel":
        return "phone-pad";
      case "url":
        return "url";
      case undefined:
        return props.keyboardType;
    }
  });
  const showSoftInputOnFocus = createMemo(() =>
    props.inputMode === undefined
      ? props.showSoftInputOnFocus
      : props.inputMode !== "none",
  );
  const caretHidden = createMemo(() =>
    props.inputMode === "none" ? true : props.caretHidden,
  );
  const cursorColor = createMemo(() =>
    platform === "android"
      ? props.cursorColor === undefined
        ? props.selectionColor
        : props.cursorColor
      : undefined,
  );
  const placeholder = createMemo(() =>
    platform === "android" ? (props.placeholder ?? "") : props.placeholder,
  );
  const selectionHandleColor = createMemo(() =>
    platform === "android"
      ? props.selectionHandleColor === undefined
        ? props.selectionColor
        : props.selectionHandleColor
      : undefined,
  );
  const underlineColorAndroid = createMemo(() =>
    platform === "android"
      ? (props.underlineColorAndroid ?? "transparent")
      : undefined,
  );
  const autoComplete = createMemo<TextInputAutoComplete | undefined>(() => {
    const value = props.autoComplete;
    if (platform !== "android" || value === undefined) return undefined;
    return TEXT_INPUT_ANDROID_AUTOCOMPLETE[value] ?? value;
  });
  const textContentType = createMemo<TextInputTextContentType | undefined>(
    () => {
      if (platform !== "ios") return undefined;
      if (props.textContentType !== undefined) return props.textContentType;
      const value = props.autoComplete;
      return value === undefined
        ? undefined
        : TEXT_INPUT_IOS_AUTOCOMPLETE[value];
    },
  );
  const submitBehavior = createMemo<
    NonNullable<TextInputProps["submitBehavior"]>
  >(() => {
    const multiline = props.multiline ?? false;
    if (props.submitBehavior !== undefined) {
      return !multiline && props.submitBehavior === "newline"
        ? "blurAndSubmit"
        : props.submitBehavior;
    }
    if (multiline) {
      return props.blurOnSubmit === true ? "blurAndSubmit" : "newline";
    }
    return props.blurOnSubmit === false ? "submit" : "blurAndSubmit";
  });
  const participatesInSubmitTraversal = createMemo(
    () =>
      focusGroup !== null &&
      props.focusNextOnSubmit !== false &&
      submitBehavior() !== "newline",
  );
  const focusRegistration = focusGroup?.register(
    textInput,
    () => editable() !== false,
  );
  const returnKeyType = createMemo<TextInputProps["returnKeyType"]>(() => {
    if (props.enterKeyHint !== undefined) {
      return TEXT_INPUT_ENTER_KEY_HINT_RETURN_TYPES[props.enterKeyHint];
    }
    if (props.returnKeyType !== undefined) return props.returnKeyType;
    if (!participatesInSubmitTraversal()) return undefined;
    return focusRegistration?.hasNext() === true ? "next" : "done";
  });
  const handleChangeText: NativeEventHandler = (event) => {
    const { eventCount, text: nativeText } = textInputChange(event);
    if (eventCount < mostRecentEventCount()) return;
    const textChanged = nativeText !== lastNativeText();
    setLastNativeText(nativeText);
    setMostRecentEventCount(eventCount);
    const changeResult = props.onChange?.(event as TextInputChangeEvent);
    const changeTextResult = textChanged
      ? props.onChangeText?.(nativeText)
      : undefined;
    return combinePendingCallbackResults(changeResult, changeTextResult);
  };
  const handleSelectionChange: NativeEventHandler = (event) => {
    setLastNativeSelection(textInputEventSelection(event));
    props.onSelectionChange?.(event);
  };
  const handleFocus: NativeEventHandler = (event) => {
    const visibilityResult = keyboardAwareScrollController(event.target)?.focus(
      event.target,
    );
    const focusResult = props.onFocus?.(event);
    return combinePendingCallbackResults(visibilityResult, focusResult);
  };
  const handleBlur: NativeEventHandler = (event) => {
    keyboardAwareScrollController(event.target)?.blur(event.target);
    return props.onBlur?.(event);
  };
  const handleSubmitEditing: NativeEventHandler = (event) => {
    const traversalResult = participatesInSubmitTraversal()
      ? focusRegistration?.focusNext()
      : undefined;
    const submitResult = props.onSubmitEditing?.(event);
    return combinePendingCallbackResults(traversalResult, submitResult);
  };
  effect(
    () => {
      const desired = selection();
      const observed = lastNativeSelection();
      const selectionChanged =
        desired !== undefined &&
        (desired.start !== observed.start || desired.end !== observed.end);
      const desiredText =
        typeof props.value === "string" ? props.value : undefined;
      const textChanged =
        desiredText !== undefined && desiredText !== lastNativeText();
      if (!selectionChanged && !textChanged) {
        return undefined;
      }
      return {
        desired,
        desiredText,
        eventCount: mostRecentEventCount(),
        text: text() ?? null,
      };
    },
    (update) => {
      if (update === undefined) return;
      if (update.desired !== undefined) {
        setLastNativeSelection(update.desired);
      }
      if (update.desiredText !== undefined) {
        setLastNativeText(update.desiredText);
      }
      void textInput.dispatchCommand(
        "setTextAndSelection",
        update.eventCount,
        update.text,
        update.desired?.start ?? -1,
        update.desired?.end ?? -1,
      );
    },
  );
  const nativeProperties = new Set<string | symbol>([
    "allowFontScaling",
    "autoCapitalize",
    "autoComplete",
    "caretHidden",
    "cursorColor",
    "editable",
    "keyboardType",
    "mostRecentEventCount",
    "onChangeText",
    "onFocus",
    "onBlur",
    "onSelectionChange",
    "placeholder",
    "returnKeyType",
    "selection",
    "selectionHandleColor",
    "showSoftInputOnFocus",
    "style",
    "submitBehavior",
    "text",
    "textContentType",
    "underlineColorAndroid",
  ]);
  const observesSubmit =
    focusRegistration !== undefined || props.onSubmitEditing !== undefined;
  if (observesSubmit) nativeProperties.add("onSubmitEditing");
  const translatedProperties = new Set<string | symbol>([
    "allowFontScaling",
    "autoCapitalize",
    "autoComplete",
    "blurOnSubmit",
    "caretHidden",
    "cursorColor",
    "defaultValue",
    "editable",
    "enterKeyHint",
    "focusNextOnSubmit",
    "inputMode",
    "keyboardType",
    "onChange",
    "onSubmitEditing",
    "placeholder",
    "readOnly",
    "returnKeyType",
    "selectionHandleColor",
    "showSoftInputOnFocus",
    "style",
    "textContentType",
    "underlineColorAndroid",
    "value",
  ]);
  const nativeProps = new Proxy({} as NativeTextInputProps, {
    get(_target, property) {
      if (property === "allowFontScaling") return allowFontScaling();
      if (property === "autoCapitalize") return autoCapitalize();
      if (property === "autoComplete") return autoComplete();
      if (property === "caretHidden") return caretHidden();
      if (property === "cursorColor") return cursorColor();
      if (property === "editable") return editable();
      if (property === "keyboardType") return keyboardType();
      if (property === "mostRecentEventCount") return mostRecentEventCount();
      if (property === "onChangeText") return handleChangeText;
      if (property === "onFocus") return handleFocus;
      if (property === "onBlur") return handleBlur;
      if (property === "onSubmitEditing") return handleSubmitEditing;
      if (property === "onSelectionChange") return handleSelectionChange;
      if (property === "placeholder") return placeholder();
      if (property === "returnKeyType") return returnKeyType();
      if (property === "selection") return selection();
      if (property === "selectionHandleColor") {
        return selectionHandleColor();
      }
      if (property === "showSoftInputOnFocus") return showSoftInputOnFocus();
      if (property === "style") return style();
      if (property === "submitBehavior") return submitBehavior();
      if (property === "text") return text();
      if (property === "textContentType") return textContentType();
      if (property === "underlineColorAndroid") {
        return underlineColorAndroid();
      }
      if (translatedProperties.has(property)) return undefined;
      return Reflect.get(props, property, props);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (nativeProperties.has(property)) {
        return { configurable: true, enumerable: true };
      }
      if (translatedProperties.has(property)) return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(props, property);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
    ownKeys() {
      const keys = Reflect.ownKeys(props).filter(
        (property) => !translatedProperties.has(property),
      );
      for (const property of nativeProperties) {
        if (!keys.includes(property)) keys.push(property);
      }
      return keys;
    },
  });
  spread(textInput, nativeProps);
  return textInput;
}

export const View = createNativeComponent<ViewProps>("View");
export const StatusBar: Component<StatusBarProps> = createStatusBar;
export const SafeAreaView: NativeComponent<SafeAreaViewProps> =
  createSafeAreaView;
export const KeyboardAvoidingView: NativeComponent<KeyboardAvoidingViewProps> =
  createKeyboardAvoidingView;
export const Text = createNativeComponent<TextProps>("Text");
export const Image: NativeComponent<ImageProps> = createImage;
export const Pressable: NativeComponent<PressableProps> = createPressable;
export const Button: NativeComponent<ButtonProps> = createButton;
export const ScrollView: NativeComponent<ScrollViewProps> = createScrollView;
export const RefreshableScrollView: NativeComponent<RefreshableScrollViewProps> =
  createRefreshableScrollView;
export const KeyboardAwareScrollView: NativeComponent<KeyboardAwareScrollViewProps> =
  createKeyboardAwareScrollView;
export const TextInput: NativeComponent<TextInputProps> = createTextInput;
export const ActivityIndicator: NativeComponent<ActivityIndicatorProps> =
  createActivityIndicator;
export const Switch: NativeComponent<SwitchProps> = createSwitch;
export const Modal: NativeComponent<ModalProps> = createModal;
export const Screen: NativeComponent<ScreenProps> = createScreen;
export const ScreenStack: NativeComponent<ScreenStackProps> = createScreenStack;
export const ScreenHeader: NativeComponent<ScreenHeaderProps> =
  createScreenHeader;
export const ScreenHeaderSubview: NativeComponent<ScreenHeaderSubviewProps> =
  createScreenHeaderSubview;
export const TabsHost: NativeComponent<TabsHostProps> = createTabsHost;
export const TabsScreen: NativeComponent<TabsScreenProps> = createTabsScreen;
export const VirtualizedList = createVirtualizedList;

export function createNativeComponentDescriptor(
  name: string,
  options: Partial<Omit<NativeComponentDescriptor, "name">> = {},
): NativeComponentDescriptor {
  assertNativeComponentName(name);
  return {
    name,
    acceptsRawText: false,
    bubblingEvents: [],
    directEvents: [],
    commands: {},
    ...options,
  };
}

const ACCESSIBILITY_DIRECT_EVENTS = [
  "accessibilityAction",
  "accessibilityEscape",
  "accessibilityTap",
  "magicTap",
] as const;

export const CORE_COMPONENT_DESCRIPTORS: readonly NativeComponentDescriptor[] =
  [
    createNativeComponentDescriptor("RootView"),
    createNativeComponentDescriptor("View", {
      directEvents: ["layout", ...ACCESSIBILITY_DIRECT_EVENTS],
      commands: { accessibilityFocus: [] },
    }),
    createNativeComponentDescriptor("RNCSafeAreaProvider", {
      directEvents: ["insetsChange", "layout", ...ACCESSIBILITY_DIRECT_EVENTS],
      commands: { accessibilityFocus: [] },
    }),
    createNativeComponentDescriptor("RNCSafeAreaView", {
      directEvents: ["layout", ...ACCESSIBILITY_DIRECT_EVENTS],
      commands: { accessibilityFocus: [] },
    }),
    createNativeComponentDescriptor("Text", {
      acceptsRawText: true,
      bubblingEvents: ["press"],
      directEvents: ACCESSIBILITY_DIRECT_EVENTS,
      commands: { accessibilityFocus: [] },
    }),
    createNativeComponentDescriptor("Image", {
      directEvents: ["load", "error", ...ACCESSIBILITY_DIRECT_EVENTS],
      commands: { accessibilityFocus: [] },
    }),
    createNativeComponentDescriptor("Pressable", {
      bubblingEvents: [
        "press",
        "pressCancel",
        "pressIn",
        "pressMove",
        "pressOut",
        "longPress",
      ],
      directEvents: [
        "layout",
        "focus",
        "blur",
        "hoverIn",
        "hoverOut",
        ...ACCESSIBILITY_DIRECT_EVENTS,
      ],
      commands: {
        focus: [],
        blur: [],
        hotspotUpdate: ["x", "y"],
        setPressed: ["pressed"],
        accessibilityFocus: [],
      },
    }),
    createNativeComponentDescriptor("ScrollView", {
      bubblingEvents: ["scroll", "scrollBeginDrag", "scrollEndDrag"],
      directEvents: ACCESSIBILITY_DIRECT_EVENTS,
      commands: {
        scrollTo: ["x", "y", "animated"],
        scrollToEnd: ["animated"],
        accessibilityFocus: [],
      },
    }),
    createNativeComponentDescriptor("ScrollContentView"),
    createNativeComponentDescriptor("RefreshControl", {
      directEvents: ["refresh", ...ACCESSIBILITY_DIRECT_EVENTS],
      commands: {
        setNativeRefreshing: ["refreshing"],
        accessibilityFocus: [],
      },
    }),
    createNativeComponentDescriptor("TextInput", {
      bubblingEvents: ["endEditing", "keyPress", "scroll"],
      directEvents: [
        "changeText",
        "contentSizeChange",
        "focus",
        "blur",
        "selectionChange",
        "submitEditing",
        ...ACCESSIBILITY_DIRECT_EVENTS,
      ],
      commands: {
        focus: [],
        blur: [],
        setTextAndSelection: ["eventCount", "text", "start", "end"],
        accessibilityFocus: [],
      },
    }),
    createNativeComponentDescriptor("ActivityIndicator", {
      directEvents: ACCESSIBILITY_DIRECT_EVENTS,
      commands: { accessibilityFocus: [] },
    }),
    createNativeComponentDescriptor("Switch", {
      bubblingEvents: ["valueChange"],
      directEvents: ACCESSIBILITY_DIRECT_EVENTS,
      commands: { setValue: ["value"], accessibilityFocus: [] },
    }),
    createNativeComponentDescriptor("Modal", {
      directEvents: [
        "requestClose",
        "show",
        "dismiss",
        "orientationChange",
        ...ACCESSIBILITY_DIRECT_EVENTS,
      ],
    }),
    createNativeComponentDescriptor("Screen", {
      directEvents: [
        "blur",
        "dismiss",
        "focus",
        "gestureCancel",
        "nativeDismissCancel",
        "sheetDetentChange",
        ...ACCESSIBILITY_DIRECT_EVENTS,
      ],
    }),
    createNativeComponentDescriptor("ScreenStack", {
      directEvents: ["transitionEnd", ...ACCESSIBILITY_DIRECT_EVENTS],
      commands: { pop: ["count"], dismiss: [] },
    }),
    createNativeComponentDescriptor("ScreenHeader", {
      directEvents: [
        "pressHeaderBarButtonItem",
        "pressHeaderBarButtonMenuItem",
        ...ACCESSIBILITY_DIRECT_EVENTS,
      ],
    }),
    createNativeComponentDescriptor("ScreenHeaderSubview", {
      directEvents: ACCESSIBILITY_DIRECT_EVENTS,
    }),
    createNativeComponentDescriptor("TabsHost", {
      directEvents: [
        "tabSelected",
        "tabSelectionRejected",
        "tabSelectionPrevented",
        "moreTabSelected",
        ...ACCESSIBILITY_DIRECT_EVENTS,
      ],
    }),
    createNativeComponentDescriptor("TabsScreen", {
      directEvents: [
        "willAppear",
        "didAppear",
        "willDisappear",
        "didDisappear",
        ...ACCESSIBILITY_DIRECT_EVENTS,
      ],
    }),
  ];

export type {
  NativeEventHandler,
  NativeNode,
  NativeSyntheticEvent,
} from "@solid-native/renderer";
