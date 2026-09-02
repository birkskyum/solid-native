import type { HostProps, HostValue } from "@solid-native/host-contract";

export interface EventProperty {
  readonly name: string;
  readonly capture: boolean;
}

export function parseEventProperty(name: string): EventProperty | undefined {
  let eventName: string;
  if (name.startsWith("on:")) {
    eventName = name.slice(3);
  } else if (/^on[A-Z]/.test(name)) {
    eventName = `${name[2]?.toLowerCase() ?? ""}${name.slice(3)}`;
  } else {
    return undefined;
  }

  const capture = eventName.endsWith("Capture");
  if (capture) eventName = eventName.slice(0, -7);
  if (eventName.length === 0) return undefined;
  return { name: eventName, capture };
}

function flattenStyle(
  value: unknown,
  target: Record<string, unknown>,
  ancestors: Set<readonly unknown[]>,
): void {
  if (value === null || value === undefined || value === false) return;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError("Native style arrays must not be circular.");
    }
    ancestors.add(value);
    for (const entry of value) flattenStyle(entry, target, ancestors);
    ancestors.delete(value);
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError("Native style values must be objects or arrays.");
  }
  Object.assign(target, value);
}

function convertHostValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): HostValue {
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

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError(`${path} contains a circular value.`);
    }
    ancestors.add(value);
    const converted = value.map((entry, index) =>
      convertHostValue(entry, `${path}[${index}]`, ancestors),
    );
    ancestors.delete(value);
    return converted;
  }

  if (typeof value === "object") {
    if (ancestors.has(value)) {
      throw new TypeError(`${path} contains a circular value.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must be a plain transport-safe object.`);
    }

    ancestors.add(value);
    const converted: Record<string, HostValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      converted[key] = convertHostValue(entry, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return converted;
  }

  throw new TypeError(`${path} is not a transport-safe host value.`);
}

export function normalizeHostProperty(
  name: string,
  value: unknown,
): HostValue | undefined {
  if (value === undefined) return undefined;
  if (name === "style") {
    const style: Record<string, unknown> = {};
    flattenStyle(value, style, new Set());
    return convertHostValue(style, "style", new Set());
  }
  return convertHostValue(value, name, new Set());
}

export function normalizeStaticProps(
  props: Record<string, unknown> | undefined,
): HostProps {
  const normalized: Record<string, HostValue> = {};
  for (const [name, value] of Object.entries(props ?? {})) {
    if (
      name === "children" ||
      name === "ref" ||
      parseEventProperty(name) !== undefined
    ) {
      continue;
    }
    const next = normalizeHostProperty(name, value);
    if (next !== undefined) normalized[name] = next;
  }
  return normalized;
}

export function normalizeCommandArgs(args: readonly unknown[]): HostValue[] {
  return args.map((value, index) =>
    convertHostValue(value, `command argument ${index}`, new Set()),
  );
}
