export const UI_WORKLET_PROTOCOL_VERSION = 0 as const;

export const UI_WORKLET_MAX_INPUTS = 64;
export const UI_WORKLET_MAX_OUTPUTS = 64;
export const UI_WORKLET_MAX_EXPRESSION_DEPTH = 32;
export const UI_WORKLET_MAX_EXPRESSION_NODES = 512;
export const UI_WORKLET_MAX_TIMING_DURATION_MS = 60_000;
export const UI_WORKLET_MAX_TIMING_KEYFRAMES = 32;
export const UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES = 8_192;
export const UI_WORKLET_MIN_SPRING_MASS = 0.001;
export const UI_WORKLET_MAX_SPRING_MASS = 100;
export const UI_WORKLET_MIN_SPRING_STIFFNESS = 0.001;
export const UI_WORKLET_MAX_SPRING_STIFFNESS = 100_000;
export const UI_WORKLET_MAX_SPRING_DAMPING = 10_000;
export const UI_WORKLET_MAX_SPRING_INITIAL_VELOCITY = 100;
export const UI_WORKLET_MAX_SPRING_REST_SPEED = 100;
export const UI_WORKLET_MAX_SPRING_DURATION_MS = 60_000;
export const UI_WORKLET_MIN_DECAY_DECELERATION = 0.001;
export const UI_WORKLET_MAX_DECAY_DECELERATION = 1_000;
export const UI_WORKLET_MAX_DECAY_VELOCITY = 100_000;
export const UI_WORKLET_MAX_DECAY_VELOCITY_THRESHOLD = 10_000;
export const UI_WORKLET_MAX_DECAY_DURATION_MS = 60_000;

export type UIWorkletTimingEasing =
  "linear" | "ease-in" | "ease-out" | "ease-in-out";

export interface UIWorkletTiming {
  readonly durationMilliseconds: number;
  readonly easing: UIWorkletTimingEasing;
}

/** One complete positional target in a host-level native timing sequence. */
export interface UIWorkletTimingKeyframe {
  readonly inputs: readonly number[];
  readonly timing: UIWorkletTiming;
}

/** One named partial target accepted by a UIWorkletSession. */
export interface UIWorkletNamedTimingKeyframe {
  readonly inputs: Readonly<Record<string, number>>;
  readonly timing: UIWorkletTiming;
}

export interface UIWorkletSpring {
  readonly mass: number;
  readonly stiffness: number;
  readonly damping: number;
  /** Normalized input-vector progress per second. */
  readonly initialVelocity: number;
  /** Normalized input-vector progress per second. */
  readonly restSpeedThreshold: number;
  readonly restDisplacementThreshold: number;
  readonly maximumDurationMilliseconds: number;
}

export interface UIWorkletSpringSample {
  /** Normalized input-vector progress; may overshoot zero or one. */
  readonly position: number;
  /** Normalized input-vector progress per second. */
  readonly velocity: number;
  readonly settled: boolean;
}

export interface UIWorkletDecay {
  /** Exponential velocity loss per second. */
  readonly deceleration: number;
  /** Absolute input units per second. */
  readonly velocityThreshold: number;
  readonly maximumDurationMilliseconds: number;
}

export interface UIWorkletDecaySample {
  /** Multiply each initial input velocity by this to get displacement. */
  readonly displacementFactorSeconds: number;
  /** Multiply each initial input velocity by this to get current velocity. */
  readonly velocityFactor: number;
  /** Maximum absolute input velocity in units per second. */
  readonly speed: number;
  readonly settled: boolean;
}

export interface UIWorkletFrameStatistics {
  readonly frameCount: number;
  readonly intervalCount: number;
  readonly sampledIntervalCount: number;
  readonly droppedIntervalSampleCount: number;
  readonly firstFrameTimeMilliseconds: number;
  readonly lastFrameTimeMilliseconds: number;
  readonly minimumFrameIntervalMilliseconds: number;
  readonly maximumFrameIntervalMilliseconds: number;
  readonly meanFrameIntervalMilliseconds: number;
  readonly p50FrameIntervalMilliseconds: number;
  readonly p95FrameIntervalMilliseconds: number;
  readonly p99FrameIntervalMilliseconds: number;
}

export interface UIWorkletPanGesture {
  readonly xInput: string;
  readonly yInput: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Optional native velocity handoff when the recognizer ends successfully. */
  readonly releaseDecay?: UIWorkletDecay;
}

export type UIWorkletPanGesturePhase = "begin" | "change" | "end" | "cancel";

export type UIWorkletBinaryOperator =
  "add" | "subtract" | "multiply" | "divide" | "min" | "max";

export type UIWorkletExpression =
  | {
      readonly kind: "constant";
      readonly value: number;
    }
  | {
      readonly kind: "input";
      readonly name: string;
    }
  | {
      readonly kind: "binary";
      readonly operator: UIWorkletBinaryOperator;
      readonly left: UIWorkletExpression;
      readonly right: UIWorkletExpression;
    }
  | {
      readonly kind: "abs";
      readonly value: UIWorkletExpression;
    }
  | {
      readonly kind: "negate";
      readonly value: UIWorkletExpression;
    }
  | {
      readonly kind: "clamp";
      readonly value: UIWorkletExpression;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "interpolate";
      readonly value: UIWorkletExpression;
      readonly inputRange: readonly [number, number];
      readonly outputRange: readonly [number, number];
      readonly extrapolate: "clamp" | "extend";
    };

/** A literal number is shorthand for a constant in the authoring API. */
export type UIWorkletOperand = UIWorkletExpression | number;

export type UIWorkletInputExpressions<
  TInputs extends Readonly<Record<string, number>>,
> = {
  readonly [TName in keyof TInputs]: {
    readonly kind: "input";
    readonly name: TName & string;
  };
};

/** Typed expression helpers supplied to the concise graph-authoring callback. */
export interface UIWorkletExpressionBuilder {
  constant(value: number): UIWorkletExpression;
  add(left: UIWorkletOperand, right: UIWorkletOperand): UIWorkletExpression;
  subtract(
    left: UIWorkletOperand,
    right: UIWorkletOperand,
  ): UIWorkletExpression;
  multiply(
    left: UIWorkletOperand,
    right: UIWorkletOperand,
  ): UIWorkletExpression;
  divide(left: UIWorkletOperand, right: UIWorkletOperand): UIWorkletExpression;
  min(left: UIWorkletOperand, right: UIWorkletOperand): UIWorkletExpression;
  max(left: UIWorkletOperand, right: UIWorkletOperand): UIWorkletExpression;
  abs(value: UIWorkletOperand): UIWorkletExpression;
  negate(value: UIWorkletOperand): UIWorkletExpression;
  clamp(value: UIWorkletOperand, min: number, max: number): UIWorkletExpression;
  interpolate(
    value: UIWorkletOperand,
    inputRange: readonly [number, number],
    outputRange: readonly [number, number],
    extrapolate?: "clamp" | "extend",
  ): UIWorkletExpression;
}

export interface UIWorkletInput {
  readonly name: string;
  readonly initialValue: number;
}

export interface UIWorkletOutput {
  readonly name: string;
  readonly expression: UIWorkletExpression;
}

/**
 * Transport-safe numeric graph intended for compilation by a native UI
 * runtime. It deliberately contains no JavaScript closures or captured values.
 */
export interface UIWorkletGraph {
  readonly protocolVersion: typeof UI_WORKLET_PROTOCOL_VERSION;
  readonly inputs: readonly UIWorkletInput[];
  readonly outputs: readonly UIWorkletOutput[];
}

export type UIWorkletHandle = number;

export interface UIWorkletHost {
  readonly protocolVersion: typeof UI_WORKLET_PROTOCOL_VERSION;
  installGraph(graph: UIWorkletGraph): UIWorkletHandle;
  /** Must publish the complete input frame and its derived outputs atomically. */
  updateGraphInputs(
    handle: UIWorkletHandle,
    inputs: readonly number[],
    timestamp: number,
  ): void;
  /**
   * Optional native/display-thread extension. A newer input publication or
   * driver request interrupts active motion from its last evaluated frame.
   */
  animateGraphInputs?(
    handle: UIWorkletHandle,
    inputs: readonly number[],
    timestamp: number,
    timing: UIWorkletTiming,
  ): void;
  /** Optional finite sequence of complete native timing targets. */
  animateGraphKeyframes?(
    handle: UIWorkletHandle,
    keyframes: readonly UIWorkletTimingKeyframe[],
    timestamp: number,
  ): void;
  /** Optional native/display-thread analytical spring extension. */
  springGraphInputs?(
    handle: UIWorkletHandle,
    inputs: readonly number[],
    timestamp: number,
    spring: UIWorkletSpring,
  ): void;
  /** Optional native/display-thread analytical velocity-decay extension. */
  decayGraphInputs?(
    handle: UIWorkletHandle,
    velocities: readonly number[],
    timestamp: number,
    decay: UIWorkletDecay,
  ): void;
  /**
   * Stops an active native driver and returns the exact frozen input vector.
   * The returned vector lets the session resume partial updates without using
   * a stale JavaScript-side target.
   */
  cancelGraphAnimation?(
    handle: UIWorkletHandle,
    timestamp: number,
  ): readonly number[];
  /**
   * Optional native-input extension. Attachment transfers the graph input
   * vector to the host until it is detached or the graph is destroyed.
   */
  attachPanGesture?(
    handle: UIWorkletHandle,
    gesture: UIWorkletPanGesture,
  ): void;
  /** Releases native pan ownership and returns the exact frozen input vector. */
  detachPanGesture?(
    handle: UIWorkletHandle,
    timestamp: number,
  ): readonly number[];
  destroyGraph(handle: UIWorkletHandle): void;
}

export interface UIWorkletSessionOptions {
  /** Monotonic or epoch milliseconds used for JavaScript-originated updates. */
  readonly clock?: () => number;
  /**
   * Pull-based system or application preference checked for every new motion
   * request. `undefined` is treated as no preference while state is loading.
   */
  readonly reduceMotion?: () => boolean | undefined;
}

export interface UIWorkletSession {
  readonly graph: UIWorkletGraph;
  readonly handle: UIWorkletHandle;
  readonly disposed: boolean;
  readonly nativeInputsOwned: boolean;
  readonly inputs: Readonly<Record<string, number>>;
  /** Atomically replaces the named subset of graph inputs. */
  update(inputs: Readonly<Record<string, number>>, timestamp?: number): void;
  /** Animates the named subset as one complete native input vector. */
  animate(
    inputs: Readonly<Record<string, number>>,
    timing: UIWorkletTiming,
    timestamp?: number,
  ): void;
  /** Runs finite timing targets without a JavaScript wakeup between stages. */
  animateKeyframes(
    keyframes: readonly UIWorkletNamedTimingKeyframe[],
    timestamp?: number,
  ): void;
  /** Springs the named subset as one complete native input vector. */
  spring(
    inputs: Readonly<Record<string, number>>,
    spring: UIWorkletSpring,
    timestamp?: number,
  ): void;
  /** Decays named per-input velocities as one complete native vector. */
  decay(
    velocities: Readonly<Record<string, number>>,
    decay: UIWorkletDecay,
    timestamp?: number,
  ): void;
  /** Stops native motion and synchronizes inputs to its last evaluated frame. */
  cancel(timestamp?: number): void;
  /** Transfers this session's input vector to one native pan until detached. */
  attachPanGesture(gesture: UIWorkletPanGesture): void;
  /** Releases native pan ownership and synchronizes its final input vector. */
  detachPanGesture(timestamp?: number): void;
  /** Idempotently releases the installed graph. */
  dispose(): void;
}

