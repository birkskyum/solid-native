import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("keeps the physical iOS header-menu proof cross-layer complete", async () => {
  const [application, automation, runner] = await Promise.all([
    readFile(new URL("navigation-restoration.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/ios-navigation-restoration-test.sh", directory),
      "utf8",
    ),
  ]);

  for (const source of [application, automation]) {
    assert.match(source, /Run detail native header action/u);
    assert.match(source, /Open detail native header menu/u);
    assert.match(source, /Nested native header menu/u);
    assert.match(source, /Confirm nested native header menu/u);
    assert.match(source, /Detail header action complete/u);
    assert.match(source, /Detail header menu action complete/u);
  }

  assert.match(application, /headerRightBarButtonItems/u);
  assert.match(application, /type: "submenu"/u);
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_ACTION_SUCCEEDED/u,
  );
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_MENU_ACTION_SUCCEEDED/u,
  );
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED/u,
  );
  assert.match(application, /<TanStackNativeLink/u);
  assert.match(
    application,
    /testID=\{ROOT_SCROLL_TEST_ID\}[\s\S]*?onScroll=\{captureRootScroll\}/u,
  );
  assert.match(application, /await delay\(75\)/u);
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    application,
    /await routerReady;[\s\S]*application\.root\.flushMounted\(\)/u,
    "physical readiness must wait for TanStack's initial load and its native mount",
  );

  const buttonTap = automation.indexOf("headerAction.tap()");
  const menuTap = automation.indexOf("headerMenu.tap()");
  const submenuTap = automation.indexOf("nestedMenu.tap()");
  const actionTap = automation.indexOf("nestedAction.tap()");
  const canceledGesture = automation.lastIndexOf(
    "performCanceledNativeBackGesture()",
  );
  assert.ok(buttonTap >= 0 && buttonTap < menuTap);
  assert.ok(menuTap < submenuTap && submenuTap < actionTap);
  assert.ok(actionTap < canceledGesture);

  assert.match(
    automation,
    /scrollStart\.press\([\s\S]*?unscrolledRootY - 320/u,
  );
  assert.match(
    automation,
    /restoredRootScrollView[\s\S]*?XCTAssertEqual\([\s\S]*?root\.frame\.minY,[\s\S]*?capturedRootY/u,
  );

  assert.match(
    runner,
    /SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_ACTION_SUCCEEDED/u,
  );
  assert.match(
    runner,
    /SOLID_NATIVE_NAVIGATION_PROCESS_HEADER_MENU_ACTION_SUCCEEDED/u,
  );
  assert.match(runner, /SOLID_NATIVE_NAVIGATION_PROCESS_FOCUS_TASK_SUCCEEDED/u);
  assert.match(
    runner,
    /SOLID_NATIVE_NAVIGATION_PROCESS_LINK_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    runner,
    /SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_SUCCEEDED[\s\S]*SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_SUCCEEDED/u,
  );
  assert.match(runner, /SOURCEMAP_FILE="\$SOURCE_MAP_PATH"/u);
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(
    runner,
    /verify-navigation-sourcemap\.mjs[\s\S]*navigation-restoration\.tsx/u,
  );
  assert.match(
    runner,
    /build-for-testing[\s\S]*verify-navigation-sourcemap\.mjs[\s\S]*start_solid_native_ios_process_guard[\s\S]*test-without-building/u,
  );
});

test("keeps the physical iOS native-sheet proof cross-layer complete", async () => {
  const [application, automation, runner] = await Promise.all([
    readFile(new URL("navigation-restoration.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(
      new URL("scripts/ios-navigation-sheet-test.sh", directory),
      "utf8",
    ),
  ]);

  for (const source of [application, automation]) {
    assert.match(source, /native-sheet-detents/u);
    assert.match(source, /Native sheet detent 0 stable/u);
    assert.match(source, /Dispose navigation process proof/u);
  }
  assert.match(application, /presentation: "sheet"/u);
  assert.match(application, /sheetAllowedDetents: \[0\.55, 0\.92\]/u);
  assert.match(
    application,
    /SOLID_NATIVE_NAVIGATION_PROCESS_SHEET_DETENT_SUCCEEDED/u,
  );

  const drag = automation.indexOf("thenDragTo: collapsedTarget");
  const collapsed = automation.indexOf('"Native sheet detent 0 stable"');
  const dispose = automation.lastIndexOf("dispose.tap()");
  assert.ok(drag >= 0 && drag < collapsed);
  assert.ok(collapsed < dispose);

  assert.match(runner, /testNavigationSheetDetentsOnPhysicalDevice/u);
  assert.match(
    runner,
    /SOLID_NATIVE_NAVIGATION_PROCESS_SHEET_DETENT_SUCCEEDED/u,
  );
  assert.match(runner, /SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED/u);
});
