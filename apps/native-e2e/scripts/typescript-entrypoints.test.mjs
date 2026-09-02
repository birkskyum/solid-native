import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("type-checks every checked-in native application entrypoint", async () => {
  const configuration = JSON.parse(
    await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(configuration.include, [
    "*.ts",
    "*.tsx",
    "generated/**/*.ts",
    "specs/**/*.ts",
  ]);
});