export interface InMemoryUIWorkletSnapshot {
  readonly handle: UIWorkletHandle;
  readonly sequence: number;
  readonly inputs: Readonly<Record<string, number>>;
  readonly outputs: Readonly<Record<string, number>>;
  readonly timestamp?: number;
  readonly timingActive: boolean;
  readonly timingProgress: number;
  readonly timingFrameStatistics?: UIWorkletFrameStatistics;
  readonly springActive?: boolean;
  readonly springPosition?: number;
  readonly springVelocity?: number;
  readonly springFrameStatistics?: UIWorkletFrameStatistics;
  readonly decayActive?: boolean;
  readonly decayElapsedMilliseconds?: number;
  readonly decaySpeed?: number;
  readonly decayFrameStatistics?: UIWorkletFrameStatistics;
  readonly gestureAttached?: boolean;
  readonly gestureActive?: boolean;
  readonly gestureSequence?: number;
  readonly gestureTimestamp?: number;
}

export interface InMemoryUIWorkletHost extends UIWorkletHost {
  readonly activeGraphCount: number;
  /** Advances every active driver at one deterministic display timestamp. */
  advanceFrame(frameTimeMilliseconds: number): void;
  /** Delivers one deterministic native-clock pan sample. */
  dispatchPanGesture(
    handle: UIWorkletHandle,
    phase: UIWorkletPanGesturePhase,
    translationX: number,
    translationY: number,
    timestamp: number,
    velocityX?: number,
    velocityY?: number,
  ): void;
  snapshot(handle: UIWorkletHandle): InMemoryUIWorkletSnapshot;
}

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const BINARY_OPERATORS = new Set<UIWorkletBinaryOperator>([
  "add",
  "subtract",
  "multiply",
  "divide",
  "min",
  "max",
]);
const TIMING_EASINGS = new Set<UIWorkletTimingEasing>([
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
]);

function objectRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${context} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${context} contains unsupported field ${key}.`);
    }
  }
  for (const key of keys) {
    if (!(key in record)) {
      throw new TypeError(`${context} is missing field ${key}.`);
    }
  }
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${context} must be a finite number.`);
  }
  return value;
}

function identifier(value: unknown, context: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(
      `${context} must be an identifier of 1 to 64 ASCII characters.`,
    );
  }
  return value;
}

function numericRange(
  value: unknown,
  context: string,
  strictlyAscending: boolean,
): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(`${context} must contain exactly two numbers.`);
  }
  const lower = finiteNumber(value[0], `${context}[0]`);
  const upper = finiteNumber(value[1], `${context}[1]`);
  if (strictlyAscending && upper <= lower) {
    throw new RangeError(`${context} must be strictly ascending.`);
  }
  return Object.freeze([lower, upper]);
}

interface ExpressionBudget {
  nodes: number;
}

function parseExpression(
  value: unknown,
  inputs: ReadonlySet<string>,
  budget: ExpressionBudget,
  depth: number,
  context: string,
): UIWorkletExpression {
  if (depth > UI_WORKLET_MAX_EXPRESSION_DEPTH) {
    throw new RangeError(
      `${context} exceeds the maximum worklet expression depth of ${UI_WORKLET_MAX_EXPRESSION_DEPTH}.`,
    );
  }
  budget.nodes++;
  if (budget.nodes > UI_WORKLET_MAX_EXPRESSION_NODES) {
    throw new RangeError(
      `The worklet graph exceeds ${UI_WORKLET_MAX_EXPRESSION_NODES} expression nodes.`,
    );
  }
  const record = objectRecord(value, context);
  const kind = record.kind;
  if (kind === "constant") {
    exactKeys(record, ["kind", "value"], context);
    return Object.freeze({
      kind,
      value: finiteNumber(record.value, `${context}.value`),
    });
  }
  if (kind === "input") {
    exactKeys(record, ["kind", "name"], context);
    const name = identifier(record.name, `${context}.name`);
    if (!inputs.has(name)) {
      throw new RangeError(
        `${context} references undeclared worklet input ${name}.`,
      );
    }
    return Object.freeze({ kind, name });
  }
  if (kind === "binary") {
    exactKeys(record, ["kind", "operator", "left", "right"], context);
    if (
      typeof record.operator !== "string" ||
      !BINARY_OPERATORS.has(record.operator as UIWorkletBinaryOperator)
    ) {
      throw new TypeError(`${context}.operator is unsupported.`);
    }
    return Object.freeze({
      kind,
      operator: record.operator as UIWorkletBinaryOperator,
      left: parseExpression(
        record.left,
        inputs,
        budget,
        depth + 1,
        `${context}.left`,
      ),
      right: parseExpression(
        record.right,
        inputs,
        budget,
        depth + 1,
        `${context}.right`,
      ),
    });
  }
  if (kind === "abs" || kind === "negate") {
    exactKeys(record, ["kind", "value"], context);
    return Object.freeze({
      kind,
      value: parseExpression(
        record.value,
        inputs,
        budget,
        depth + 1,
        `${context}.value`,
      ),
    });
  }
  if (kind === "clamp") {
    exactKeys(record, ["kind", "value", "min", "max"], context);
    const min = finiteNumber(record.min, `${context}.min`);
    const max = finiteNumber(record.max, `${context}.max`);
    if (max < min) {
      throw new RangeError(`${context} clamp bounds must be ascending.`);
    }
    return Object.freeze({
      kind,
      value: parseExpression(
        record.value,
        inputs,
        budget,
        depth + 1,
        `${context}.value`,
      ),
      min,
      max,
    });
  }
  if (kind === "interpolate") {
    exactKeys(
      record,
      ["kind", "value", "inputRange", "outputRange", "extrapolate"],
      context,
    );
    if (record.extrapolate !== "clamp" && record.extrapolate !== "extend") {
      throw new TypeError(`${context}.extrapolate must be clamp or extend.`);
    }
    return Object.freeze({
      kind,
      value: parseExpression(
        record.value,
        inputs,
        budget,
        depth + 1,
        `${context}.value`,
      ),
      inputRange: numericRange(
        record.inputRange,
        `${context}.inputRange`,
        true,
      ),
      outputRange: numericRange(
        record.outputRange,
        `${context}.outputRange`,
        false,
      ),
      extrapolate: record.extrapolate,
    });
  }
  throw new TypeError(`${context}.kind is unsupported.`);
}

/** Validates, clones, and deeply freezes an untrusted worklet graph. */
export function parseUIWorkletGraph(value: unknown): UIWorkletGraph {
  const record = objectRecord(value, "UI worklet graph");
  exactKeys(
    record,
    ["protocolVersion", "inputs", "outputs"],
    "UI worklet graph",
  );
  if (record.protocolVersion !== UI_WORKLET_PROTOCOL_VERSION) {
    throw new RangeError(
      `Unsupported UI worklet protocol version ${String(record.protocolVersion)}.`,
    );
  }
  if (!Array.isArray(record.inputs)) {
    throw new TypeError("UI worklet graph inputs must be an array.");
  }
  if (record.inputs.length > UI_WORKLET_MAX_INPUTS) {
    throw new RangeError(
      `UI worklet graphs support at most ${UI_WORKLET_MAX_INPUTS} inputs.`,
    );
  }
  const inputNames = new Set<string>();
  const inputs = record.inputs.map((value, index) => {
    const context = `UI worklet input ${String(index)}`;
    const input = objectRecord(value, context);
    exactKeys(input, ["name", "initialValue"], context);
    const name = identifier(input.name, `${context}.name`);
    if (inputNames.has(name)) {
      throw new RangeError(`Duplicate UI worklet input ${name}.`);
    }
    inputNames.add(name);
    return Object.freeze({
      name,
      initialValue: finiteNumber(input.initialValue, `${context}.initialValue`),
    });
  });
  if (!Array.isArray(record.outputs) || record.outputs.length === 0) {
    throw new TypeError("UI worklet graph outputs must be a non-empty array.");
  }
  if (record.outputs.length > UI_WORKLET_MAX_OUTPUTS) {
    throw new RangeError(
      `UI worklet graphs support at most ${UI_WORKLET_MAX_OUTPUTS} outputs.`,
    );
  }
  const outputNames = new Set<string>();
  const budget: ExpressionBudget = { nodes: 0 };
  const outputs = record.outputs.map((value, index) => {
    const context = `UI worklet output ${String(index)}`;
    const output = objectRecord(value, context);
    exactKeys(output, ["name", "expression"], context);
    const name = identifier(output.name, `${context}.name`);
    if (outputNames.has(name)) {
      throw new RangeError(`Duplicate UI worklet output ${name}.`);
    }
    outputNames.add(name);
    return Object.freeze({
      name,
      expression: parseExpression(
        output.expression,
        inputNames,
        budget,
        1,
        `${context}.expression`,
      ),
    });
  });
  return Object.freeze({
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    inputs: Object.freeze(inputs),
    outputs: Object.freeze(outputs),
  });
}

function workletOperand(value: UIWorkletOperand): UIWorkletExpression {
  return typeof value === "number" ? { kind: "constant", value } : value;
}

function binaryWorkletExpression(
  operator: UIWorkletBinaryOperator,
  left: UIWorkletOperand,
  right: UIWorkletOperand,
): UIWorkletExpression {
  return {
    kind: "binary",
    operator,
    left: workletOperand(left),
    right: workletOperand(right),
  };
}

const UI_WORKLET_EXPRESSION_BUILDER = Object.freeze<UIWorkletExpressionBuilder>(
  {
    constant(value) {
      return { kind: "constant", value };
    },
    add(left, right) {
      return binaryWorkletExpression("add", left, right);
    },
    subtract(left, right) {
      return binaryWorkletExpression("subtract", left, right);
    },
    multiply(left, right) {
      return binaryWorkletExpression("multiply", left, right);
    },
    divide(left, right) {
      return binaryWorkletExpression("divide", left, right);
    },
    min(left, right) {
      return binaryWorkletExpression("min", left, right);
    },
    max(left, right) {
      return binaryWorkletExpression("max", left, right);
    },
    abs(value) {
      return { kind: "abs", value: workletOperand(value) };
    },
    negate(value) {
      return { kind: "negate", value: workletOperand(value) };
    },
    clamp(value, min, max) {
      return { kind: "clamp", value: workletOperand(value), min, max };
    },
    interpolate(value, inputRange, outputRange, extrapolate = "clamp") {
      return {
        kind: "interpolate",
        value: workletOperand(value),
        inputRange,
        outputRange,
        extrapolate,
      };
    },
  },
);

