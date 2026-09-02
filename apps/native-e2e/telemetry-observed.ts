import { createSampledCausalTelemetry } from "@solid-native/observability";

import { runTelemetryBenchmark } from "./telemetry-benchmark";

void runTelemetryBenchmark({
  variant: "observed",
  createTelemetry(binding, onRecord) {
    const telemetry = createSampledCausalTelemetry({
      sink: onRecord,
      sampleRate: 1,
      resource: {
        runtimeName: binding.backend,
        runtimeVersion: binding.backendVersion,
        hostContractVersion: binding.contractVersion,
        platform: binding.platform,
        buildFingerprint: "local:android-observed",
      },
    });
    if (telemetry === undefined) {
      throw new Error("The observed telemetry session was rejected.");
    }
    return telemetry;
  },
});
