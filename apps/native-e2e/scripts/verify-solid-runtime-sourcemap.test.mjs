import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoReactNativeLinkingFacade,
  assertNoReactNativePackageBarrels,
  assertNoSafeAreaReactWrapper,
  assertNoSolidDevelopmentDiagnostics,
  assertSingleSolidRuntime,
} from "./verify-solid-runtime-sourcemap.mjs";

const solid = (file) => `/workspace/node_modules/solid-js/dist/${file}`;
const signals = (file) =>
  `/workspace/node_modules/@solidjs/signals/dist/${file}`;

test("accepts one matching production Solid runtime pair", () => {
  assert.deepEqual(
    assertSingleSolidRuntime({
      sources: [solid("solid.js"), signals("prod/index.js"), "application.js"],
    }),
    {
      signalsRuntime: signals("prod/index.js"),
      solidRuntime: solid("solid.js"),
    },
  );
});

test("accepts indexed development maps and deduplicates repeated sources", () => {
  assert.deepEqual(
    assertSingleSolidRuntime({
      sections: [
        { map: { sources: [solid("dev.js"), signals("dev.js")] } },
        { map: { sources: [solid("dev.js")] } },
      ],
    }),
    {
      signalsRuntime: signals("dev.js"),
      solidRuntime: solid("dev.js"),
    },
  );
});

test("rejects duplicate, server, mismatched, and missing Solid runtimes", () => {
  assert.throws(
    () =>
      assertSingleSolidRuntime({
        sources: [
          solid("solid.js"),
          solid("solid.cjs"),
          signals("prod/index.js"),
          signals("node.cjs"),
        ],
      }),
    /exactly one Solid runtime/,
  );
  assert.throws(
    () =>
      assertSingleSolidRuntime({
        sources: [solid("server.js"), signals("prod/index.js")],
      }),
    /incompatible Solid runtime pair/,
  );
  assert.throws(
    () =>
      assertSingleSolidRuntime({
        sources: [solid("dev.js"), signals("prod/index.js")],
      }),
    /incompatible Solid runtime pair/,
  );
  assert.throws(
    () => assertSingleSolidRuntime({ sources: ["application.js"] }),
    /exactly one Solid runtime/,
  );
});

test("rejects Solid's development-only diagnostics harness", () => {
  assert.doesNotThrow(() =>
    assertNoSolidDevelopmentDiagnostics({
      sources: [solid("solid.js"), signals("prod/index.js")],
    }),
  );
  assert.throws(
    () =>
      assertNoSolidDevelopmentDiagnostics({
        sources: [
          "/workspace/node_modules/.pnpm/@solidjs+diagnostics@2.0.0-rc.3/node_modules/@solidjs/diagnostics/dist/index.js",
        ],
      }),
    /development-only Solid diagnostics/u,
  );
  assert.throws(
    () =>
      assertNoSolidDevelopmentDiagnostics({
        sources: [
          "/workspace/packages/devtools/dist/solid-diagnostics-development.js",
        ],
      }),
    /development-only Solid diagnostics/u,
  );
});

test("rejects the safe-area dependency's React JavaScript wrapper", () => {
  assert.doesNotThrow(() =>
    assertNoSafeAreaReactWrapper({
      sources: ["/workspace/apps/native-e2e/safe-area.tsx"],
    }),
  );
  assert.throws(
    () =>
      assertNoSafeAreaReactWrapper({
        sources: [
          "/workspace/node_modules/.pnpm/react-native-safe-area-context@5.8.1/node_modules/react-native-safe-area-context/src/index.tsx",
        ],
      }),
    /safe-area-context React wrapper/,
  );
});

test("rejects React Native's Linking JavaScript facade", () => {
  assert.doesNotThrow(() =>
    assertNoReactNativeLinkingFacade({
      sources: [
        "/workspace/packages/runtime/src/react-native-platform-services.ts",
      ],
    }),
  );
  assert.throws(
    () =>
      assertNoReactNativeLinkingFacade({
        sources: [
          "/workspace/node_modules/react-native/Libraries/Linking/Linking.js",
        ],
      }),
    /Linking JavaScript facade/u,
  );
});

test("rejects React Native and camera package barrels", () => {
  assert.doesNotThrow(() =>
    assertNoReactNativePackageBarrels({
      sources: [
        "/workspace/node_modules/react-native/Libraries/TurboModule/TurboModuleRegistry.js",
        "/workspace/packages/camera/dist/nitro-adapter.js",
      ],
    }),
  );
  for (const source of [
    "/workspace/node_modules/react-native/index.js",
    "/workspace/node_modules/react-native-vision-camera/src/index.ts",
    "/workspace/node_modules/react-native-vision-camera/src/hooks/useCamera.ts",
    "/workspace/node_modules/react-native-vision-camera/src/views/Camera.tsx",
    "/workspace/node_modules/react-native-nitro-modules/src/index.ts",
  ]) {
    assert.throws(
      () => assertNoReactNativePackageBarrels({ sources: [source] }),
      /React-facing package barrel or camera surface/u,
    );
  }
});