/** Validates an explicit transport-level graph definition. */
export function createUIWorkletGraph(
  definition: UIWorkletGraph,
): UIWorkletGraph;

/**
 * Builds a transport-safe graph from named initial inputs and typed numeric
 * expressions. The callback executes once while the graph is defined; it is
 * never serialized or run on the UI thread.
 */
export function createUIWorkletGraph<
  const TInputs extends Readonly<Record<string, number>>,
>(
  initialInputs: TInputs,
  defineOutputs: (
    inputs: UIWorkletInputExpressions<TInputs>,
    expression: UIWorkletExpressionBuilder,
  ) => Readonly<Record<string, UIWorkletOperand>>,
): UIWorkletGraph;

export function createUIWorkletGraph<
  const TInputs extends Readonly<Record<string, number>>,
>(
  definitionOrInputs: UIWorkletGraph | TInputs,
  defineOutputs?: (
    inputs: UIWorkletInputExpressions<TInputs>,
    expression: UIWorkletExpressionBuilder,
  ) => Readonly<Record<string, UIWorkletOperand>>,
): UIWorkletGraph {
  if (defineOutputs === undefined) {
    return parseUIWorkletGraph(definitionOrInputs);
  }
  if (typeof defineOutputs !== "function") {
    throw new TypeError("UI worklet outputs must be defined by a function.");
  }
  const initialInputs = objectRecord(
    definitionOrInputs,
    "UI worklet initial inputs",
  ) as TInputs;
  const inputExpressions: Record<string, UIWorkletExpression> = {};
  for (const name of Object.keys(initialInputs)) {
    inputExpressions[name] = { kind: "input", name };
  }
  const definedOutputs = objectRecord(
    defineOutputs(
      Object.freeze(inputExpressions) as UIWorkletInputExpressions<TInputs>,
      UI_WORKLET_EXPRESSION_BUILDER,
    ),
    "UI worklet defined outputs",
  );
  const outputs = Object.entries(definedOutputs).map(([name, expression]) => ({
    name,
    expression: workletOperand(expression as UIWorkletOperand),
  }));
  return parseUIWorkletGraph({
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    inputs: Object.entries(initialInputs).map(([name, initialValue]) => ({
      name,
      initialValue,
    })),
    outputs,
  });
}

/** Validates and freezes one bounded native timing request. */
export function parseUIWorkletTiming(value: unknown): UIWorkletTiming {
  const record = objectRecord(value, "UI worklet timing");
  exactKeys(record, ["durationMilliseconds", "easing"], "UI worklet timing");
  const durationMilliseconds = finiteNumber(
    record.durationMilliseconds,
    "UI worklet timing duration",
  );
  if (
    durationMilliseconds <= 0 ||
    durationMilliseconds > UI_WORKLET_MAX_TIMING_DURATION_MS
  ) {
    throw new RangeError(
      `UI worklet timing duration must be greater than zero and at most ${UI_WORKLET_MAX_TIMING_DURATION_MS} milliseconds.`,
    );
  }
  if (
    typeof record.easing !== "string" ||
    !TIMING_EASINGS.has(record.easing as UIWorkletTimingEasing)
  ) {
    throw new TypeError("UI worklet timing easing is unsupported.");
  }
  return Object.freeze({
    durationMilliseconds,
    easing: record.easing as UIWorkletTimingEasing,
  });
}

/** Validates and freezes one bounded analytical native spring. */
export function parseUIWorkletSpring(value: unknown): UIWorkletSpring {
  const record = objectRecord(value, "UI worklet spring");
  exactKeys(
    record,
    [
      "mass",
      "stiffness",
      "damping",
      "initialVelocity",
      "restSpeedThreshold",
      "restDisplacementThreshold",
      "maximumDurationMilliseconds",
    ],
    "UI worklet spring",
  );
  const mass = finiteNumber(record.mass, "UI worklet spring mass");
  const stiffness = finiteNumber(
    record.stiffness,
    "UI worklet spring stiffness",
  );
  const damping = finiteNumber(record.damping, "UI worklet spring damping");
  const initialVelocity = finiteNumber(
    record.initialVelocity,
    "UI worklet spring initial velocity",
  );
  const restSpeedThreshold = finiteNumber(
    record.restSpeedThreshold,
    "UI worklet spring rest speed threshold",
  );
  const restDisplacementThreshold = finiteNumber(
    record.restDisplacementThreshold,
    "UI worklet spring rest displacement threshold",
  );
  const maximumDurationMilliseconds = finiteNumber(
    record.maximumDurationMilliseconds,
    "UI worklet spring maximum duration",
  );
  if (mass < UI_WORKLET_MIN_SPRING_MASS || mass > UI_WORKLET_MAX_SPRING_MASS) {
    throw new RangeError(
      `UI worklet spring mass must be between ${UI_WORKLET_MIN_SPRING_MASS} and ${UI_WORKLET_MAX_SPRING_MASS}.`,
    );
  }
  if (
    stiffness < UI_WORKLET_MIN_SPRING_STIFFNESS ||
    stiffness > UI_WORKLET_MAX_SPRING_STIFFNESS
  ) {
    throw new RangeError(
      `UI worklet spring stiffness must be between ${UI_WORKLET_MIN_SPRING_STIFFNESS} and ${UI_WORKLET_MAX_SPRING_STIFFNESS}.`,
    );
  }
  if (damping < 0 || damping > UI_WORKLET_MAX_SPRING_DAMPING) {
    throw new RangeError(
      `UI worklet spring damping must be between zero and ${UI_WORKLET_MAX_SPRING_DAMPING}.`,
    );
  }
  if (Math.abs(initialVelocity) > UI_WORKLET_MAX_SPRING_INITIAL_VELOCITY) {
    throw new RangeError(
      `UI worklet spring initial velocity magnitude must be at most ${UI_WORKLET_MAX_SPRING_INITIAL_VELOCITY}.`,
    );
  }
  if (
    restSpeedThreshold <= 0 ||
    restSpeedThreshold > UI_WORKLET_MAX_SPRING_REST_SPEED
  ) {
    throw new RangeError(
      `UI worklet spring rest speed threshold must be greater than zero and at most ${UI_WORKLET_MAX_SPRING_REST_SPEED}.`,
    );
  }
  if (restDisplacementThreshold <= 0 || restDisplacementThreshold >= 1) {
    throw new RangeError(
      "UI worklet spring rest displacement threshold must be greater than zero and less than one.",
    );
  }
  if (
    maximumDurationMilliseconds <= 0 ||
    maximumDurationMilliseconds > UI_WORKLET_MAX_SPRING_DURATION_MS
  ) {
    throw new RangeError(
      `UI worklet spring maximum duration must be greater than zero and at most ${UI_WORKLET_MAX_SPRING_DURATION_MS} milliseconds.`,
    );
  }
  return Object.freeze({
    mass,
    stiffness,
    damping,
    initialVelocity,
    restSpeedThreshold,
    restDisplacementThreshold,
    maximumDurationMilliseconds,
  });
}

/** Validates and freezes one bounded analytical native velocity decay. */
export function parseUIWorkletDecay(value: unknown): UIWorkletDecay {
  const record = objectRecord(value, "UI worklet decay");
  exactKeys(
    record,
    ["deceleration", "velocityThreshold", "maximumDurationMilliseconds"],
    "UI worklet decay",
  );
  const deceleration = finiteNumber(
    record.deceleration,
    "UI worklet decay deceleration",
  );
  const velocityThreshold = finiteNumber(
    record.velocityThreshold,
    "UI worklet decay velocity threshold",
  );
  const maximumDurationMilliseconds = finiteNumber(
    record.maximumDurationMilliseconds,
    "UI worklet decay maximum duration",
  );
  if (
    deceleration < UI_WORKLET_MIN_DECAY_DECELERATION ||
    deceleration > UI_WORKLET_MAX_DECAY_DECELERATION
  ) {
    throw new RangeError(
      `UI worklet decay deceleration must be between ${UI_WORKLET_MIN_DECAY_DECELERATION} and ${UI_WORKLET_MAX_DECAY_DECELERATION} per second.`,
    );
  }
  if (
    velocityThreshold <= 0 ||
    velocityThreshold > UI_WORKLET_MAX_DECAY_VELOCITY_THRESHOLD
  ) {
    throw new RangeError(
      `UI worklet decay velocity threshold must be greater than zero and at most ${UI_WORKLET_MAX_DECAY_VELOCITY_THRESHOLD}.`,
    );
  }
  if (
    maximumDurationMilliseconds <= 0 ||
    maximumDurationMilliseconds > UI_WORKLET_MAX_DECAY_DURATION_MS
  ) {
    throw new RangeError(
      `UI worklet decay maximum duration must be greater than zero and at most ${UI_WORKLET_MAX_DECAY_DURATION_MS} milliseconds.`,
    );
  }
  return Object.freeze({
    deceleration,
    velocityThreshold,
    maximumDurationMilliseconds,
  });
}

/** Validates and freezes one bounded native pan-to-input mapping. */
export function parseUIWorkletPanGesture(
  value: unknown,
  graphValue: UIWorkletGraph,
): UIWorkletPanGesture {
  const graph = parseUIWorkletGraph(graphValue);
  const record = objectRecord(value, "UI worklet pan gesture");
  const hasReleaseDecay = Object.prototype.hasOwnProperty.call(
    record,
    "releaseDecay",
  );
  exactKeys(
    record,
    [
      "xInput",
      "yInput",
      "minX",
      "maxX",
      "minY",
      "maxY",
      ...(hasReleaseDecay ? ["releaseDecay"] : []),
    ],
    "UI worklet pan gesture",
  );
  const xInput = identifier(record.xInput, "UI worklet pan xInput");
  const yInput = identifier(record.yInput, "UI worklet pan yInput");
  if (xInput === yInput) {
    throw new RangeError("UI worklet pan inputs must be distinct.");
  }
  const inputs = new Set(graph.inputs.map((input) => input.name));
  if (!inputs.has(xInput)) {
    throw new RangeError(`Unknown UI worklet pan input ${xInput}.`);
  }
  if (!inputs.has(yInput)) {
    throw new RangeError(`Unknown UI worklet pan input ${yInput}.`);
  }
  const minX = finiteNumber(record.minX, "UI worklet pan minX");
  const maxX = finiteNumber(record.maxX, "UI worklet pan maxX");
  const minY = finiteNumber(record.minY, "UI worklet pan minY");
  const maxY = finiteNumber(record.maxY, "UI worklet pan maxY");
  if (maxX < minX || maxY < minY) {
    throw new RangeError("UI worklet pan bounds must be ascending.");
  }
  return Object.freeze({
    xInput,
    yInput,
    minX,
    maxX,
    minY,
    maxY,
    ...(hasReleaseDecay
      ? { releaseDecay: parseUIWorkletDecay(record.releaseDecay) }
      : {}),
  });
}

