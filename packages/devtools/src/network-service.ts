import type { NetworkService } from "@solid-native/networking";

import type {
  DevelopmentNetworkInspector,
  DevelopmentNetworkInspectorOptions,
} from "./network.js";

export interface InspectableNetworkService {
  readonly service: NetworkService;
  /** Present only when the Solid Native Metro resolver builds with `dev: true`. */
  readonly inspector: DevelopmentNetworkInspector | undefined;
}

function requireNetworkService(value: NetworkService): NetworkService {
  if (
    value === null ||
    typeof value !== "object" ||
    (value.platform !== "android" && value.platform !== "ios") ||
    typeof value.requestText !== "function"
  ) {
    throw new TypeError(
      "createInspectableNetworkService requires an Android or iOS NetworkService.",
    );
  }
  return value;
}

function validateOptions(options: DevelopmentNetworkInspectorOptions): void {
  if (options === null || typeof options !== "object") {
    throw new TypeError(
      "Inspectable network service options must be an object.",
    );
  }
  if (
    options.maxHistory !== undefined &&
    (!Number.isSafeInteger(options.maxHistory) ||
      options.maxHistory < 1 ||
      options.maxHistory > 500)
  ) {
    throw new TypeError(
      "Inspectable network maxHistory must be a safe integer from 1 through 500.",
    );
  }
  if (
    options.captureRequestTargets !== undefined &&
    typeof options.captureRequestTargets !== "boolean"
  ) {
    throw new TypeError("captureRequestTargets must be a boolean.");
  }
  if (options.clock !== undefined && typeof options.clock !== "function") {
    throw new TypeError("Inspectable network clock must be a function.");
  }
}

/**
 * Production pass-through selected by `@solid-native/metro`. Development
 * builds resolve this entry point to the bounded local inspector implementation.
 */
export function createInspectableNetworkService(
  serviceValue: NetworkService,
  options: DevelopmentNetworkInspectorOptions = {},
): InspectableNetworkService {
  const service = requireNetworkService(serviceValue);
  validateOptions(options);
  return Object.freeze({ service, inspector: undefined });
}
