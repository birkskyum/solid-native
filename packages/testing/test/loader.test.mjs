import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

test("compiles imported Solid TSX through the Node test runner", async () => {
  const fixture = await mkdtemp(path.join(packageRoot, ".loader-test-"));
  try {
    const testFile = path.join(fixture, "Counter.test.tsx");
    await writeFile(
      testFile,
      `/** @jsxImportSource @solid-native/core */
import assert from "node:assert/strict";
import test from "node:test";
import { Pressable, Text, View } from "@solid-native/core";
import { createSignal } from "solid-js";
import { renderNative } from "../dist/index.js";

interface CounterProps { readonly initial: number }

function Counter(props: CounterProps) {
  const [count, setCount] = createSignal(props.initial);
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="Increment" onPress={() => setCount(value => value + 1)}>
      <Text>Increment</Text>
    </Pressable>
    <Text>Count: {count()}</Text>
  </View>;
}

test("updates one native text node", async () => {
  const screen = await renderNative(() => <Counter initial={4} />);
  try {
    await screen.press(screen.getByRole("button", { name: "Increment" }));
    assert.equal(screen.getByText("Count: 5").textContent, "Count: 5");
  } finally {
    await screen.cleanup();
  }
});
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=browser",
        "--enable-source-maps",
        "--import",
        pathToFileURL(path.join(packageRoot, "dist", "register.js")).href,
        "--test",
        testFile,
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== "NODE_TEST_CONTEXT",
          ),
        ),
      },
    );
    assert.equal(
      result.status,
      0,
      `${result.error?.message ?? ""}\n${result.stderr}\n${result.stdout}`,
    );
    assert.match(result.stdout, /updates one native text node/u);
    assert.doesNotMatch(result.stderr, /DEP0205|module\.register\(\)/u);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
});
