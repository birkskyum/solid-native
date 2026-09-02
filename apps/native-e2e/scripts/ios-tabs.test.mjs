import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("keeps selected-tab iOS gesture arbitration cross-layer complete", async () => {
  const [
    application,
    automation,
    runner,
    productRunner,
    navigation,
    appDelegate,
  ] = await Promise.all([
    readFile(new URL("tabs.tsx", directory), "utf8"),
    readFile(
      new URL(
        "ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/ios-tabs-test.sh", directory), "utf8"),
    readFile(new URL("scripts/ios-tabs-product-test.sh", directory), "utf8"),
    readFile(
      new URL("../../packages/navigation/src/index.ts", directory),
      "utf8",
    ),
    readFile(
      new URL("ios/SolidNativeE2E/AppDelegate.swift", directory),
      "utf8",
    ),
  ]);

  for (const marker of [
    "SOLID_NATIVE_TABS_PLATFORM_CANCEL_SUCCEEDED",
    "SOLID_NATIVE_TABS_PLATFORM_BLOCKED_SUCCEEDED",
    "SOLID_NATIVE_TABS_BLOCKER_RELEASED",
    "SOLID_NATIVE_TABS_PLATFORM_GESTURE_SUCCEEDED",
  ]) {
    assert.match(application, new RegExp(marker, "u"));
    assert.match(runner, new RegExp(marker, "u"));
  }

  assert.match(application, /settingsRouterHistory\.block\(/u);
  assert.match(application, /onPlatformBackCancel/u);
  assert.match(application, /onPlatformBackBlocked/u);
  assert.match(
    application,
    /blockedBackCount !==[\s\S]*canceledBackCount !==/u,
  );
  assert.match(
    navigation,
    /onGestureCancel\(event\)[\s\S]*if \(hasPlatformTransitionBlockers\(\)\)[\s\S]*handleNativeDismiss\(entry\(\), event\)[\s\S]*onPlatformBackCancel/u,
  );

  const seedCanceled = automation.indexOf(
    'staticTexts["Native tabs selected detail gesture canceled"]',
  );
  const seedPersisted = automation.indexOf(
    'buttons["Persist native tabs for process relaunch"]',
  );
  const restoreBlocked = automation.indexOf(
    'staticTexts["Native tabs selected detail Back blocked"]',
  );
  const restoredRoot = automation.indexOf(
    'staticTexts["Settings TanStack loader root"]',
  );
  assert.ok(seedCanceled >= 0 && seedCanceled < seedPersisted);
  assert.ok(restoreBlocked > seedPersisted && restoreBlocked < restoredRoot);

  const tabsAutomation = automation.slice(
    automation.indexOf("func testNativeTabsOnPhysicalDevice()"),
    automation.indexOf(
      "func testNavigationProcessRestorationOnPhysicalDevice()",
    ),
  );
  const canceledGestures = tabsAutomation.match(
    /performCanceledNativeBackGesture\(\)/gu,
  );
  assert.equal(canceledGestures?.length, 2);
  assert.match(tabsAutomation, /for _ in 0\.\.<3[\s\S]*retainedPopSucceeded/u);

  const proofPhases = [
    "INITIAL_IMAGE",
    "NONE",
    "RESOURCE",
    "RACE_NONE",
    "STABLE_NONE",
    "RESTORED_RESOURCE",
    "RESTORED_IMAGE",
  ];
  let precedingMarker = -1;
  for (const marker of proofPhases) {
    const markerOffset = appDelegate.indexOf(`succeed("${marker}"`);
    assert.ok(markerOffset > precedingMarker);
    precedingMarker = markerOffset;
    assert.match(
      runner,
      new RegExp(`SOLID_NATIVE_IOS_TABS_PROOF_${marker}_SUCCEEDED`, "u"),
    );
  }
  assert.match(
    appDelegate,
    /solidNativeApplication = SolidNativeFabricApplication\.start[\s\S]*SolidNativeTabsPhysicalProof\.start\([\s\S]*launchURL: launchOptions\[\.url\]/u,
  );
  assert.match(appDelegate, /launchURL\?\.path == "\/icon-ownership-proof"/u);
  assert.match(
    appDelegate,
    /DispatchQueue\.main\.asyncAfter[\s\S]*poll\(window: window\)/u,
  );
  assert.match(
    appDelegate,
    /case \.raceAbsent where mode == IconMode\.absent:[\s\S]*case \.stableAbsent:[\s\S]*stale raster callback/u,
  );
  assert.match(
    appDelegate,
    /firstTabBar\(in: window\)[\s\S]*inspect\(tabBar: tabBar[\s\S]*item\.standardAppearance[\s\S]*item\.scrollEdgeAppearance/u,
  );
  assert.match(
    appDelegate,
    /case \.absent:[\s\S]*items\[0\]\.image == nil[\s\S]*case \.resource:[\s\S]*isSymbolImage == true[\s\S]*case \.image:[\s\S]*renderingMode == \.alwaysTemplate/u,
  );
  assert.match(
    appDelegate,
    /backgroundColor[\s\S]*backgroundEffect == nil[\s\S]*shadowColor[\s\S]*normal\.titleTextAttributes[\s\S]*selected\.badgeBackgroundColor/u,
  );
  assert.doesNotMatch(automation, /native-tabs-proof/u);
  assert.match(
    automation,
    /iconOwnershipURL[\s\S]*Thread\.sleep\(forTimeInterval: 6\.5\)[\s\S]*processSeedURL/u,
  );
  assert.match(
    application,
    /mount === undefined[\s\S]*application\.root\.lastCommittedSequence !== mount\.sequence[\s\S]*ownerCreations !== tabs\.length/u,
  );
  assert.doesNotMatch(application, /mount\?\.sequence !== 1/u);
  assert.match(runner, /PROCESS_COUNT" -ne 4/u);
  assert.match(runner, /SOLID_NATIVE_IOS_TABS_APPEARANCE_FAILED/u);

  for (const marker of [
    "SOLID_NATIVE_TABS_PRODUCT_AUTH_REDIRECT_SUCCEEDED",
    "SOLID_NATIVE_TABS_PRODUCT_SESSION_STORED",
    "SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORED",
    "SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORE_SUCCEEDED",
    "SOLID_NATIVE_TABS_PRODUCT_SESSION_CLEARED",
    "SOLID_NATIVE_TABS_PRODUCT_LINK_CAUSALITY_SUCCEEDED",
    "SOLID_NATIVE_TABS_PRODUCT_INTERRUPTION_SUCCEEDED",
    "SOLID_NATIVE_TABS_PRODUCT_COMPOSITION_SUCCEEDED",
  ]) {
    assert.match(application, new RegExp(marker, "u"));
    assert.match(productRunner, new RegExp(marker, "u"));
  }
  assert.match(
    productRunner,
    /testNativeTabsProductCompositionOnPhysicalDevice/u,
  );
  assert.match(productRunner, /PROCESS_COUNT" -ne 2/u);
  assert.match(productRunner, /SOURCEMAP_FILE="\$SOURCE_MAP_PATH"/u);
  assert.match(productRunner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(
    productRunner,
    /verify-navigation-sourcemap\.mjs[\s\S]*tabs\.tsx/u,
  );
  assert.match(
    productRunner,
    /build-for-testing[\s\S]*verify-navigation-sourcemap\.mjs[\s\S]*start_solid_native_ios_process_guard[\s\S]*test-without-building/u,
  );
  assert.match(
    productRunner,
    /SOLID_NATIVE_TABS_PRODUCT_AUTH_REDIRECT_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_STORED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_LINK_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_INTERRUPTION_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_COMPOSITION_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PLATFORM_GESTURE_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_SELECTION_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORE_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_CLEARED[\s\S]*SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED/u,
  );

  const productAutomation = automation.slice(
    automation.indexOf(
      "func testNativeTabsProductCompositionOnPhysicalDevice()",
    ),
    automation.indexOf(
      "func testNavigationProcessRestorationOnPhysicalDevice()",
    ),
  );
  const productSequence = [
    'staticTexts["Solid Native product authentication"]',
    'buttons["Authenticate composed native flow"]',
    'links["Open nested settings detail"]',
    'staticTexts["Nested settings sheet loading"]',
    'buttons["Interrupt nested settings load with sheet"]',
    'staticTexts["Solid Native nested settings sheet"]',
    'staticTexts["Native tabs sheet interruption causality verified"]',
    'navigationBars["Nested settings sheet"]',
    'buttons["solid-native-home-tab"]',
    'navigationBars["Nested settings detail"]',
    'buttons["Dispose native tabs proof"]',
    "application.terminate()",
    '"Solid Native restored protected session"',
    'buttons["Clear restored session and dispose"]',
  ];
  let productOffset = -1;
  for (const proof of productSequence) {
    const nextOffset = productAutomation.indexOf(proof, productOffset + 1);
    assert.ok(nextOffset > productOffset, `${proof} is out of order`);
    productOffset = nextOffset;
  }
  assert.match(productAutomation, /Denied product route mounted[\s\S]*exists/u);
  assert.match(
    application,
    /platformServices\.platform === "ios" \? 8_000 : 500/u,
  );
  assert.match(
    application,
    /settingsSheetLoaderRuns\+\+[\s\S]*delay\(75\)[\s\S]*setProductInterruptionCausalSettlementReady\(true\)[\s\S]*await app\.root\.flush\(\)/u,
  );
});
