import type { NetworkService } from "@solid-native/networking";

import {
  createDevelopmentNetworkInspector,
  type DevelopmentNetworkInspectorOptions,
} from "./network.js";
import {
  createInspectableNetworkService as createProductionNetworkService,
  type InspectableNetworkService,
} from "./network-service.js";

/** Development implementation selected only by the Solid Native Metro resolver. */
export function createInspectableNetworkService(
  serviceValue: NetworkService,
  options: DevelopmentNetworkInspectorOptions = {},
): InspectableNetworkService {
  const baseline = createProductionNetworkService(serviceValue, options);
  const inspector = createDevelopmentNetworkInspector(options);
  return Object.freeze({
    service: inspector.instrument(baseline.service),
    inspector,
  });
}
