import assert from "node:assert/strict";
import test from "node:test";

import { createReactNativeClipboardAdapter } from "../dist/react-native-adapter.js";

test("maps the portable clipboard contract to the native module exactly", async () => {
  const calls = [];
  const clipboard = createReactNativeClipboardAdapter({
    async getString() {
      calls.push(["getString"]);
      return "from native";
    },
    setString(text) {
      calls.push(["setString", text]);
    },
  });

  assert.equal(await clipboard.readText(), "from native");
  clipboard.writeText("to native");
  clipboard.clear();
  assert.deepEqual(calls, [
    ["getString"],
    ["setString", "to native"],
    ["setString", ""],
  ]);
});

test("rejects incomplete React Native Clipboard modules", () => {
  assert.throws(
    () => createReactNativeClipboardAdapter(null),
    /must be an object/u,
  );
  assert.throws(
    () => createReactNativeClipboardAdapter({ getString() {} }),
    /getString\(\) and setString\(\)/u,
  );
  assert.throws(
    () => createReactNativeClipboardAdapter({ setString() {} }),
    /getString\(\) and setString\(\)/u,
  );
});
