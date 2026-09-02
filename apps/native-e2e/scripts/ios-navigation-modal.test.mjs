import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("keeps the physical iOS standalone modal proof cross-layer complete", async () => {
  const [application, automation, runner] = await Promise.all([
    readFile(new URL("navigation-modal.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeNavigationModalUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/ios-navigation-modal-test.sh", directory),
      "utf8",
    ),
  ]);

  assert.match(application, /<NativeModalStack/u);
  assert.match(application, /allowSwipeDismissal: true/u);
  assert.match(application, /presentationStyle: "pageSheet"/u);
  assert.match(application, /history\.blockPlatformTransitions/u);
  assert.match(application, /modalDisposals === modalDismissals - 1/u);
  assert.match(application, /modalDisposals === modalHidden - 1/u);
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_MODAL_TEARDOWN_SUCCEEDED/u,
  );

  for (const label of [
    "Solid Native standalone modal root",
    "Solid Native standalone modal route",
    "Close modal through application history",
    "Enable native modal swipe dismissal",
    "Native modal swipe dismissal blocked",
    "Native modal blocked request arbitrated",
    "Native modal swipe dismissal enabled",
    "Platform modal hidden; owner disposed exactly twice",
    "Dispose standalone modal proof",
  ]) {
    assert.match(application, new RegExp(label, "u"), label);
    assert.match(automation, new RegExp(label, "u"), label);
  }

  const applicationClose = automation.indexOf("applicationClose.tap()");
  const blockedSwipe = automation.indexOf("thenDragTo: dismissalTarget");
  const enableSwipe = automation.indexOf("enableSwipe.tap()");
  const enabledSwipe = automation.lastIndexOf("thenDragTo: dismissalTarget");
  const dispose = automation.indexOf("dispose.tap()");
  assert.ok(applicationClose >= 0 && applicationClose < blockedSwipe);
  assert.ok(blockedSwipe < enableSwipe && enableSwipe < enabledSwipe);
  assert.ok(enabledSwipe < dispose);

  assert.match(runner, /ENTRY_FILE=navigation-modal\.tsx/u);
  assert.match(runner, /testStandaloneNavigationModalOnPhysicalDevice/u);
  assert.match(runner, /SOLID_NATIVE_NAVIGATION_MODAL_PLATFORM_SUCCEEDED/u);
  assert.match(runner, /SOLID_NATIVE_NAVIGATION_MODAL_TEARDOWN_SUCCEEDED/u);
});
