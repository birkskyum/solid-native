import assert from "node:assert/strict";
import test from "node:test";

import { assertNetworkingBundle } from "./verify-networking-sourcemap.mjs";

const requiredSources = [
  "/workspace/apps/native-e2e/networking.tsx",
  "/workspace/packages/networking/dist/index.js",
  "/workspace/packages/networking/dist/json.js",
  "/workspace/packages/networking/dist/react-native-adapter.js",
  "/workspace/packages/networking/dist/react-native.js",
  "/workspace/packages/networking/dist/server-events.js",
  "/workspace/packages/networking/dist/solid.js",
  "/workspace/packages/networking/dist/solid-server-events.js",
];

const androidBootstrapSources = [
  "/workspace/node_modules/react-native/Libraries/Network/fetch.js",
  "/workspace/node_modules/react-native/Libraries/Network/XMLHttpRequest.js",
  "/workspace/node_modules/react-native/Libraries/Network/RCTNetworking.android.js",
  "/workspace/node_modules/react-native/Libraries/Network/NativeNetworkingAndroid.js",
  "/workspace/node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeNetworkingAndroid.js",
];

const completeSources = [...requiredSources, ...androidBootstrapSources];

test("accepts one complete owner-safe incremental networking seam", () => {
  assert.deepEqual(
    assertNetworkingBundle({ sources: completeSources }),
    requiredSources,
  );
});

test("accepts indexed networking source maps", () => {
  assert.deepEqual(
    assertNetworkingBundle({
      sections: [
        { map: { sources: requiredSources.slice(0, 2) } },
        {
          map: {
            sources: [...requiredSources.slice(2), ...androidBootstrapSources],
          },
        },
      ],
    }),
    requiredSources,
  );
});

test("rejects incomplete, duplicate, or unexpected networking seams", () => {
  assert.throws(
    () => assertNetworkingBundle({ sources: completeSources.slice(0, 4) }),
    /exactly one networking proof source/u,
  );
  assert.throws(
    () =>
      assertNetworkingBundle({
        sources: [...completeSources, requiredSources[1]],
      }),
    /exactly one networking proof source/u,
  );
  assert.throws(
    () =>
      assertNetworkingBundle({
        sources: [
          ...completeSources,
          "/workspace/packages/networking/dist/private.js",
        ],
      }),
    /unexpected package sources/u,
  );
});

test("requires one exact platform setup-env networking baseline", () => {
  assert.throws(
    () => assertNetworkingBundle({ sources: requiredSources }),
    /exactly one React Native platform networking bootstrap/u,
  );
  assert.throws(
    () =>
      assertNetworkingBundle({
        sources: [
          ...completeSources,
          "/workspace/node_modules/react-native/Libraries/Network/RCTNetworking.ios.js",
        ],
      }),
    /exactly one React Native platform networking bootstrap/u,
  );
  assert.throws(
    () =>
      assertNetworkingBundle({
        sources: completeSources.filter(
          (source) => !source.endsWith("/Libraries/Network/fetch.js"),
        ),
      }),
    /one pinned React Native setup-env source/u,
  );
});
