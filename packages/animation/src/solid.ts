import { createEffect, getOwner, onCleanup, type Accessor } from "solid-js";

import {
  createUIWorkletSession,
  type UIWorkletGraph,
  type UIWorkletHost,
  type UIWorkletSession,
  type UIWorkletSessionOptions,
} from "./index.js";

export interface SolidUIWorkletOptions extends UIWorkletSessionOptions {
  /** Observes a bridge or cleanup failure without changing other owners. */
  readonly onError?: (error: unknown) => unknown;
}

function reportError(error: unknown, options: SolidUIWorkletOptions): void {
  if (options.onError === undefined) throw error;
  try {
    const reported = options.onError(error);
    void Promise.resolve(reported).catch(() => undefined);
  } catch {
    // A diagnostic hook cannot revive or break another Solid owner.
  }
}

/** Installs a graph and binds idempotent cancellation to the current owner. */
export function createOwnedUIWorkletSession(
  host: UIWorkletHost,
  graph: UIWorkletGraph,
  options: SolidUIWorkletOptions = {},
): UIWorkletSession {
  if (getOwner() === null) {
    throw new Error(
      "createOwnedUIWorkletSession requires an active Solid owner.",
    );
  }
  const session = createUIWorkletSession(host, graph, options);
  onCleanup(() => {
    try {
      session.dispose();
    } catch (error) {
      reportError(error, options);
    }
  });
  return session;
}

/**
 * Coarsely synchronizes application state into a UI worklet. Gesture/frame
 * inputs should originate inside the eventual native host, not round-trip
 * through this JavaScript-thread bridge.
 */
export function createSolidUIWorklet(
  host: UIWorkletHost,
  graph: UIWorkletGraph,
  inputs: Accessor<Readonly<Record<string, number>>>,
  options: SolidUIWorkletOptions = {},
): UIWorkletSession {
  const session = createOwnedUIWorkletSession(host, graph, options);
  let active = true;
  createEffect(inputs, (nextInputs) => {
    if (!active) return;
    try {
      session.update(nextInputs);
    } catch (error) {
      active = false;
      try {
        session.dispose();
      } catch (disposeError) {
        reportError(disposeError, options);
      }
      reportError(error, options);
    }
  });
  onCleanup(() => {
    active = false;
  });
  return session;
}