/** Reference easing semantics shared by deterministic and native hosts. */
export function evaluateUIWorkletTimingProgress(
  timingValue: UIWorkletTiming,
  elapsedMillisecondsValue: number,
): number {
  const timing = parseUIWorkletTiming(timingValue);
  const elapsedMilliseconds = finiteNumber(
    elapsedMillisecondsValue,
    "UI worklet timing elapsed time",
  );
  if (elapsedMilliseconds < 0) {
    throw new RangeError(
      "UI worklet timing elapsed time must be non-negative.",
    );
  }
  const progress = Math.min(
    1,
    elapsedMilliseconds / timing.durationMilliseconds,
  );
  switch (timing.easing) {
    case "linear":
      return progress;
    case "ease-in":
      return progress * progress;
    case "ease-out":
      return 1 - (1 - progress) * (1 - progress);
    case "ease-in-out":
      return progress < 0.5
        ? 2 * progress * progress
        : 1 - ((-2 * progress + 2) * (-2 * progress + 2)) / 2;
  }
}

/**
 * Analytical damped-harmonic-oscillator reference. Its result depends on
 * elapsed time rather than the number of display callbacks.
 */
export function evaluateUIWorkletSpring(
  springValue: UIWorkletSpring,
  elapsedMillisecondsValue: number,
): UIWorkletSpringSample {
  const spring = parseUIWorkletSpring(springValue);
  const elapsedMilliseconds = finiteNumber(
    elapsedMillisecondsValue,
    "UI worklet spring elapsed time",
  );
  if (elapsedMilliseconds < 0) {
    throw new RangeError(
      "UI worklet spring elapsed time must be non-negative.",
    );
  }
  if (elapsedMilliseconds >= spring.maximumDurationMilliseconds) {
    return Object.freeze({ position: 1, velocity: 0, settled: true });
  }
  if (elapsedMilliseconds === 0) {
    return Object.freeze({
      position: 0,
      velocity: spring.initialVelocity,
      settled: false,
    });
  }

  const elapsedSeconds = elapsedMilliseconds / 1_000;
  const naturalFrequency = Math.sqrt(spring.stiffness / spring.mass);
  const dampingRatio =
    spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
  const initialDisplacement = -1;
  let displacement: number;
  let velocity: number;

  if (dampingRatio < 1 - 1e-7) {
    const dampedFrequency =
      naturalFrequency * Math.sqrt(1 - dampingRatio * dampingRatio);
    const decay = Math.exp(-dampingRatio * naturalFrequency * elapsedSeconds);
    const cosine = Math.cos(dampedFrequency * elapsedSeconds);
    const sine = Math.sin(dampedFrequency * elapsedSeconds);
    const sineCoefficient =
      (spring.initialVelocity +
        dampingRatio * naturalFrequency * initialDisplacement) /
      dampedFrequency;
    const oscillation = initialDisplacement * cosine + sineCoefficient * sine;
    displacement = decay * oscillation;
    velocity =
      decay *
      (-dampingRatio * naturalFrequency * oscillation +
        -initialDisplacement * dampedFrequency * sine +
        sineCoefficient * dampedFrequency * cosine);
  } else if (dampingRatio <= 1 + 1e-7) {
    const linearCoefficient =
      spring.initialVelocity + naturalFrequency * initialDisplacement;
    const decay = Math.exp(-naturalFrequency * elapsedSeconds);
    const linear = initialDisplacement + linearCoefficient * elapsedSeconds;
    displacement = linear * decay;
    velocity = (linearCoefficient - naturalFrequency * linear) * decay;
  } else {
    const radical = Math.sqrt(dampingRatio * dampingRatio - 1);
    const slowRoot = -naturalFrequency / (dampingRatio + radical);
    const fastRoot = -naturalFrequency * (dampingRatio + radical);
    const slowCoefficient =
      (spring.initialVelocity - fastRoot * initialDisplacement) /
      (slowRoot - fastRoot);
    const fastCoefficient = initialDisplacement - slowCoefficient;
    const slowTerm = slowCoefficient * Math.exp(slowRoot * elapsedSeconds);
    const fastTerm = fastCoefficient * Math.exp(fastRoot * elapsedSeconds);
    displacement = slowTerm + fastTerm;
    velocity = slowRoot * slowTerm + fastRoot * fastTerm;
  }

  const position = 1 + displacement;
  if (!Number.isFinite(position) || !Number.isFinite(velocity)) {
    throw new RangeError("UI worklet spring evaluation was not finite.");
  }
  const settled =
    Math.abs(displacement) <= spring.restDisplacementThreshold &&
    Math.abs(velocity) <= spring.restSpeedThreshold;
  return Object.freeze(
    settled
      ? { position: 1, velocity: 0, settled: true }
      : { position, velocity, settled: false },
  );
}

/**
 * Analytical exponential-decay reference for a complete velocity vector.
 * `initialSpeedValue` is that vector's maximum absolute input velocity.
 */
export function evaluateUIWorkletDecay(
  decayValue: UIWorkletDecay,
  initialSpeedValue: number,
  elapsedMillisecondsValue: number,
): UIWorkletDecaySample {
  const decay = parseUIWorkletDecay(decayValue);
  const initialSpeed = finiteNumber(
    initialSpeedValue,
    "UI worklet decay initial speed",
  );
  const elapsedMilliseconds = finiteNumber(
    elapsedMillisecondsValue,
    "UI worklet decay elapsed time",
  );
  if (initialSpeed < 0 || initialSpeed > UI_WORKLET_MAX_DECAY_VELOCITY) {
    throw new RangeError(
      `UI worklet decay initial speed must be between zero and ${UI_WORKLET_MAX_DECAY_VELOCITY}.`,
    );
  }
  if (elapsedMilliseconds < 0) {
    throw new RangeError("UI worklet decay elapsed time must be non-negative.");
  }

  const thresholdTimeSeconds =
    initialSpeed <= decay.velocityThreshold
      ? 0
      : Math.log(initialSpeed / decay.velocityThreshold) / decay.deceleration;
  const terminalTimeSeconds = Math.min(
    thresholdTimeSeconds,
    decay.maximumDurationMilliseconds / 1_000,
  );
  const elapsedSeconds = elapsedMilliseconds / 1_000;
  const settled = elapsedSeconds >= terminalTimeSeconds;
  const evaluatedSeconds = settled ? terminalTimeSeconds : elapsedSeconds;
  const velocityFactor = Math.exp(-decay.deceleration * evaluatedSeconds);
  const displacementFactorSeconds =
    -Math.expm1(-decay.deceleration * evaluatedSeconds) / decay.deceleration;
  if (
    !Number.isFinite(velocityFactor) ||
    !Number.isFinite(displacementFactorSeconds)
  ) {
    throw new RangeError("UI worklet decay evaluation was not finite.");
  }
  return Object.freeze({
    displacementFactorSeconds,
    velocityFactor: settled ? 0 : velocityFactor,
    speed: settled ? 0 : initialSpeed * velocityFactor,
    settled,
  });
}

function initialInputs(
  graph: UIWorkletGraph,
): Readonly<Record<string, number>> {
  const values: Record<string, number> = {};
  for (const input of graph.inputs) values[input.name] = input.initialValue;
  return Object.freeze(values);
}

function completeInputs(
  graph: UIWorkletGraph,
  value: unknown,
): Readonly<Record<string, number>> {
  const record = objectRecord(value, "UI worklet inputs");
  const expected = new Set(graph.inputs.map((input) => input.name));
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      throw new RangeError(`Unknown UI worklet input ${key}.`);
    }
  }
  const values: Record<string, number> = {};
  for (const input of graph.inputs) {
    if (!(input.name in record)) {
      throw new TypeError(`UI worklet input ${input.name} is missing.`);
    }
    values[input.name] = finiteNumber(
      record[input.name],
      `UI worklet input ${input.name}`,
    );
  }
  return Object.freeze(values);
}

function evaluateExpression(
  expression: UIWorkletExpression,
  inputs: Readonly<Record<string, number>>,
): number {
  if (expression.kind === "constant") return expression.value;
  if (expression.kind === "input") return inputs[expression.name]!;
  if (expression.kind === "abs") {
    return Math.abs(evaluateExpression(expression.value, inputs));
  }
  if (expression.kind === "negate") {
    return -evaluateExpression(expression.value, inputs);
  }
  if (expression.kind === "clamp") {
    return Math.min(
      expression.max,
      Math.max(expression.min, evaluateExpression(expression.value, inputs)),
    );
  }
  if (expression.kind === "interpolate") {
    const input = evaluateExpression(expression.value, inputs);
    let progress =
      (input - expression.inputRange[0]) /
      (expression.inputRange[1] - expression.inputRange[0]);
    if (expression.extrapolate === "clamp") {
      progress = Math.min(1, Math.max(0, progress));
    }
    return (
      expression.outputRange[0] +
      progress * (expression.outputRange[1] - expression.outputRange[0])
    );
  }
  const left = evaluateExpression(expression.left, inputs);
  const right = evaluateExpression(expression.right, inputs);
  switch (expression.operator) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      if (right === 0) throw new RangeError("UI worklet division by zero.");
      return left / right;
    case "min":
      return Math.min(left, right);
    case "max":
      return Math.max(left, right);
  }
}

/** Reference semantics used by native backends and deterministic tests. */
export function evaluateUIWorkletGraph(
  graphValue: UIWorkletGraph,
  inputValue: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const graph = parseUIWorkletGraph(graphValue);
  const inputs = completeInputs(graph, inputValue);
  const outputs: Record<string, number> = {};
  for (const output of graph.outputs) {
    const value = evaluateExpression(output.expression, inputs);
    if (!Number.isFinite(value)) {
      throw new RangeError(`UI worklet output ${output.name} was not finite.`);
    }
    outputs[output.name] = value;
  }
  return Object.freeze(outputs);
}

function assertHost(value: UIWorkletHost): void {
  if (
    value === null ||
    typeof value !== "object" ||
    value.protocolVersion !== UI_WORKLET_PROTOCOL_VERSION ||
    typeof value.installGraph !== "function" ||
    typeof value.updateGraphInputs !== "function" ||
    typeof value.destroyGraph !== "function"
  ) {
    throw new TypeError(
      `UI worklet host must implement protocol version ${UI_WORKLET_PROTOCOL_VERSION}.`,
    );
  }
}

function timestamp(value: unknown): number {
  const result = finiteNumber(value, "UI worklet timestamp");
  if (result < 0) {
    throw new RangeError("UI worklet timestamps must be non-negative.");
  }
  return result;
}

function readReduceMotionPreference(
  source: (() => boolean | undefined) | undefined,
): boolean {
  if (source === undefined) return false;
  const value = source();
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(
      "UI worklet reduceMotion must return a boolean or undefined.",
    );
  }
  return value === true;
}

