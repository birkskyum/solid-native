import {
  HOST_CAUSAL_OPERATION_ID_MAX_LENGTH,
  HOST_CONTRACT_VERSION,
  type HostCausalContext,
  type HostCommit,
  type HostMutation,
  type HostProps,
  type HostValue,
} from "@solid-native/host-contract";
import normalizeColor from "@react-native/normalize-colors";

/**
 * Framework-neutral transport envelope consumed by the native Fabric
 * transaction coordinator.
 * The contract version is kept outside HostCommit so every native boundary
 * must state which decoder it expects.
 */
export interface NativeHostTransaction extends HostCommit {
  readonly contractVersion: typeof HOST_CONTRACT_VERSION;
}

function cloneValue(value: HostValue): HostValue {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [name, cloneValue(child)]),
    );
  }
  return value;
}

function isColorProperty(name: string): boolean {
  return (
    name === "color" ||
    name.endsWith("Color") ||
    name === "underlineColorAndroid" ||
    name === "trackColorForFalse" ||
    name === "trackColorForTrue"
  );
}

function processColorValue(
  value: HostValue,
  path: string,
  platform: "android" | "ios",
): HostValue {
  if (
    value === null ||
    (typeof value !== "string" && typeof value !== "number")
  ) {
    return cloneValue(value);
  }
  const normalized = normalizeColor(value);
  if (normalized === null) {
    throw new TypeError(`${path} is not a valid React Native color.`);
  }
  // React Native normalizes to 0xrrggbbaa. Fabric expects 0xaarrggbb, signed
  // on Android and unsigned on iOS, matching React Native's processColor.
  const processed = ((normalized << 24) | (normalized >>> 8)) >>> 0;
  return platform === "android" ? processed | 0 : processed;
}

function cloneStyle(value: HostValue, platform: "android" | "ios"): HostValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return cloneValue(value);
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, child]) => [
      name,
      isColorProperty(name)
        ? processColorValue(child, `style.${name}`, platform)
        : cloneValue(child),
    ]),
  );
}

function cloneNestedColors(
  value: HostValue,
  path: string,
  platform: "android" | "ios",
): HostValue {
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      cloneNestedColors(child, `${path}[${String(index)}]`, platform),
    );
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, child]) => [
      name,
      isColorProperty(name)
        ? processColorValue(child, `${path}.${name}`, platform)
        : cloneNestedColors(child, `${path}.${name}`, platform),
    ]),
  );
}

function processColorArray(
  value: HostValue,
  path: string,
  platform: "android" | "ios",
): HostValue {
  if (!Array.isArray(value)) return cloneValue(value);
  return value.map((entry, index) =>
    processColorValue(entry, `${path}[${String(index)}]`, platform),
  );
}

function containsNestedColors(name: string): boolean {
  return (
    name === "standardAppearance" ||
    name === "scrollEdgeAppearance" ||
    name === "nativeBackgroundAndroid" ||
    name === "nativeForegroundAndroid"
  );
}

function cloneProps(props: HostProps, platform: "android" | "ios"): HostProps {
  return Object.fromEntries(
    Object.entries(props).map(([name, value]) => [
      name,
      name === "style"
        ? cloneStyle(value, platform)
        : name === "colors"
          ? processColorArray(value, name, platform)
          : containsNestedColors(name)
            ? cloneNestedColors(value, name, platform)
            : isColorProperty(name)
              ? processColorValue(value, name, platform)
              : cloneValue(value),
    ]),
  );
}

function cloneMutation(
  mutation: HostMutation,
  platform: "android" | "ios",
): HostMutation {
  switch (mutation.type) {
    case "create-element":
      return { ...mutation, props: cloneProps(mutation.props, platform) };
    case "update-props":
      return {
        ...mutation,
        props: cloneProps(mutation.props, platform),
        removedProps: [...mutation.removedProps],
      };
    case "update-event-listeners":
      return { ...mutation, events: [...mutation.events] };
    case "command":
      return { ...mutation, args: mutation.args.map(cloneValue) };
    default:
      return { ...mutation };
  }
}

function cloneCausalContext(context: HostCausalContext): HostCausalContext {
  if (
    context.operationId.length === 0 ||
    context.operationId.length > HOST_CAUSAL_OPERATION_ID_MAX_LENGTH ||
    context.operationId.includes("\0")
  ) {
    throw new RangeError(
      `The causal operation ID must contain 1-${HOST_CAUSAL_OPERATION_ID_MAX_LENGTH} characters without null bytes.`,
    );
  }
  return { operationId: context.operationId };
}

/**
 * Takes an ownership-safe snapshot for a synchronous or asynchronous JSI call.
 * The returned object contains only host-contract primitives, arrays, and plain
 * objects; callers may mutate their original commit after this function.
 */
export function createNativeHostTransaction(
  commit: HostCommit,
  platform: "android" | "ios",
): NativeHostTransaction {
  return {
    contractVersion: HOST_CONTRACT_VERSION,
    surface: commit.surface,
    sequence: commit.sequence,
    priority: commit.priority,
    mutations: commit.mutations.map((mutation) =>
      cloneMutation(mutation, platform),
    ),
    ...(commit.causalContext === undefined
      ? {}
      : { causalContext: cloneCausalContext(commit.causalContext) }),
  };
}
