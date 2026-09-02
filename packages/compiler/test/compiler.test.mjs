import assert from "node:assert/strict";
import test from "node:test";

import {
  SOLID_NATIVE_BUILT_INS,
  compileSolidNativeModule,
  solidNativeCompilerCacheKey,
  transformSolidNativeJsx,
} from "@solid-native/compiler";

const filename = "/fixture/Counter.tsx";
const source = `
  import { Text } from "@solid-native/core";
  type Props = { count: number };
  export function Counter(props: Props) {
    return <Text accessibilityLabel="Count">{props.count}</Text>;
  }
`;

test("shares the Solid universal OXC transform across build integrations", () => {
  const solid = transformSolidNativeJsx(source, filename);
  const compiled = compileSolidNativeModule(source, filename);

  assert.equal(Object.isFrozen(SOLID_NATIVE_BUILT_INS), true);
  assert.match(solidNativeCompilerCacheKey, /^[a-f0-9]{64}$/u);
  assert.match(solid.code, /from "@solid-native\/renderer"/u);
  assert.match(compiled.code, /createComponent as _\$createComponent/u);
  assert.doesNotMatch(compiled.code, /<Text/u);
  assert.doesNotMatch(compiled.code, /props: Props/u);
  assert.deepEqual(compiled.map.sources, [filename]);
  assert.deepEqual(compiled.map.sourcesContent, [source]);
});

test("rejects malformed compiler inputs", () => {
  assert.throws(() => transformSolidNativeJsx(null, filename), /source/u);
  assert.throws(() => transformSolidNativeJsx(source, ""), /filename/u);
  assert.throws(
    () => transformSolidNativeJsx(source, "bad\0name.tsx"),
    /filename/u,
  );
});