/**
 * Installs one validated graph and owns its input/cancellation boundary. This
 * does not imply that the injected host executes on the UI thread.
 */
export function createUIWorkletSession(
  host: UIWorkletHost,
  graphValue: UIWorkletGraph,
  options: UIWorkletSessionOptions = {},
): UIWorkletSession {
  assertHost(host);
  const graph = parseUIWorkletGraph(graphValue);
  const clock = options.clock ?? Date.now;
  if (typeof clock !== "function") {
    throw new TypeError("UI worklet session clock must be a function.");
  }
  if (
    options.reduceMotion !== undefined &&
    typeof options.reduceMotion !== "function"
  ) {
    throw new TypeError("UI worklet session reduceMotion must be a function.");
  }
  const handle = host.installGraph(graph);
  if (!Number.isSafeInteger(handle) || handle <= 0) {
    throw new TypeError(
      "UI worklet hosts must allocate positive safe-integer handles.",
    );
  }
  let currentInputs = initialInputs(graph);
  let lastTimestamp = -Infinity;
  let disposed = false;
  let nativeInputsOwned = false;
  const knownInputs = new Set(graph.inputs.map((input) => input.name));

  function prepareInputFrame(
    changesValue: Readonly<Record<string, number>>,
    timestampValue: number | undefined,
  ):
    | {
        readonly nextInputs: Readonly<Record<string, number>>;
        readonly inputVector: readonly number[];
        readonly nextTimestamp: number;
      }
    | undefined {
    if (disposed) throw new Error("The UI worklet session is disposed.");
    if (nativeInputsOwned) {
      throw new Error(
        "The UI worklet input vector is owned by its native pan gesture.",
      );
    }
    const changes = objectRecord(changesValue, "UI worklet input update");
    const nextInputs: Record<string, number> = { ...currentInputs };
    const changedKeys = Object.keys(changes);
    for (const key of changedKeys) {
      if (!knownInputs.has(key)) {
        throw new RangeError(`Unknown UI worklet input ${key}.`);
      }
      nextInputs[key] = finiteNumber(changes[key], `UI worklet input ${key}`);
    }
    if (changedKeys.length === 0) return undefined;
    const nextTimestamp = timestamp(
      timestampValue === undefined ? clock() : timestampValue,
    );
    if (nextTimestamp < lastTimestamp) {
      throw new RangeError("UI worklet input timestamps must be monotonic.");
    }
    return {
      nextInputs: Object.freeze(nextInputs),
      inputVector: Object.freeze(
        graph.inputs.map((input) => nextInputs[input.name]!),
      ),
      nextTimestamp,
    };
  }

  function prepareDecayVelocityFrame(
    velocitiesValue: Readonly<Record<string, number>>,
    timestampValue: number | undefined,
  ):
    | {
        readonly velocityVector: readonly number[];
        readonly nextTimestamp: number;
      }
    | undefined {
    if (disposed) throw new Error("The UI worklet session is disposed.");
    if (nativeInputsOwned) {
      throw new Error(
        "The UI worklet input vector is owned by its native pan gesture.",
      );
    }
    const velocities = objectRecord(
      velocitiesValue,
      "UI worklet decay velocities",
    );
    const velocityVector = new Array<number>(graph.inputs.length).fill(0);
    const changedKeys = Object.keys(velocities);
    for (const key of changedKeys) {
      if (!knownInputs.has(key)) {
        throw new RangeError(`Unknown UI worklet decay input ${key}.`);
      }
      const velocity = finiteNumber(
        velocities[key],
        `UI worklet decay velocity ${key}`,
      );
      if (Math.abs(velocity) > UI_WORKLET_MAX_DECAY_VELOCITY) {
        throw new RangeError(
          `UI worklet decay velocity magnitude must be at most ${UI_WORKLET_MAX_DECAY_VELOCITY}.`,
        );
      }
      velocityVector[graph.inputs.findIndex((input) => input.name === key)] =
        velocity;
    }
    if (changedKeys.length === 0) return undefined;
    const nextTimestamp = timestamp(
      timestampValue === undefined ? clock() : timestampValue,
    );
    if (nextTimestamp < lastTimestamp) {
      throw new RangeError("UI worklet input timestamps must be monotonic.");
    }
    return {
      velocityVector: Object.freeze(velocityVector),
      nextTimestamp,
    };
  }

  function prepareTimingKeyframes(
    keyframesValue: readonly UIWorkletNamedTimingKeyframe[],
    timestampValue: number | undefined,
  ): {
    readonly keyframes: readonly UIWorkletTimingKeyframe[];
    readonly finalInputs: Readonly<Record<string, number>>;
    readonly nextTimestamp: number;
  } {
    if (disposed) throw new Error("The UI worklet session is disposed.");
    if (nativeInputsOwned) {
      throw new Error(
        "The UI worklet input vector is owned by its native pan gesture.",
      );
    }
    if (
      !Array.isArray(keyframesValue) ||
      keyframesValue.length === 0 ||
      keyframesValue.length > UI_WORKLET_MAX_TIMING_KEYFRAMES
    ) {
      throw new RangeError(
        `UI worklet timing keyframes must contain between 1 and ${UI_WORKLET_MAX_TIMING_KEYFRAMES} steps.`,
      );
    }
    let nextInputs: Readonly<Record<string, number>> = currentInputs;
    let totalDurationMilliseconds = 0;
    const keyframes = keyframesValue.map((value, index) => {
      const context = `UI worklet timing keyframe ${String(index)}`;
      const record = objectRecord(value, context);
      exactKeys(record, ["inputs", "timing"], context);
      const changes = objectRecord(record.inputs, `${context}.inputs`);
      const target: Record<string, number> = { ...nextInputs };
      for (const key of Object.keys(changes)) {
        if (!knownInputs.has(key)) {
          throw new RangeError(`Unknown UI worklet input ${key}.`);
        }
        target[key] = finiteNumber(changes[key], `${context} input ${key}`);
      }
      const timing = parseUIWorkletTiming(record.timing);
      totalDurationMilliseconds += timing.durationMilliseconds;
      if (totalDurationMilliseconds > UI_WORKLET_MAX_TIMING_DURATION_MS) {
        throw new RangeError(
          `UI worklet timing keyframes may last at most ${UI_WORKLET_MAX_TIMING_DURATION_MS} milliseconds in total.`,
        );
      }
      nextInputs = Object.freeze(target);
      return Object.freeze({
        inputs: Object.freeze(
          graph.inputs.map((input) => nextInputs[input.name]!),
        ),
        timing,
      });
    });
    const nextTimestamp = timestamp(
      timestampValue === undefined ? clock() : timestampValue,
    );
    if (nextTimestamp < lastTimestamp) {
      throw new RangeError("UI worklet input timestamps must be monotonic.");
    }
    return {
      keyframes: Object.freeze(keyframes),
      finalInputs: nextInputs,
      nextTimestamp,
    };
  }

  function readSynchronizedInputVector(
    value: unknown,
  ): Readonly<Record<string, number>> {
    if (!Array.isArray(value) || value.length !== graph.inputs.length) {
      throw new TypeError(
        "UI worklet synchronization must return the complete frozen input vector.",
      );
    }
    const inputs: Record<string, number> = {};
    for (let index = 0; index < graph.inputs.length; index++) {
      const input = graph.inputs[index]!;
      inputs[input.name] = finiteNumber(
        value[index],
        `Synchronized UI worklet input ${input.name}`,
      );
    }
    return Object.freeze(inputs);
  }

  const session: UIWorkletSession = {
    graph,
    handle,
    get disposed() {
      return disposed;
    },
    get nativeInputsOwned() {
      return nativeInputsOwned;
    },
    get inputs() {
      return currentInputs;
    },
    update(changesValue, timestampValue) {
      const frame = prepareInputFrame(changesValue, timestampValue);
      if (frame === undefined) return;
      host.updateGraphInputs(handle, frame.inputVector, frame.nextTimestamp);
      currentInputs = frame.nextInputs;
      lastTimestamp = frame.nextTimestamp;
    },
    animate(changesValue, timingValue, timestampValue) {
      const timing = parseUIWorkletTiming(timingValue);
      const frame = prepareInputFrame(changesValue, timestampValue);
      if (frame === undefined) return;
      if (readReduceMotionPreference(options.reduceMotion)) {
        host.updateGraphInputs(handle, frame.inputVector, frame.nextTimestamp);
      } else {
        const animateGraphInputs = host.animateGraphInputs;
        if (typeof animateGraphInputs !== "function") {
          throw new Error(
            "The UI worklet host does not support native timings.",
          );
        }
        animateGraphInputs.call(
          host,
          handle,
          frame.inputVector,
          frame.nextTimestamp,
          timing,
        );
      }
      currentInputs = frame.nextInputs;
      lastTimestamp = frame.nextTimestamp;
    },
    animateKeyframes(keyframesValue, timestampValue) {
      const prepared = prepareTimingKeyframes(keyframesValue, timestampValue);
      if (readReduceMotionPreference(options.reduceMotion)) {
        host.updateGraphInputs(
          handle,
          prepared.keyframes[prepared.keyframes.length - 1]!.inputs,
          prepared.nextTimestamp,
        );
      } else {
        const animateGraphKeyframes = host.animateGraphKeyframes;
        if (typeof animateGraphKeyframes !== "function") {
          throw new Error(
            "The UI worklet host does not support native timing keyframes.",
          );
        }
        animateGraphKeyframes.call(
          host,
          handle,
          prepared.keyframes,
          prepared.nextTimestamp,
        );
      }
      currentInputs = prepared.finalInputs;
      lastTimestamp = prepared.nextTimestamp;
    },
    spring(changesValue, springValue, timestampValue) {
      const spring = parseUIWorkletSpring(springValue);
      const frame = prepareInputFrame(changesValue, timestampValue);
      if (frame === undefined) return;
      if (readReduceMotionPreference(options.reduceMotion)) {
        host.updateGraphInputs(handle, frame.inputVector, frame.nextTimestamp);
      } else {
        const springGraphInputs = host.springGraphInputs;
        if (typeof springGraphInputs !== "function") {
          throw new Error(
            "The UI worklet host does not support native springs.",
          );
        }
        springGraphInputs.call(
          host,
          handle,
          frame.inputVector,
          frame.nextTimestamp,
          spring,
        );
      }
      currentInputs = frame.nextInputs;
      lastTimestamp = frame.nextTimestamp;
    },
    decay(velocitiesValue, decayValue, timestampValue) {
      const decay = parseUIWorkletDecay(decayValue);
      const frame = prepareDecayVelocityFrame(velocitiesValue, timestampValue);
      if (frame === undefined) return;
      if (readReduceMotionPreference(options.reduceMotion)) {
        host.updateGraphInputs(
          handle,
          Object.freeze(
            graph.inputs.map((input) => currentInputs[input.name]!),
          ),
          frame.nextTimestamp,
        );
      } else {
        const decayGraphInputs = host.decayGraphInputs;
        if (typeof decayGraphInputs !== "function") {
          throw new Error(
            "The UI worklet host does not support native decays.",
          );
        }
        decayGraphInputs.call(
          host,
          handle,
          frame.velocityVector,
          frame.nextTimestamp,
          decay,
        );
      }
      lastTimestamp = frame.nextTimestamp;
    },
    cancel(timestampValue) {
      if (disposed) throw new Error("The UI worklet session is disposed.");
      const cancelGraphAnimation = host.cancelGraphAnimation;
      if (typeof cancelGraphAnimation !== "function") {
        throw new Error(
          "The UI worklet host does not support native animation cancellation.",
        );
      }
      const nextTimestamp = timestamp(
        timestampValue === undefined ? clock() : timestampValue,
      );
      if (nextTimestamp < lastTimestamp) {
        throw new RangeError("UI worklet input timestamps must be monotonic.");
      }
      const frozenInputs = readSynchronizedInputVector(
        cancelGraphAnimation.call(host, handle, nextTimestamp),
      );
      currentInputs = frozenInputs;
      lastTimestamp = nextTimestamp;
    },
    attachPanGesture(gestureValue) {
      if (disposed) throw new Error("The UI worklet session is disposed.");
      if (nativeInputsOwned) {
        throw new Error("The UI worklet session already owns a native pan.");
      }
      const attachPanGesture = host.attachPanGesture;
      if (typeof attachPanGesture !== "function") {
        throw new Error(
          "The UI worklet host does not support native pan gestures.",
        );
      }
      const gesture = parseUIWorkletPanGesture(gestureValue, graph);
      const effectiveGesture =
        gesture.releaseDecay !== undefined &&
        readReduceMotionPreference(options.reduceMotion)
          ? Object.freeze({
              xInput: gesture.xInput,
              yInput: gesture.yInput,
              minX: gesture.minX,
              maxX: gesture.maxX,
              minY: gesture.minY,
              maxY: gesture.maxY,
            })
          : gesture;
      attachPanGesture.call(host, handle, effectiveGesture);
      nativeInputsOwned = true;
    },
    detachPanGesture(timestampValue) {
      if (disposed) throw new Error("The UI worklet session is disposed.");
      if (!nativeInputsOwned) {
        throw new Error("The UI worklet session does not own a native pan.");
      }
      const detachPanGesture = host.detachPanGesture;
      if (typeof detachPanGesture !== "function") {
        throw new Error(
          "The UI worklet host does not support native pan detachment.",
        );
      }
      const nextTimestamp = timestamp(
        timestampValue === undefined ? clock() : timestampValue,
      );
      if (nextTimestamp < lastTimestamp) {
        throw new RangeError("UI worklet input timestamps must be monotonic.");
      }
      const frozenInputs = readSynchronizedInputVector(
        detachPanGesture.call(host, handle, nextTimestamp),
      );
      currentInputs = frozenInputs;
      lastTimestamp = nextTimestamp;
      nativeInputsOwned = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      host.destroyGraph(handle);
    },
  };
  return Object.freeze(session);
}

