import { createSampledCausalTelemetry } from "@solid-native/observability";

import { runProductWorkload } from "./product-workload-app";

void runProductWorkload({
  variant: "observed",
  createTelemetry(binding, sink) {
    const telemetry = createSampledCausalTelemetry({
      sink,
      sampleRate: 1,
      resource: {
        runtimeName: binding.backend,
        runtimeVersion: binding.backendVersion,
        hostContractVersion: binding.contractVersion,
        platform: binding.platform,
        buildFingerprint: "local:android-product-observed",
      },
    });
    if (telemetry === undefined) {
      throw new Error("The observed product telemetry session was rejected.");
    }
    return telemetry;
  },
});
