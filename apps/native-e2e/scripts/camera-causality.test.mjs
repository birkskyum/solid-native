import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fails unless physical camera capture preserves its complete causal chain", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /CAMERA_CAPTURE_TASK_NAME = "camera\.capture"[\s\S]*CAMERA_CAPTURE_COMPUTATION_NAME = "camera\.capture\.output"/u,
  );
  assert.match(
    source,
    /async function verifyCameraOutputCausality[\s\S]*solid-native\.surface[\s\S]*PERMITTED_NATIVE_TASK_START_ATTRIBUTES[\s\S]*commitStarted\.causes\.length === 3[\s\S]*commit\.host_revision[\s\S]*solid-native\.mount[\s\S]*solid-native\.frame/u,
  );
  assert.match(
    source,
    /createCausalScope\(\s*CAMERA_CAPTURE_TASK_NAME,?\s*\)[\s\S]*cameraSession\.capturePhoto[\s\S]*appStateProofArmed = true;[\s\S]*cameraCaptureScope\.run[\s\S]*cameraCaptureScope\.finish\(\)[\s\S]*verifyCameraOutputCausality[\s\S]*CAMERA_CAPTURE_COMPUTATION_NAME[\s\S]*cameraCaptureScope\.fail\(error\)[\s\S]*SOLID_NATIVE_CAMERA_CAPTURE_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    source,
    /<CausalComputation name=\{CAMERA_CAPTURE_COMPUTATION_NAME\}>[\s\S]*cameraCaptureStatus\(\)/u,
  );
});

test("fails unless owner-bound camera preview settlement stays causal", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /CAMERA_PREVIEW_TASK_NAME = "camera\.session\.preview"[\s\S]*CAMERA_PREVIEW_COMPUTATION_NAME = "camera\.preview\.output"/u,
  );
  assert.match(
    source,
    /createCausalScope\(\s*CAMERA_PREVIEW_TASK_NAME,?\s*\)[\s\S]*cameraPreviewScope\.run\(\(\) => setCameraSessionRequested\(true\)\)[\s\S]*cameraSessionOwner\.ready[\s\S]*cameraPreviewScope\.run\(\(\) => setCameraPreviewSession\(session\)\)[\s\S]*cameraPreviewScope\.finish\(\)[\s\S]*verifyCameraOutputCausality[\s\S]*CAMERA_PREVIEW_COMPUTATION_NAME[\s\S]*cameraPreviewScope\.fail\(error\)[\s\S]*SOLID_NATIVE_CAMERA_PREVIEW_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    source,
    /<CausalComputation name=\{CAMERA_PREVIEW_COMPUTATION_NAME\}>[\s\S]*renderCameraPreview\(\)/u,
  );
});

test("fails unless a real camera session event enters the platform causal protocol", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );
  const androidTest = await readFile(
    new URL(
      "../android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePhysicalTest.kt",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    source,
    /createCameraSessionEvent\(\s*cameraPreviewSession,[\s\S]*event\?\.kind !== "started"[\s\S]*setCameraSessionStatus\(CAMERA_SESSION_STARTED_TEXT\)/u,
  );
  assert.match(
    source,
    /<CausalComputation name=\{CAMERA_SESSION_COMPUTATION_NAME\}>[\s\S]*solid-native-camera-session-status/u,
  );
  assert.match(
    source,
    /cameraSessionStartedObserved[\s\S]*verifyPlatformEventCausality\([\s\S]*"platform\.camera\.session\.started"[\s\S]*CAMERA_SESSION_COMPUTATION_NAME[\s\S]*SOLID_NATIVE_CAMERA_SESSION_EVENT_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    androidTest,
    /waitForStreamingCameraPreview[\s\S]*CAMERA_SESSION_STARTED_TEXT[\s\S]*CAMERA_CAPTURE_TEXT/u,
  );
});
