import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fails the physical navigation proof unless every focus chain is causal", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const NAVIGATION_FOCUS_COMPUTATION_NAME = "navigation\.focus\.output"/u,
  );
  assert.equal(
    source.match(
      /<CausalComputation name=\{NAVIGATION_FOCUS_COMPUTATION_NAME\}>/gu,
    )?.length,
    3,
  );
  assert.equal(
    source.match(/verifyNavigationFocusCausality\(\s+telemetryRecords,/gu)
      ?.length,
    3,
  );
  assert.equal(
    source.match(
      /await waitForFrame\(frameEvents, (?:push|pop|deepLink)FocusUpdate\.sequence\)/gu,
    )?.length,
    3,
  );
  assert.match(
    source,
    /validatedNavigationCausalInteractions === 3[\s\S]*SOLID_NATIVE_NAVIGATION_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    source,
    /causalLifecycleEvents\.every\([\s\S]*"focus"[\s\S]*"blur"[\s\S]*lifecycleSequences\.has/u,
  );
  assert.match(
    source,
    /"event\.observed_sequence"[\s\S]*focusedLifecycle\.observedSequence &&[\s\S]*"event\.name"\] === focusedLifecycle\.name/u,
  );
  assert.match(
    source,
    /mountStarted\.causes\[0\] === commitStarted\.operationId[\s\S]*frameStarted\.causes\[0\] === mountStarted\.operationId/u,
  );
});

test("fails unless hardware Back and live URLs preserve their platform causes", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );
  const navigationSource = await readFile(
    new URL("../../../packages/navigation/src/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    navigationSource,
    /function settleHardwareBack[\s\S]*retention\?\.state === "active" \? retention\.run\(callback\)[\s\S]*retention\.finish\(\)[\s\S]*retention\.fail\(error\)/u,
  );
  assert.match(
    navigationSource,
    /function createCausalHardwareBackHandler[\s\S]*retainCausalPlatformEvent\(true[\s\S]*settleHardwareBack\(result, options, event\)/u,
  );

  assert.match(
    source,
    /async function verifyPlatformEventCausality[\s\S]*event\.source[\s\S]*PERMITTED_PLATFORM_EVENT_START_ATTRIBUTES[\s\S]*computationName === undefined \? 2 : 3[\s\S]*solid-native\.mount[\s\S]*solid-native\.frame/u,
  );
  assert.match(
    source,
    /verifyPlatformEventCausality\([\s\S]*"platform\.hardware-back\.press"[\s\S]*"user-blocking"[\s\S]*SOLID_NATIVE_NAVIGATION_BACK_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    source,
    /async function verifyNativeDismissCausality[\s\S]*"dismiss"[\s\S]*PERMITTED_NATIVE_EVENT_START_ATTRIBUTES[\s\S]*"normal"[\s\S]*solid-native\.mount[\s\S]*solid-native\.frame/u,
  );
  assert.match(
    source,
    /binding\.platform === "ios"[\s\S]*verifyNativeDismissCausality\([\s\S]*verifyPlatformEventCausality\([\s\S]*"platform\.hardware-back\.press"/u,
  );
  assert.match(
    source,
    /verifyPlatformEventCausality\([\s\S]*"platform\.url\.open"[\s\S]*NAVIGATION_FOCUS_COMPUTATION_NAME[\s\S]*DEEP_LINK_URL[\s\S]*SOLID_NATIVE_DEEP_LINK_CAUSALITY_SUCCEEDED/u,
  );
});
