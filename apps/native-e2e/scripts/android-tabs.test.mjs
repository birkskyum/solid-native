import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("../", import.meta.url);

test("physical Android tabs compose a nested stack and sheet without ownership drift", async () => {
  const [application, instrumentation, runner, manifest] = await Promise.all([
    readFile(new URL("tabs.tsx", directory), "utf8"),
    readFile(
      new URL(
        "android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePhysicalTest.kt",
        directory,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/android-tabs-test.sh", directory), "utf8"),
    readFile(new URL("package.json", directory), "utf8").then(JSON.parse),
  ]);

  assert.match(application, /PRODUCT_COMPOSITION_URL/u);
  assert.match(
    application,
    /throw tanStackRedirect\(\{ to: "\/login", replace: true \}\)/u,
  );
  assert.match(application, /path: "\/slow-sheet"/u);
  assert.match(application, /path: "\/sheet"/u);
  assert.match(
    application,
    /entry\.href === "\/sheet"[\s\S]*presentation: "sheet"[\s\S]*sheetAllowedDetents: \[0\.58, 0\.92\]/u,
  );
  assert.match(application, /SOLID_NATIVE_TABS_PRODUCT_COMPOSITION_SUCCEEDED/u);
  assert.match(application, /<TanStackNativeLink/u);
  assert.match(application, /await app\.root\.flushMounted\(\)/u);
  assert.match(
    application,
    /SOLID_NATIVE_TABS_PRODUCT_LINK_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(application, /commits\.length < 2/u);
  assert.match(application, /"resource\.runtime\.host_contract_version"/u);
  assert.match(
    application,
    /SOLID_NATIVE_TABS_PRODUCT_AUTH_REDIRECT_SUCCEEDED/u,
  );
  assert.match(
    application,
    /SOLID_NATIVE_TABS_PRODUCT_INTERRUPTION_SUCCEEDED/u,
  );
  assert.match(application, /createReactNativeSecureStorage/u);
  assert.match(application, /createSecureStorageController/u);
  assert.match(
    application,
    /secureStorage[\s\S]*?\.setItem\(PRODUCT_SESSION_KEY, PRODUCT_SESSION_PROOF\)[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_STORED/u,
  );
  assert.match(
    application,
    /secureStorage[\s\S]*\.getItem\(PRODUCT_SESSION_KEY\)[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORED/u,
  );
  assert.match(
    application,
    /secureStorage[\s\S]*\.removeItem\(PRODUCT_SESSION_KEY\)[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_CLEARED/u,
  );
  assert.match(
    application,
    /taskFinish\(displacedTask\.operationId\)\?\.status !==\s+"cancelled"/u,
  );
  assert.match(
    application,
    /nestedSheetCreations !== expectedNestedSheetCount[\s\S]*nestedSheetDisposals !== expectedNestedSheetCount[\s\S]*settingsSheetLoaderRuns !== expectedNestedSheetCount/u,
  );

  const productMethodStart = instrumentation.indexOf(
    "private fun testSolidNativeTabsProductComposition()",
  );
  const productRestoreMethodStart = instrumentation.indexOf(
    "private fun testSolidNativeTabsProductSessionRestore()",
  );
  assert.ok(
    productMethodStart >= 0 && productMethodStart < productRestoreMethodStart,
  );
  const productMethod = instrumentation.slice(
    productMethodStart,
    productRestoreMethodStart,
  );
  assert.match(productMethod, /waitForLoadedNativeTabsBottomNavigation/u);
  assert.match(productMethod, /NATIVE_TABS_PRODUCT_LOGIN_LABEL/u);
  assert.match(productMethod, /NATIVE_TABS_NESTED_SHEET_INTERRUPT_LABEL/u);
  assert.match(productMethod, /waitForNativeTabsScreenStack/u);
  assert.match(
    productMethod,
    /waitForNavigationProcessScreens\(activity, 3\)/u,
  );
  assert.match(
    productMethod,
    /sheetScreens\.any \{ it === rootScreen \} && sheetScreens\.any \{ it === detailScreen \}/u,
  );
  assert.equal(
    [...productMethod.matchAll(/AccessibilityService\.GLOBAL_ACTION_BACK/gu)]
      .length,
    2,
  );
  assert.match(
    productMethod,
    /waitForNavigationProcessScreens\(activity, 1\)\.single\(\) === rootScreen/u,
  );
  const coldMethodStart = instrumentation.indexOf(
    "private fun testSolidNativeTabsColdLink()",
  );
  const productRestoreMethod = instrumentation.slice(
    productRestoreMethodStart,
    coldMethodStart,
  );
  assert.match(
    productRestoreMethod,
    /NATIVE_TABS_PRODUCT_SESSION_RESTORE_URL/u,
  );
  assert.match(
    productRestoreMethod,
    /NATIVE_TABS_PRODUCT_SESSION_RESTORED_CONTENT/u,
  );
  assert.match(
    productRestoreMethod,
    /NATIVE_TABS_PRODUCT_SESSION_CLEAR_LABEL/u,
  );

  const restore = runner.indexOf("run_phase restore");
  const product = runner.indexOf("run_phase product");
  const productRestore = runner.indexOf("run_phase product-restore");
  const cold = runner.indexOf("run_phase cold");
  assert.ok(
    restore >= 0 &&
      restore < product &&
      product < productRestore &&
      productRestore < cold,
  );
  assert.match(
    runner.slice(product, productRestore),
    /SOLID_NATIVE_TABS_PRODUCT_AUTH_REDIRECT_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_STORED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_COMPOSITION_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_LINK_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_INTERRUPTION_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PLATFORM_BACK_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_SELECTION_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED/u,
  );
  assert.match(
    runner.slice(productRestore, cold),
    /SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORE_SUCCEEDED[\s\S]*SOLID_NATIVE_TABS_PRODUCT_SESSION_CLEARED[\s\S]*SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED/u,
  );
  assert.match(
    runner,
    /tabs\/stack\/sheet product composition \(\$product_pid\)/u,
  );
  assert.equal(
    manifest.scripts["android:tabs:test"],
    "sh scripts/android-tabs-test.sh",
  );
  assert.match(runner, /verify-solid-runtime-sourcemap\.mjs/u);
  assert.match(runner, /verify-navigation-sourcemap\.mjs[\s\S]*tabs\.tsx/u);
  assert.ok(
    runner.indexOf("verify-navigation-sourcemap.mjs") <
      runner.indexOf('install -r "$app_apk"'),
  );
});
