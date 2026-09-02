import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fails unless ScrollView and Image preserve their asynchronous native causes", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /IMAGE_LOAD_TASK_NAME = "media\.image\.load\.settlement"[\s\S]*SCROLL_EVENT_TASK_NAME = "input\.scroll\.event\.settlement"/u,
  );
  assert.match(
    source,
    /handleScroll[\s\S]*createCausalScope\(SCROLL_EVENT_TASK_NAME\)[\s\S]*resolveScrollEvent/u,
  );
  assert.match(
    source,
    /handleImageLoad[\s\S]*createCausalScope\(IMAGE_LOAD_TASK_NAME\)[\s\S]*resolveImageEvent/u,
  );
  assert.match(
    source,
    /imageScope\.run\(\(\) => setImageStatus\(IMAGE_READY_TEXT\)\)[\s\S]*scrollScope\.run\(\(\) => setScrollStatus\(SCROLL_READY_TEXT\)\)[\s\S]*app\.root\.flush\(\)/u,
  );
  assert.match(
    source,
    /verifyScrollImageCausality[\s\S]*PERMITTED_NATIVE_COMMAND_START_ATTRIBUTES[\s\S]*PERMITTED_NATIVE_EVENT_START_ATTRIBUTES[\s\S]*PERMITTED_NATIVE_TASK_START_ATTRIBUTES[\s\S]*statusCommit\.causes\.length === 5[\s\S]*waitForFrame/u,
  );
  assert.match(
    source,
    /SOLID_NATIVE_SCROLL_IMAGE_CAUSALITY_SUCCEEDED[\s\S]*nativeEvents: 2[\s\S]*taskScopes: 2/u,
  );
  assert.match(
    source,
    /<CausalComputation name=\{IMAGE_STATUS_COMPUTATION_NAME\}>[\s\S]*imageStatus\(\)[\s\S]*<CausalComputation name=\{SCROLL_STATUS_COMPUTATION_NAME\}>[\s\S]*scrollStatus\(\)[\s\S]*<CausalComputation name=\{SCROLL_VIEW_COMPUTATION_NAME\}>[\s\S]*<ScrollView/u,
  );
});
