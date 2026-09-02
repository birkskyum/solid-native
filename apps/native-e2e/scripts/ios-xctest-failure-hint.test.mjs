import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  describeXCTestFailure,
  UI_AUTOMATION_TIMEOUT_HINT,
} from "./ios-xctest-failure-hint.mjs";

test("explains a pre-launch XCTest UI-automation timeout", () => {
  assert.equal(
    describeXCTestFailure({
      testFailures: [
        {
          failureText:
            "The test runner failed to initialize for UI testing. (Underlying Error: Timed out while enabling automation mode.)",
          testName: "SolidNativeE2EUITests-Runner encountered an error",
        },
      ],
    }),
    UI_AUTOMATION_TIMEOUT_HINT,
  );
  assert.match(UI_AUTOMATION_TIMEOUT_HINT, /application code did not launch/iu);
  assert.match(UI_AUTOMATION_TIMEOUT_HINT, /will not retry automatically/iu);
});

test("does not hide an unrelated XCTest failure behind a guessed remediation", () => {
  assert.equal(
    describeXCTestFailure({
      testFailures: [
        {
          failureText: "XCTAssertEqual failed: expected root owner to persist",
          testName: "testNavigationProcessRestorationOnPhysicalDevice()",
        },
      ],
    }),
    undefined,
  );
  assert.equal(describeXCTestFailure(null), undefined);
  assert.equal(describeXCTestFailure({ testFailures: "invalid" }), undefined);
});

test("all physical XCTest runners diagnose failures without retrying", async () => {
  const runners = [
    "ios-test.sh",
    "ios-control-test.sh",
    "ios-list-test.sh",
    "ios-initial-list-test.sh",
    "ios-measured-list-test.sh",
    "ios-worklet-test.sh",
    "ios-tabs-test.sh",
    "ios-navigation-modal-test.sh",
    "ios-navigation-restoration-test.sh",
    "ios-navigation-sheet-test.sh",
  ];
  for (const runner of runners) {
    const source = await readFile(new URL(runner, import.meta.url), "utf8");
    assert.match(source, /set \+e\nxcodebuild \\/u, runner);
    assert.match(source, /XCODEBUILD_STATUS=\$\?/u, runner);
    assert.match(
      source,
      /ios-xctest-failure-hint\.mjs" "\$RESULT_BUNDLE_PATH"/u,
      runner,
    );
    assert.match(source, /exit "\$XCODEBUILD_STATUS"/u, runner);
    assert.doesNotMatch(source, /\bxcodebuild[^\n]*\bretry\b/iu, runner);
  }
});
