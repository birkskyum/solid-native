import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fails unless the physical Modal preserves its complete causal lifecycle", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /MODAL_LIFECYCLE_COMPUTATION_NAME = "modal\.lifecycle\.output"[\s\S]*createSignal\(MODAL_PENDING_TEXT\)/u,
  );
  assert.match(
    source,
    /handleModalPresentationPress[\s\S]*event\.name === "press"[\s\S]*setModalHandoffReady\(false\)[\s\S]*setModalVisible\(true\)[\s\S]*resolveModalPresentationRequest/u,
  );
  assert.match(
    source,
    /async function verifyModalLifecycleCausality\([\s\S]*MODAL_LIFECYCLE_COMPUTATION_NAME/u,
  );
  assert.match(
    source,
    /PERMITTED_NATIVE_EVENT_START_ATTRIBUTES\.has\(name\)[\s\S]*commitStarted\.causes\.includes\(ownerStarted\.operationId\)/u,
  );
  assert.match(
    source,
    /await waitForMount\(mountEvents, sequence\)[\s\S]*await waitForFrame\(frameEvents, sequence\)/u,
  );
  assert.match(
    source,
    /modalTelemetryStart = telemetryRecords\.length[\s\S]*"press"[\s\S]*"discrete"[\s\S]*"user-blocking"[\s\S]*"show"[\s\S]*"default"[\s\S]*"normal"[\s\S]*SOLID_NATIVE_MODAL_SHOW_SUCCEEDED[\s\S]*"requestClose"[\s\S]*SOLID_NATIVE_MODAL_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_MODAL_DISMISS_SUCCEEDED/u,
  );
  assert.match(
    source,
    /nativePlatform === "ios"[\s\S]*modalDismissalRequested[\s\S]*app\.root\.flush\(\)[\s\S]*modalDismissalRequestObservedSequence[\s\S]*modalDismissEventObserved[\s\S]*modalDismissObservedSequence[\s\S]*interactions: 4/u,
  );
  assert.match(
    source,
    /<CausalComputation name=\{MODAL_LIFECYCLE_COMPUTATION_NAME\}>[\s\S]*<Modal[\s\S]*onShow=\{handleModalShow\}[\s\S]*onRequestClose=\{handleModalRequestClose\}[\s\S]*solid-native-modal-status[\s\S]*<\/Modal>[\s\S]*<\/CausalComputation>/u,
  );
});
