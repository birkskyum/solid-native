import type { SolidDiagnosticsDebugEnvelope } from "@solid-native/observability";

export interface DevelopmentSolidDiagnosticsController {
  readonly available: boolean;
  readonly active: boolean;
  begin(): void;
  end(): SolidDiagnosticsDebugEnvelope;
  dispose(): void;
}

const unavailableController: DevelopmentSolidDiagnosticsController =
  Object.freeze({
    available: false,
    active: false,
    begin(): never {
      throw new Error(
        "Solid diagnostics capture requires a Solid Native development bundle.",
      );
    },
    end(): never {
      throw new Error(
        "Solid diagnostics capture requires a Solid Native development bundle.",
      );
    },
    dispose() {},
  });

/**
 * Production shim selected by default. Metro substitutes the development
 * implementation only for development bundles, keeping Solid's diagnostics
 * engine and captured artifacts out of optimized applications.
 */
export function createDevelopmentSolidDiagnosticsController(): DevelopmentSolidDiagnosticsController {
  return unavailableController;
}
