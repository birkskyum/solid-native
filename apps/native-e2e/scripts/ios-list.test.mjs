import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical iOS list proof keeps its bounded command-race contract aligned", async () => {
  const [application, automation, runner, manifest] = await Promise.all([
    readFile(new URL("list.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-list-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  assert.match(application, /MAXIMUM_IMPERATIVE_STRUCTURAL_COMMITS = 4/u);
  assert.match(application, /new Map<number, HostCommit>\(\)/u);
  assert.match(application, /structuralCommitCount < 1/u);
  assert.match(
    application,
    /structuralTransactions\.some\(\(transaction\) =>[\s\S]*mutation\.type === "command"/u,
  );
  assert.match(application, /commandTransaction === undefined/u);
  assert.match(application, /commandMutation\.command !== "scrollTo"/u);
  assert.match(
    application,
    /commandMutation\.args\[1\] !== IMPERATIVE_EXPECTED_OFFSET/u,
  );
  assert.match(application, /commandPriority: commandTransaction\.priority/u);
  assert.doesNotMatch(application, /commandSequence !== windowSequence \+ 1/u);
  assert.match(automation, /testVirtualizedListOnPhysicalDevice/u);
  assert.match(
    automation,
    /Solid Native VirtualizedList prepend anchor retained/u,
  );
  assert.match(
    automation,
    /Solid Native VirtualizedList imperative index mounted/u,
  );
  assert.match(runner, /ENTRY_FILE=list\.tsx/u);
  assert.match(runner, /SOLID_NATIVE_VIRTUALIZED_LIST_PREPEND_SUCCEEDED/u);
  assert.match(runner, /SOLID_NATIVE_VIRTUALIZED_LIST_IMPERATIVE_SUCCEEDED/u);
  assert.equal(
    manifest.scripts["ios:list:test"],
    "sh scripts/ios-list-test.sh",
  );
});
