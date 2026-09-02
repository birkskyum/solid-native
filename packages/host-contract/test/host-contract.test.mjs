import assert from "node:assert/strict";
import test from "node:test";

import {
  IncompatibleHostError,
  assertCompatibleHost,
  inspectHost,
} from "@solid-native/host-contract";

function createHost({
  platform = "ios",
  contractVersion = 1,
  nativeScreens = false,
  components = ["RootView", "Text"],
} = {}) {
  const descriptors = new Set(components);
  return {
    platform,
    capabilities: {
      contractVersion,
      synchronousMeasurement: true,
      bubblingEvents: true,
      nativeScreens,
      uiWorklets: false,
      viewRecycling: false,
      commitMountEvents: true,
    },
    createSurface: () => 1,
    destroySurface: () => {},
    allocateNode: () => 1,
    commit: (transaction) => ({
      surface: transaction.surface,
      sequence: transaction.sequence,
      mounted: true,
    }),
    measure: () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      pageX: 0,
      pageY: 0,
      observedSequence: 0,
    }),
    subscribe: () => () => {},
    getComponentDescriptor: (name) =>
      descriptors.has(name)
        ? {
            name,
            acceptsRawText: name === "Text",
            bubblingEvents: [],
            directEvents: [],
            commands: {},
          }
        : undefined,
  };
}

test("validates framework-neutral host requirements before surface creation", () => {
  const report = inspectHost(createHost(), {
    components: ["Text", "RootView", "MissingView", "Text"],
    capabilities: ["bubblingEvents", "nativeScreens"],
  });

  assert.deepEqual(report, {
    compatible: false,
    issues: [
      "Required capability nativeScreens is unavailable.",
      "Required native component MissingView is unavailable.",
    ],
    fingerprint: {
      contractVersion: 1,
      platform: "ios",
      capabilities: {
        contractVersion: 1,
        synchronousMeasurement: true,
        bubblingEvents: true,
        nativeScreens: false,
        uiWorklets: false,
        viewRecycling: false,
        commitMountEvents: true,
      },
      availableComponents: ["RootView", "Text"],
    },
  });
});

test("returns a portable fingerprint for a compatible host", () => {
  const fingerprint = assertCompatibleHost(
    createHost({ nativeScreens: true }),
    {
      components: ["RootView", "Text"],
      capabilities: ["bubblingEvents", "nativeScreens"],
    },
  );

  assert.equal(fingerprint.contractVersion, 1);
  assert.equal(fingerprint.platform, "ios");
  assert.deepEqual(fingerprint.availableComponents, ["RootView", "Text"]);
});

test("throws a structured neutral error for an incompatible host", () => {
  assert.throws(
    () =>
      assertCompatibleHost(createHost({ platform: "", contractVersion: 2 }), {
        components: ["MissingView"],
      }),
    (error) =>
      error instanceof IncompatibleHostError &&
      error.name === "IncompatibleHostError" &&
      error.message.startsWith("Incompatible native host:") &&
      error.report.issues.length === 3,
  );
});
