import assert from "node:assert/strict";
import test from "node:test";
import { compileSolidNative } from "./compiler.mjs";

test("compiles Solid Native TSX through the OXC universal backend", () => {
  const filename = "/fixture/Counter.tsx";
  const source = `
    import { Text } from "@solid-native/core";
    type Props = { count: number };
    export function Counter(props: Props) {
      return <Text accessibilityLabel="Count">{props.count}</Text>;
    }
  `;
  const result = compileSolidNative(source, filename);

  assert.match(result.code, /from "@solid-native\/renderer"/);
  assert.match(result.code, /createComponent as _\$createComponent/);
  assert.match(result.code, /_\$createComponent\(Text/);
  assert.doesNotMatch(result.code, /<Text/);
  assert.doesNotMatch(result.code, /props: Props/);
  assert.deepEqual(result.map.sources, [filename]);
  assert.deepEqual(result.map.sourcesContent, [source]);
});
