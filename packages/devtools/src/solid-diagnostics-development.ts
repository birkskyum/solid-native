import {
  SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
  createSolidDiagnosticsDebugEnvelope,
  type SolidDiagnosticsDebugEnvelope,
} from "@solid-native/observability";
import { DEV, flush } from "solid-js";

import type { DevelopmentSolidDiagnosticsController } from "./solid-diagnostics.js";

interface SolidDiagnosticCaptureEvent {
  readonly sequence: number;
}

interface SolidDevelopmentDiagnosticsSurface {
  readonly diagnostics: {
    subscribe(
      listener: (event: SolidDiagnosticCaptureEvent) => void,
    ): () => void;
  };
  readonly attribution: {
    enable(options: Readonly<Record<string, unknown>>): void;
    disable(): void;
    history(): readonly unknown[];
    costs(): unknown;
  };
}

export interface DevelopmentSolidDiagnosticsControllerDependencies {
  readonly dev: SolidDevelopmentDiagnosticsSurface | undefined;
  readonly flush: () => void;
  readonly monotonicNow: () => number;
  readonly wallClockNow: () => Date;
}

interface ActiveSession {
  readonly capturedAt: string;
  readonly startedAt: number;
  readonly diagnostics: SolidDiagnosticCaptureEvent[];
  readonly unsubscribe: () => void;
  acceptingDiagnostics: boolean;
  droppedDiagnostics: number;
}

function defaultDependencies(): DevelopmentSolidDiagnosticsControllerDependencies {
  const runtime = globalThis as typeof globalThis & {
    readonly performance?: { now(): number };
  };
  return {
    dev: DEV as SolidDevelopmentDiagnosticsSurface | undefined,
    flush,
    monotonicNow: () => {
      if (runtime.performance === undefined) {
        throw new Error("Solid diagnostics require a monotonic runtime clock.");
      }
      return runtime.performance.now();
    },
    wallClockNow: () => new Date(),
  };
}

function monotonicTime(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} returned an invalid time.`);
  }
  return value;
}

function capturedAt(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(
      "Solid diagnostics wall clock returned an invalid date.",
    );
  }
  return value.toISOString();
}

/**
 * Development implementation used by Metro and deterministic tests. A capture
 * session is deliberately exclusive because Solid RC3's attribution engine
 * still exposes process-global enable/disable ownership.
 */
export function createDevelopmentSolidDiagnosticsControllerWithDependencies(
  dependencies: DevelopmentSolidDiagnosticsControllerDependencies,
): DevelopmentSolidDiagnosticsController {
  if (dependencies.dev === undefined) {
    throw new Error(
      "Solid diagnostics capture requires the development Solid runtime.",
    );
  }
  const dev = dependencies.dev;
  let session: ActiveSession | undefined;
  let ending = false;

  return Object.freeze({
    available: true,
    get active() {
      return session !== undefined;
    },
    begin() {
      if (session !== undefined) {
        throw new Error(
          "A Solid diagnostics capture session is already active.",
        );
      }
      const startedAt = monotonicTime(
        dependencies.monotonicNow(),
        "Solid diagnostics monotonic clock",
      );
      const startedOn = capturedAt(dependencies.wallClockNow());
      const diagnostics: SolidDiagnosticCaptureEvent[] = [];
      let active: ActiveSession | undefined;
      const unsubscribe = dev.diagnostics.subscribe((event) => {
        if (active === undefined || !active.acceptingDiagnostics) return;
        if (diagnostics.length >= SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS) {
          diagnostics.shift();
          active.droppedDiagnostics += 1;
        }
        diagnostics.push(event);
      });
      active = {
        capturedAt: startedOn,
        startedAt,
        diagnostics,
        unsubscribe,
        acceptingDiagnostics: true,
        droppedDiagnostics: 0,
      };
      session = active;
      try {
        dev.attribution.enable({
          historyLimit: SOLID_DIAGNOSTICS_DEBUG_MAX_RECORDS,
          log: false,
          stacks: false,
        });
      } catch (error) {
        session = undefined;
        active.acceptingDiagnostics = false;
        active = undefined;
        unsubscribe();
        throw error;
      }
    },
    end(): SolidDiagnosticsDebugEnvelope {
      const active = session;
      if (active === undefined) {
        throw new Error("No Solid diagnostics capture session is active.");
      }
      if (ending) {
        throw new Error(
          "The Solid diagnostics capture session is already ending.",
        );
      }
      ending = true;
      try {
        dependencies.flush();
        active.acceptingDiagnostics = false;
        const finishedAt = monotonicTime(
          dependencies.monotonicNow(),
          "Solid diagnostics monotonic clock",
        );
        if (finishedAt < active.startedAt) {
          throw new TypeError(
            "Solid diagnostics monotonic clock moved backwards.",
          );
        }
        return createSolidDiagnosticsDebugEnvelope({
          capturedAt: active.capturedAt,
          durationMilliseconds: finishedAt - active.startedAt,
          droppedDiagnostics: active.droppedDiagnostics,
          diagnostics: active.diagnostics,
          reruns: dev.attribution.history(),
          costs: dev.attribution.costs(),
        });
      } finally {
        active.acceptingDiagnostics = false;
        session = undefined;
        ending = false;
        try {
          dev.attribution.disable();
        } finally {
          active.unsubscribe();
        }
      }
    },
    dispose() {
      if (ending) return;
      const active = session;
      if (active === undefined) return;
      active.acceptingDiagnostics = false;
      session = undefined;
      try {
        dev.attribution.disable();
      } finally {
        active.unsubscribe();
      }
    },
  });
}

export function createDevelopmentSolidDiagnosticsController(): DevelopmentSolidDiagnosticsController {
  return createDevelopmentSolidDiagnosticsControllerWithDependencies(
    defaultDependencies(),
  );
}
