import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fails unless AppState preserves its platform event through the visible frame", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /APP_STATE_EVENT_NAME = "platform\.app-state\.change"[\s\S]*APP_STATE_COMPUTATION_NAME = "platform\.app-state\.output"/u,
  );
  assert.match(
    source,
    /async function verifyAppStateCausality[\s\S]*event\.source[\s\S]*PERMITTED_PLATFORM_EVENT_START_ATTRIBUTES[\s\S]*commitStarted\.causes\.length === 3[\s\S]*commit\.mutation\.update-text[\s\S]*solid-native\.mount[\s\S]*solid-native\.frame/u,
  );
  assert.match(
    source,
    /didObserveAppState = true;[\s\S]*setStatus\(LIFECYCLE_READY_TEXT\)[\s\S]*completeAppStateProof/u,
  );
  assert.match(
    source,
    /verifyAppStateCausality[\s\S]*SOLID_NATIVE_APP_STATE_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_TURBOMODULE_EVENT_SUCCEEDED/u,
  );
  assert.match(
    source,
    /<CausalComputation name=\{APP_STATE_COMPUTATION_NAME\}>[\s\S]*solid-native-status[\s\S]*status\(\)[\s\S]*<\/CausalComputation>/u,
  );
});