interface MutableUIWorkletFrameStatistics {
  frameCount: number;
  firstFrameTimeMilliseconds: number;
  lastFrameTimeMilliseconds: number;
  minimumFrameIntervalMilliseconds: number;
  maximumFrameIntervalMilliseconds: number;
  totalFrameIntervalMilliseconds: number;
  readonly intervalSamples: number[];
  droppedIntervalSampleCount: number;
}

interface InMemoryGraphState {
  readonly graph: UIWorkletGraph;
  inputs: Readonly<Record<string, number>>;
  outputs: Readonly<Record<string, number>>;
  sequence: number;
  timestamp?: number;
  timing:
    | {
        readonly from: Readonly<Record<string, number>>;
        readonly keyframes: readonly {
          readonly to: Readonly<Record<string, number>>;
          readonly definition: UIWorkletTiming;
        }[];
        readonly totalDurationMilliseconds: number;
        startedAt?: number;
      }
    | undefined;
  timingProgress: number;
  timingFrameStatistics: MutableUIWorkletFrameStatistics | undefined;
  spring:
    | {
        readonly from: Readonly<Record<string, number>>;
        readonly to: Readonly<Record<string, number>>;
        readonly definition: UIWorkletSpring;
        startedAt?: number;
      }
    | undefined;
  springPosition: number | undefined;
  springVelocity: number | undefined;
  springFrameStatistics: MutableUIWorkletFrameStatistics | undefined;
  decay:
    | {
        readonly from: Readonly<Record<string, number>>;
        readonly velocities: Readonly<Record<string, number>>;
        readonly initialSpeed: number;
        readonly definition: UIWorkletDecay;
        startedAt?: number;
      }
    | undefined;
  decayElapsedMilliseconds: number | undefined;
  decaySpeed: number | undefined;
  decayFrameStatistics: MutableUIWorkletFrameStatistics | undefined;
  pan:
    | {
        readonly definition: UIWorkletPanGesture;
        active: boolean;
        originX: number;
        originY: number;
        sequence: number;
        timestamp?: number;
      }
    | undefined;
}

function createMutableFrameStatistics(): MutableUIWorkletFrameStatistics {
  return {
    frameCount: 0,
    firstFrameTimeMilliseconds: 0,
    lastFrameTimeMilliseconds: 0,
    minimumFrameIntervalMilliseconds: 0,
    maximumFrameIntervalMilliseconds: 0,
    totalFrameIntervalMilliseconds: 0,
    intervalSamples: [],
    droppedIntervalSampleCount: 0,
  };
}

function recordAnimationFrame(
  statistics: MutableUIWorkletFrameStatistics,
  frameTimeMilliseconds: number,
): void {
  if (statistics.frameCount === 0) {
    statistics.frameCount = 1;
    statistics.firstFrameTimeMilliseconds = frameTimeMilliseconds;
    statistics.lastFrameTimeMilliseconds = frameTimeMilliseconds;
    return;
  }
  const interval = frameTimeMilliseconds - statistics.lastFrameTimeMilliseconds;
  if (interval <= 0) {
    throw new RangeError(
      "UI worklet animation frame timestamps must be strictly increasing.",
    );
  }
  statistics.frameCount++;
  statistics.lastFrameTimeMilliseconds = frameTimeMilliseconds;
  statistics.totalFrameIntervalMilliseconds += interval;
  if (
    statistics.minimumFrameIntervalMilliseconds === 0 ||
    interval < statistics.minimumFrameIntervalMilliseconds
  ) {
    statistics.minimumFrameIntervalMilliseconds = interval;
  }
  if (interval > statistics.maximumFrameIntervalMilliseconds) {
    statistics.maximumFrameIntervalMilliseconds = interval;
  }
  if (
    statistics.intervalSamples.length < UI_WORKLET_MAX_FRAME_INTERVAL_SAMPLES
  ) {
    statistics.intervalSamples.push(interval);
  } else {
    statistics.droppedIntervalSampleCount++;
  }
}

function snapshotFrameStatistics(
  statistics: MutableUIWorkletFrameStatistics | undefined,
): UIWorkletFrameStatistics | undefined {
  if (statistics === undefined || statistics.frameCount === 0) return undefined;
  const intervalCount = statistics.frameCount - 1;
  const samples = [...statistics.intervalSamples].sort(
    (left, right) => left - right,
  );
  const quantile = (value: number): number =>
    samples.length === 0
      ? 0
      : samples[Math.max(0, Math.ceil(samples.length * value) - 1)]!;
  return Object.freeze({
    frameCount: statistics.frameCount,
    intervalCount,
    sampledIntervalCount: samples.length,
    droppedIntervalSampleCount: statistics.droppedIntervalSampleCount,
    firstFrameTimeMilliseconds: statistics.firstFrameTimeMilliseconds,
    lastFrameTimeMilliseconds: statistics.lastFrameTimeMilliseconds,
    minimumFrameIntervalMilliseconds:
      statistics.minimumFrameIntervalMilliseconds,
    maximumFrameIntervalMilliseconds:
      statistics.maximumFrameIntervalMilliseconds,
    meanFrameIntervalMilliseconds:
      intervalCount === 0
        ? 0
        : statistics.totalFrameIntervalMilliseconds / intervalCount,
    p50FrameIntervalMilliseconds: quantile(0.5),
    p95FrameIntervalMilliseconds: quantile(0.95),
    p99FrameIntervalMilliseconds: quantile(0.99),
  });
}

/** Deterministic reference host; it is intentionally not a UI-thread backend. */
export function createInMemoryUIWorkletHost(): InMemoryUIWorkletHost {
  const states = new Map<UIWorkletHandle, InMemoryGraphState>();
  let nextHandle = 1;
  let lastFrameTime = -Infinity;

  function requireState(handle: UIWorkletHandle): InMemoryGraphState {
    const state = states.get(handle);
    if (state === undefined) {
      throw new Error(`Unknown UI worklet graph handle ${String(handle)}.`);
    }
    return state;
  }

  function readInputVector(
    state: InMemoryGraphState,
    inputVector: readonly number[],
  ): Readonly<Record<string, number>> {
    if (
      !Array.isArray(inputVector) ||
      inputVector.length !== state.graph.inputs.length
    ) {
      throw new TypeError(
        "UI worklet host input vectors must match the installed graph.",
      );
    }
    const inputs: Record<string, number> = {};
    for (let index = 0; index < state.graph.inputs.length; index++) {
      const input = state.graph.inputs[index]!;
      inputs[input.name] = finiteNumber(
        inputVector[index],
        `UI worklet host input ${input.name}`,
      );
    }
    return Object.freeze(inputs);
  }

  function requireMonotonicInputTimestamp(
    state: InMemoryGraphState,
    timestampValue: number,
  ): number {
    const nextTimestamp = timestamp(timestampValue);
    if (state.timestamp !== undefined && nextTimestamp < state.timestamp) {
      throw new RangeError("UI worklet host timestamps must be monotonic.");
    }
    return nextTimestamp;
  }

  function readTimingKeyframes(
    state: InMemoryGraphState,
    values: readonly UIWorkletTimingKeyframe[],
  ): {
    readonly keyframes: readonly {
      readonly to: Readonly<Record<string, number>>;
      readonly definition: UIWorkletTiming;
    }[];
    readonly totalDurationMilliseconds: number;
  } {
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.length > UI_WORKLET_MAX_TIMING_KEYFRAMES
    ) {
      throw new RangeError(
        `UI worklet host timing keyframes must contain between 1 and ${UI_WORKLET_MAX_TIMING_KEYFRAMES} steps.`,
      );
    }
    let totalDurationMilliseconds = 0;
    const keyframes = values.map((value, index) => {
      const context = `UI worklet host timing keyframe ${String(index)}`;
      const record = objectRecord(value, context);
      exactKeys(record, ["inputs", "timing"], context);
      const to = readInputVector(state, record.inputs as readonly number[]);
      const definition = parseUIWorkletTiming(record.timing);
      totalDurationMilliseconds += definition.durationMilliseconds;
      if (totalDurationMilliseconds > UI_WORKLET_MAX_TIMING_DURATION_MS) {
        throw new RangeError(
          `UI worklet timing keyframes may last at most ${UI_WORKLET_MAX_TIMING_DURATION_MS} milliseconds in total.`,
        );
      }
      evaluateUIWorkletGraph(state.graph, to);
      return Object.freeze({ to, definition });
    });
    return {
      keyframes: Object.freeze(keyframes),
      totalDurationMilliseconds,
    };
  }

  function evaluateTimingKeyframes(
    timing: NonNullable<InMemoryGraphState["timing"]>,
    elapsedMilliseconds: number,
  ): {
    readonly inputs: Readonly<Record<string, number>>;
    readonly progress: number;
  } {
    let remaining = Math.max(
      0,
      Math.min(elapsedMilliseconds, timing.totalDurationMilliseconds),
    );
    let completedDurationMilliseconds = 0;
    let from = timing.from;
    for (const [index, keyframe] of timing.keyframes.entries()) {
      const last = index === timing.keyframes.length - 1;
      if (!last && remaining >= keyframe.definition.durationMilliseconds) {
        remaining -= keyframe.definition.durationMilliseconds;
        completedDurationMilliseconds +=
          keyframe.definition.durationMilliseconds;
        from = keyframe.to;
        continue;
      }
      const localProgress = evaluateUIWorkletTimingProgress(
        keyframe.definition,
        remaining,
      );
      const inputs: Record<string, number> = {};
      for (const input of Object.keys(timing.from)) {
        inputs[input] =
          localProgress === 0
            ? from[input]!
            : localProgress === 1
              ? keyframe.to[input]!
              : from[input]! * (1 - localProgress) +
                keyframe.to[input]! * localProgress;
      }
      return {
        inputs: Object.freeze(inputs),
        progress:
          elapsedMilliseconds >= timing.totalDurationMilliseconds
            ? 1
            : (completedDurationMilliseconds +
                localProgress * keyframe.definition.durationMilliseconds) /
              timing.totalDurationMilliseconds,
      };
    }
    throw new Error("UI worklet timing keyframes are empty.");
  }

  const host: InMemoryUIWorkletHost = {
    protocolVersion: UI_WORKLET_PROTOCOL_VERSION,
    get activeGraphCount() {
      return states.size;
    },
    installGraph(graphValue) {
      const graph = parseUIWorkletGraph(graphValue);
      if (!Number.isSafeInteger(nextHandle)) {
        throw new RangeError("The UI worklet handle space is exhausted.");
      }
      const handle = nextHandle++;
      const inputs = initialInputs(graph);
      states.set(handle, {
        graph,
        inputs,
        outputs: evaluateUIWorkletGraph(graph, inputs),
        sequence: 0,
        timing: undefined,
        timingProgress: 0,
        timingFrameStatistics: undefined,
        spring: undefined,
        springPosition: undefined,
        springVelocity: undefined,
        springFrameStatistics: undefined,
        decay: undefined,
        decayElapsedMilliseconds: undefined,
        decaySpeed: undefined,
        decayFrameStatistics: undefined,
        pan: undefined,
      });
      return handle;
    },
    updateGraphInputs(handle, inputVector, timestampValue) {
      const state = requireState(handle);
      const nextTimestamp = requireMonotonicInputTimestamp(
        state,
        timestampValue,
      );
      const inputs = readInputVector(state, inputVector);
      const outputs = evaluateUIWorkletGraph(state.graph, inputs);
      state.inputs = inputs;
      state.outputs = outputs;
      state.sequence++;
      state.timestamp = nextTimestamp;
      state.timing = undefined;
      state.timingProgress = 0;
      state.timingFrameStatistics = undefined;
      state.spring = undefined;
      state.springPosition = undefined;
      state.springVelocity = undefined;
      state.springFrameStatistics = undefined;
      state.decay = undefined;
      state.decayElapsedMilliseconds = undefined;
      state.decaySpeed = undefined;
      state.decayFrameStatistics = undefined;
    },
    animateGraphInputs(handle, inputVector, timestampValue, timingValue) {
      const state = requireState(handle);
      const nextTimestamp = requireMonotonicInputTimestamp(
        state,
        timestampValue,
      );
      const inputs = readInputVector(state, inputVector);
      // Validate the complete target before changing the active timing.
      evaluateUIWorkletGraph(state.graph, inputs);
      const definition = parseUIWorkletTiming(timingValue);
      state.timing = {
        from: state.inputs,
        keyframes: Object.freeze([Object.freeze({ to: inputs, definition })]),
        totalDurationMilliseconds: definition.durationMilliseconds,
      };
      state.timestamp = nextTimestamp;
      state.timingProgress = 0;
      state.timingFrameStatistics = createMutableFrameStatistics();
      state.spring = undefined;
      state.springPosition = undefined;
      state.springVelocity = undefined;
      state.springFrameStatistics = undefined;
      state.decay = undefined;
      state.decayElapsedMilliseconds = undefined;
      state.decaySpeed = undefined;
      state.decayFrameStatistics = undefined;
    },
    animateGraphKeyframes(handle, keyframesValue, timestampValue) {
      const state = requireState(handle);
      const nextTimestamp = requireMonotonicInputTimestamp(
        state,
        timestampValue,
      );
      // Parse and validate every terminal graph before replacing any driver.
      const keyframes = readTimingKeyframes(state, keyframesValue);
      state.timing = {
        from: state.inputs,
        ...keyframes,
      };
      state.timestamp = nextTimestamp;
      state.timingProgress = 0;
      state.timingFrameStatistics = createMutableFrameStatistics();
      state.spring = undefined;
      state.springPosition = undefined;
      state.springVelocity = undefined;
      state.springFrameStatistics = undefined;
      state.decay = undefined;
      state.decayElapsedMilliseconds = undefined;
      state.decaySpeed = undefined;
      state.decayFrameStatistics = undefined;
    },
    springGraphInputs(handle, inputVector, timestampValue, springValue) {
      const state = requireState(handle);
      const nextTimestamp = requireMonotonicInputTimestamp(
        state,
        timestampValue,
      );
      const inputs = readInputVector(state, inputVector);
      // Validate the complete target before changing the active driver.
      evaluateUIWorkletGraph(state.graph, inputs);
      const definition = parseUIWorkletSpring(springValue);
      state.timing = undefined;
      state.timingProgress = 0;
      state.timingFrameStatistics = undefined;
      state.spring = {
        from: state.inputs,
        to: inputs,
        definition,
      };
      state.timestamp = nextTimestamp;
      state.springPosition = 0;
      state.springVelocity = definition.initialVelocity;
      state.springFrameStatistics = createMutableFrameStatistics();
      state.decay = undefined;
      state.decayElapsedMilliseconds = undefined;
      state.decaySpeed = undefined;
      state.decayFrameStatistics = undefined;
    },
    decayGraphInputs(handle, velocityVector, timestampValue, decayValue) {
      const state = requireState(handle);
      const nextTimestamp = requireMonotonicInputTimestamp(
        state,
        timestampValue,
      );
      const velocities = readInputVector(state, velocityVector);
      let initialSpeed = 0;
      for (const velocity of Object.values(velocities)) {
        if (Math.abs(velocity) > UI_WORKLET_MAX_DECAY_VELOCITY) {
          throw new RangeError(
            `UI worklet decay velocity magnitude must be at most ${UI_WORKLET_MAX_DECAY_VELOCITY}.`,
          );
        }
        initialSpeed = Math.max(initialSpeed, Math.abs(velocity));
      }
      const definition = parseUIWorkletDecay(decayValue);
      const terminal = evaluateUIWorkletDecay(
        definition,
        initialSpeed,
        definition.maximumDurationMilliseconds,
      );
      const terminalInputs: Record<string, number> = {};
      for (const input of state.graph.inputs) {
        terminalInputs[input.name] =
          state.inputs[input.name]! +
          velocities[input.name]! * terminal.displacementFactorSeconds;
      }
      // Validate the bounded terminal vector before changing the active driver.
      evaluateUIWorkletGraph(state.graph, terminalInputs);
      state.timing = undefined;
      state.timingProgress = 0;
      state.timingFrameStatistics = undefined;
      state.spring = undefined;
      state.springPosition = undefined;
      state.springVelocity = undefined;
      state.springFrameStatistics = undefined;
      state.decay = {
        from: state.inputs,
        velocities,
        initialSpeed,
        definition,
      };
      state.timestamp = nextTimestamp;
      state.decayElapsedMilliseconds = 0;
      state.decaySpeed = initialSpeed;
      state.decayFrameStatistics = createMutableFrameStatistics();
    },
    cancelGraphAnimation(handle, timestampValue) {
      const state = requireState(handle);
      const nextTimestamp = requireMonotonicInputTimestamp(
        state,
        timestampValue,
      );
      state.timestamp = nextTimestamp;
      state.timing = undefined;
      state.spring = undefined;
      if (state.springVelocity !== undefined) state.springVelocity = 0;
      state.decay = undefined;
      if (state.decaySpeed !== undefined) state.decaySpeed = 0;
      return Object.freeze(
        state.graph.inputs.map((input) => state.inputs[input.name]!),
      );
    },
    attachPanGesture(handle, gestureValue) {
      const state = requireState(handle);
      if (state.pan !== undefined) {
        throw new Error("The UI worklet graph already owns a native pan.");
      }
      const definition = parseUIWorkletPanGesture(gestureValue, state.graph);
      state.pan = {
        definition,
        active: false,
        originX: 0,
        originY: 0,
        sequence: 0,
      };
    },
    detachPanGesture(handle, timestampValue) {
      const state = requireState(handle);
      const nextTimestamp = requireMonotonicInputTimestamp(
        state,
        timestampValue,
      );
      if (state.pan === undefined) {
        throw new Error("The UI worklet graph does not own a native pan.");
      }
      state.pan.active = false;
      state.pan = undefined;
      state.timing = undefined;
      state.spring = undefined;
      if (state.springVelocity !== undefined) state.springVelocity = 0;
      state.decay = undefined;
      if (state.decaySpeed !== undefined) state.decaySpeed = 0;
      state.timestamp = nextTimestamp;
      return Object.freeze(
        state.graph.inputs.map((input) => state.inputs[input.name]!),
      );
    },
    advanceFrame(frameTimeMillisecondsValue) {
      const frameTimeMilliseconds = timestamp(frameTimeMillisecondsValue);
      if (frameTimeMilliseconds < lastFrameTime) {
        throw new RangeError("UI worklet frame timestamps must be monotonic.");
      }
      lastFrameTime = frameTimeMilliseconds;
      for (const state of states.values()) {
        const timing = state.timing;
        if (timing !== undefined) {
          try {
            timing.startedAt ??= frameTimeMilliseconds;
            const sample = evaluateTimingKeyframes(
              timing,
              frameTimeMilliseconds - timing.startedAt,
            );
            const outputs = evaluateUIWorkletGraph(state.graph, sample.inputs);
            const timingFrameStatistics =
              state.timingFrameStatistics ?? createMutableFrameStatistics();
            recordAnimationFrame(timingFrameStatistics, frameTimeMilliseconds);
            state.inputs = sample.inputs;
            state.outputs = outputs;
            state.sequence++;
            state.timingProgress = sample.progress;
            state.timingFrameStatistics = timingFrameStatistics;
            if (sample.progress === 1) state.timing = undefined;
          } catch (error) {
            state.timing = undefined;
            throw error;
          }
          continue;
        }

        const spring = state.spring;
        if (spring !== undefined) {
          try {
            spring.startedAt ??= frameTimeMilliseconds;
            const sample = evaluateUIWorkletSpring(
              spring.definition,
              frameTimeMilliseconds - spring.startedAt,
            );
            const inputs: Record<string, number> = {};
            for (const input of state.graph.inputs) {
              const from = spring.from[input.name]!;
              const to = spring.to[input.name]!;
              inputs[input.name] = sample.settled
                ? to
                : from * (1 - sample.position) + to * sample.position;
            }
            const frozenInputs = Object.freeze(inputs);
            const outputs = evaluateUIWorkletGraph(state.graph, frozenInputs);
            const springFrameStatistics =
              state.springFrameStatistics ?? createMutableFrameStatistics();
            recordAnimationFrame(springFrameStatistics, frameTimeMilliseconds);
            state.inputs = frozenInputs;
            state.outputs = outputs;
            state.sequence++;
            state.springPosition = sample.position;
            state.springVelocity = sample.velocity;
            state.springFrameStatistics = springFrameStatistics;
            if (sample.settled) state.spring = undefined;
          } catch (error) {
            state.spring = undefined;
            throw error;
          }
          continue;
        }

        const decay = state.decay;
        if (decay === undefined) continue;
        try {
          decay.startedAt ??= frameTimeMilliseconds;
          const elapsedMilliseconds = frameTimeMilliseconds - decay.startedAt;
          const sample = evaluateUIWorkletDecay(
            decay.definition,
            decay.initialSpeed,
            elapsedMilliseconds,
          );
          const inputs: Record<string, number> = {};
          for (const input of state.graph.inputs) {
            inputs[input.name] =
              decay.from[input.name]! +
              decay.velocities[input.name]! * sample.displacementFactorSeconds;
          }
          const frozenInputs = Object.freeze(inputs);
          const outputs = evaluateUIWorkletGraph(state.graph, frozenInputs);
          const decayFrameStatistics =
            state.decayFrameStatistics ?? createMutableFrameStatistics();
          recordAnimationFrame(decayFrameStatistics, frameTimeMilliseconds);
          state.inputs = frozenInputs;
          state.outputs = outputs;
          state.sequence++;
          state.decayElapsedMilliseconds = elapsedMilliseconds;
          state.decaySpeed = sample.speed;
          state.decayFrameStatistics = decayFrameStatistics;
          if (sample.settled) state.decay = undefined;
        } catch (error) {
          state.decay = undefined;
          throw error;
        }
      }
    },
    dispatchPanGesture(
      handle,
      phase,
      translationXValue,
      translationYValue,
      timestampValue,
      velocityXValue = 0,
      velocityYValue = 0,
    ) {
      const state = requireState(handle);
      const pan = state.pan;
      if (pan === undefined) {
        throw new Error("The UI worklet graph does not own a native pan.");
      }
      if (
        phase !== "begin" &&
        phase !== "change" &&
        phase !== "end" &&
        phase !== "cancel"
      ) {
        throw new TypeError("The UI worklet pan phase is unsupported.");
      }
      const translationX = finiteNumber(
        translationXValue,
        "UI worklet pan translationX",
      );
      const translationY = finiteNumber(
        translationYValue,
        "UI worklet pan translationY",
      );
      const velocityX = finiteNumber(
        velocityXValue,
        "UI worklet pan velocityX",
      );
      const velocityY = finiteNumber(
        velocityYValue,
        "UI worklet pan velocityY",
      );
      if (
        Math.abs(velocityX) > UI_WORKLET_MAX_DECAY_VELOCITY ||
        Math.abs(velocityY) > UI_WORKLET_MAX_DECAY_VELOCITY
      ) {
        throw new RangeError(
          `UI worklet pan velocity magnitude must be at most ${UI_WORKLET_MAX_DECAY_VELOCITY}.`,
        );
      }
      const nextTimestamp = timestamp(timestampValue);
      if (pan.timestamp !== undefined && nextTimestamp < pan.timestamp) {
        throw new RangeError("UI worklet pan timestamps must be monotonic.");
      }
      if (phase === "begin") {
        if (pan.active) {
          throw new Error("The UI worklet pan is already active.");
        }
        pan.active = true;
        pan.originX = state.inputs[pan.definition.xInput]!;
        pan.originY = state.inputs[pan.definition.yInput]!;
        pan.timestamp = nextTimestamp;
        state.timing = undefined;
        state.timingProgress = 0;
        state.spring = undefined;
        if (state.springPosition !== undefined) state.springPosition = 0;
        if (state.springVelocity !== undefined) state.springVelocity = 0;
        state.decay = undefined;
        if (state.decayElapsedMilliseconds !== undefined) {
          state.decayElapsedMilliseconds = 0;
        }
        if (state.decaySpeed !== undefined) state.decaySpeed = 0;
        return;
      }
      if (!pan.active) {
        throw new Error("The UI worklet pan is not active.");
      }
      if (phase === "cancel") {
        pan.active = false;
        pan.timestamp = nextTimestamp;
        return;
      }
      try {
        const inputs: Record<string, number> = { ...state.inputs };
        inputs[pan.definition.xInput] = Math.min(
          pan.definition.maxX,
          Math.max(pan.definition.minX, pan.originX + translationX),
        );
        inputs[pan.definition.yInput] = Math.min(
          pan.definition.maxY,
          Math.max(pan.definition.minY, pan.originY + translationY),
        );
        const frozenInputs = Object.freeze(inputs);
        const outputs = evaluateUIWorkletGraph(state.graph, frozenInputs);
        let releaseDecay:
          | {
              readonly velocities: Readonly<Record<string, number>>;
              readonly initialSpeed: number;
              readonly definition: UIWorkletDecay;
            }
          | undefined;
        if (phase === "end" && pan.definition.releaseDecay !== undefined) {
          const velocities: Record<string, number> = {};
          for (const input of state.graph.inputs) velocities[input.name] = 0;
          velocities[pan.definition.xInput] = velocityX;
          velocities[pan.definition.yInput] = velocityY;
          const frozenVelocities = Object.freeze(velocities);
          const initialSpeed = Math.max(
            Math.abs(velocityX),
            Math.abs(velocityY),
          );
          const definition = pan.definition.releaseDecay;
          const terminal = evaluateUIWorkletDecay(
            definition,
            initialSpeed,
            definition.maximumDurationMilliseconds,
          );
          const terminalInputs: Record<string, number> = {};
          for (const input of state.graph.inputs) {
            terminalInputs[input.name] =
              frozenInputs[input.name]! +
              frozenVelocities[input.name]! *
                terminal.displacementFactorSeconds;
          }
          // Reject an invalid terminal graph before publishing the final pan.
          evaluateUIWorkletGraph(state.graph, terminalInputs);
          releaseDecay = {
            velocities: frozenVelocities,
            initialSpeed,
            definition,
          };
        }
        state.inputs = frozenInputs;
        state.outputs = outputs;
        state.sequence++;
        state.timing = undefined;
        state.timingProgress = 0;
        state.spring = undefined;
        if (state.springPosition !== undefined) state.springPosition = 0;
        if (state.springVelocity !== undefined) state.springVelocity = 0;
        state.decay =
          releaseDecay === undefined
            ? undefined
            : {
                from: frozenInputs,
                velocities: releaseDecay.velocities,
                initialSpeed: releaseDecay.initialSpeed,
                definition: releaseDecay.definition,
              };
        if (releaseDecay === undefined) {
          if (state.decayElapsedMilliseconds !== undefined) {
            state.decayElapsedMilliseconds = 0;
          }
          if (state.decaySpeed !== undefined) state.decaySpeed = 0;
        } else {
          state.decayElapsedMilliseconds = 0;
          state.decaySpeed = releaseDecay.initialSpeed;
          state.decayFrameStatistics = createMutableFrameStatistics();
        }
        pan.sequence++;
        pan.timestamp = nextTimestamp;
        if (phase === "end") pan.active = false;
      } catch (error) {
        pan.active = false;
        throw error;
      }
    },
    destroyGraph(handle) {
      if (!states.delete(handle)) {
        throw new Error(`Unknown UI worklet graph handle ${String(handle)}.`);
      }
    },
    snapshot(handle) {
      const state = states.get(handle);
      if (state === undefined) {
        throw new Error(`Unknown UI worklet graph handle ${String(handle)}.`);
      }
      const timingFrameStatistics = snapshotFrameStatistics(
        state.timingFrameStatistics,
      );
      const springFrameStatistics = snapshotFrameStatistics(
        state.springFrameStatistics,
      );
      const decayFrameStatistics = snapshotFrameStatistics(
        state.decayFrameStatistics,
      );
      const base = {
        handle,
        sequence: state.sequence,
        inputs: Object.freeze({ ...state.inputs }),
        outputs: Object.freeze({ ...state.outputs }),
        timingActive: state.timing !== undefined,
        timingProgress: state.timingProgress,
        ...(timingFrameStatistics === undefined
          ? {}
          : { timingFrameStatistics }),
        ...(state.springPosition === undefined ||
        state.springVelocity === undefined
          ? {}
          : {
              springActive: state.spring !== undefined,
              springPosition: state.springPosition,
              springVelocity: state.springVelocity,
              ...(springFrameStatistics === undefined
                ? {}
                : { springFrameStatistics }),
            }),
        ...(state.decayElapsedMilliseconds === undefined ||
        state.decaySpeed === undefined
          ? {}
          : {
              decayActive: state.decay !== undefined,
              decayElapsedMilliseconds: state.decayElapsedMilliseconds,
              decaySpeed: state.decaySpeed,
              ...(decayFrameStatistics === undefined
                ? {}
                : { decayFrameStatistics }),
            }),
      };
      const gesture =
        state.pan === undefined
          ? {}
          : {
              gestureAttached: true,
              gestureActive: state.pan.active,
              gestureSequence: state.pan.sequence,
              ...(state.pan.timestamp === undefined
                ? {}
                : { gestureTimestamp: state.pan.timestamp }),
            };
      return Object.freeze(
        state.timestamp === undefined
          ? { ...base, ...gesture }
          : { ...base, timestamp: state.timestamp, ...gesture },
      );
    },
  };
  return Object.freeze(host);
}
