import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("does not deadlock multiline input readiness on a pre-input size event", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  const readyCommit = source.indexOf(
    "const multilineReadyUpdate = await app.root.flush();",
  );
  const inputEvidence = source.indexOf(
    "multilineInitialContentSizeObserved,\n        multilineTextInputValueObserved,",
  );
  assert.ok(readyCommit >= 0, "The multiline readiness commit is missing.");
  assert.ok(
    inputEvidence > readyCommit,
    "The proof waits for input-driven size evidence before exposing readiness.",
  );
  assert.match(
    source,
    /multilineContentSizeEventCount\+\+[\s\S]*Math\.min\([\s\S]*Math\.max\([\s\S]*multilineMaximumContentHeight >[\s\S]*multilineMinimumContentHeight \+ 0\.5/u,
  );
});

test("waits for a laid-out Android resource gate before injecting touch", async () => {
  const source = await readFile(
    new URL(
      "../android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativePhysicalTest.kt",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    source,
    /SCREEN_FOCUSED_TEXT && hasNonEmptyBounds\(it\)[\s\S]*RESOURCE_PROOF_START_LABEL &&[\s\S]*it\.isClickable &&[\s\S]*hasNonEmptyBounds\(it\)/u,
  );
  assert.match(
    source,
    /private fun hasNonEmptyBounds\(node: AccessibilityNodeInfo\): Boolean \{[\s\S]*node\.getBoundsInScreen\(bounds\)[\s\S]*return !bounds\.isEmpty/u,
  );
});

test("fails unless physical text input preserves its private causal chain", async () => {
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
  const iosTest = await readFile(
    new URL(
      "../ios/SolidNativeE2EUITests/SolidNativeE2EUITests.swift",
      import.meta.url,
    ),
    "utf8",
  );
  const iosRunner = await readFile(
    new URL("../scripts/ios-test.sh", import.meta.url),
    "utf8",
  );
  const iosKeyboardSource = await readFile(
    new URL("../keyboard.tsx", import.meta.url),
    "utf8",
  );
  const keyboardScrollSource = await readFile(
    new URL("../keyboard-scroll.tsx", import.meta.url),
    "utf8",
  );
  const androidKeyboardTest = await readFile(
    new URL(
      "../android/app/src/androidTest/java/dev/solidnative/e2e/SolidNativeKeyboardPhysicalTest.kt",
      import.meta.url,
    ),
    "utf8",
  );
  const androidKeyboardRunner = await readFile(
    new URL("../scripts/android-keyboard-test.sh", import.meta.url),
    "utf8",
  );
  const iosKeyboardTest = await readFile(
    new URL(
      "../ios/SolidNativeE2EUITests/SolidNativeKeyboardUITests.swift",
      import.meta.url,
    ),
    "utf8",
  );
  const iosKeyboardRunner = await readFile(
    new URL("../scripts/ios-keyboard-test.sh", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const TEXT_INPUT_VALUE_COMPUTATION_NAME = "input\.text\.value\.output"/u,
  );
  assert.match(
    source,
    /<CausalComputation name=\{TEXT_INPUT_VALUE_COMPUTATION_NAME\}>[\s\S]*?<TextInput[\s\S]*?solid-native-text-input-value[\s\S]*?<\/CausalComputation>/u,
  );
  assert.match(
    source,
    /verifyTextInputValueCausality\([\s\S]*textInputTelemetryStart,[\s\S]*textInputChangeCount,[\s\S]*textInputUpdate\.hostRevision/u,
  );
  assert.match(
    source,
    /causalEvents\.length >= eventCount[\s\S]*new Set\(causalEvents\.map[\s\S]*"changeText"[\s\S]*"discrete"[\s\S]*"event\.handler_count"\] === 1/u,
  );
  assert.match(
    source,
    /!JSON\.stringify\(interactionRecords\)\.includes\(TEXT_INPUT_VALUE\)[\s\S]*SOLID_NATIVE_TEXTINPUT_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    source,
    /verifyTextInputSelectionCommandCausality\([\s\S]*"setTextAndSelection"[\s\S]*TEXT_INPUT_VALUE_COMPUTATION_NAME[\s\S]*"commit\.mutation\.command"\] === 1/u,
  );
  assert.match(
    source,
    /selectionCommandTelemetryStart = telemetryRecords\.length[\s\S]*verifyTextInputSelectionCommandCausality\([\s\S]*SOLID_NATIVE_TEXTINPUT_SELECTION_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    source,
    /verifyTextInputSelectionInsertionCausality\([\s\S]*"changeText"[\s\S]*"selectionChange"[\s\S]*causedEvents\.every\(\(record\) => changeEvents\.includes\(record\)\)/u,
  );
  assert.match(
    source,
    /selectionInsertionTelemetryStart = telemetryRecords\.length[\s\S]*verifyTextInputSelectionInsertionCausality\([\s\S]*SOLID_NATIVE_TEXTINPUT_SELECTION_INSERTION_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    source,
    /TEXT_INPUT_SUBMIT_COMPUTATION_NAME = "input\.text\.submit\.output"[\s\S]*verifyTextInputSubmitCausality\([\s\S]*"submitEditing"[\s\S]*"blur"[\s\S]*"user-blocking"/u,
  );
  assert.match(
    source,
    /submitTelemetryStart = telemetryRecords\.length[\s\S]*SOLID_NATIVE_TEXTINPUT_SUBMIT_CAUSALITY_SUCCEEDED[\s\S]*<CausalComputation name=\{TEXT_INPUT_SUBMIT_COMPUTATION_NAME\}>[\s\S]*solid-native-text-input-submit/u,
  );
  assert.match(
    source,
    /submitTelemetryStart = telemetryRecords\.length[\s\S]*setTextInputSubmitStatus\(TEXT_INPUT_SUBMIT_READY_TEXT\)[\s\S]*waitForMount\(mountEvents, submitSequenceBeforeInput\)[\s\S]*textInputSubmitObserved/u,
  );
  assert.match(
    iosTest,
    /selectionObserved[\s\S]*solid-native-text-input-submit[\s\S]*Native TextInput ready for submit[\s\S]*textInput\.typeText\("\\n"\)/u,
  );
  assert.match(source, /createKeyboard\(NativePlatform\)/u);
  assert.match(
    source,
    /platform\.keyboard\.visibility[\s\S]*SOLID_NATIVE_KEYBOARD_STATE_SUCCEEDED/u,
  );
  assert.match(
    androidTest,
    /tapCenter\(textInput\)[\s\S]*waitForImeVisibility\(activity, true\)[\s\S]*KEYCODE_ENTER[\s\S]*waitForImeVisibility\(activity, false\)/u,
  );
  assert.match(
    iosTest,
    /textInput\.tap\(\)[\s\S]*application\.keyboards\.firstMatch[\s\S]*softwareKeyboard\.waitForExistence[\s\S]*textInput\.typeText\("\\n"\)[\s\S]*evaluatedWith: softwareKeyboard/u,
  );
  assert.match(iosRunner, /SOLID_NATIVE_KEYBOARD_STATE_SUCCEEDED/u);
  assert.match(
    iosKeyboardSource,
    /createKeyboard\([\s\S]*state\.metrics\.width <= 0[\s\S]*state\.metrics\.height <= 0[\s\S]*platform\.keyboard\.visibility[\s\S]*SOLID_NATIVE_KEYBOARD_STATE_SUCCEEDED/u,
  );
  assert.match(
    iosTest,
    /testSoftwareKeyboardOnPhysicalDevice\(\)[\s\S]*solid-native-keyboard-input[\s\S]*application\.keyboards\.firstMatch[\s\S]*textInput\.typeText\("\\n"\)[\s\S]*Dispose Solid Native keyboard proof/u,
  );
  assert.match(
    iosKeyboardRunner,
    /ENTRY_FILE=keyboard\.tsx[\s\S]*testSoftwareKeyboardAvoidanceOnPhysicalDevice[\s\S]*SOLID_NATIVE_KEYBOARD_AVOIDANCE_APPLIED[\s\S]*SOLID_NATIVE_KEYBOARD_AVOIDANCE_CLEARED[\s\S]*SOLID_NATIVE_KEYBOARD_AVOIDANCE_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_KEYBOARD_TEARDOWN_SUCCEEDED/u,
  );
  assert.match(
    iosKeyboardTest,
    /initialAnchorY[\s\S]*softwareKeyboard\.waitForExistence[\s\S]*initialAnchorY - 20[\s\S]*softwareKeyboard\.frame\.minY[\s\S]*abs\(\$0\.minY - initialAnchorY\) <= 3/u,
  );
  assert.match(
    androidKeyboardTest,
    /SOFT_INPUT_ADJUST_NOTHING[\s\S]*waitForImeVisibility\(activity, true\)[\s\S]*minimumMovementPixels[\s\S]*movedBounds\.bottom <= imeTop[\s\S]*KEYCODE_ENTER[\s\S]*waitForImeVisibility\(activity, false\)[\s\S]*restorationTolerancePixels/u,
  );
  assert.match(
    androidKeyboardTest,
    /activateAccessibilityNode\(dispose, "keyboard teardown"\)[\s\S]*node\.isVisibleToUser[\s\S]*AccessibilityNodeInfo\.ACTION_CLICK/u,
  );
  assert.match(
    androidKeyboardRunner,
    /entry_file=keyboard\.tsx[\s\S]*test_method=testSoftwareKeyboardAvoidanceOnPhysicalDevice[\s\S]*SOLID_NATIVE_KEYBOARD_AVOIDANCE_APPLIED[\s\S]*SOLID_NATIVE_KEYBOARD_AVOIDANCE_CLEARED[\s\S]*SOLID_NATIVE_KEYBOARD_AVOIDANCE_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_KEYBOARD_TEARDOWN_SUCCEEDED[\s\S]*test_class=dev\.solidnative\.e2e\.SolidNativeKeyboardPhysicalTest#\$test_method[\s\S]*ENTRY_FILE="\$entry_file"[\s\S]*marker_deadline=.*date \+%s/u,
  );
  assert.match(
    iosKeyboardSource,
    /keyboard\.avoidance\.measurement[\s\S]*solid-native\.measure[\s\S]*solid-native\.commit[\s\S]*<KeyboardAvoidingView[\s\S]*onAvoidanceChange[\s\S]*SOLID_NATIVE_KEYBOARD_AVOIDANCE_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    keyboardScrollSource,
    /keyboard\.focus\.visibility[\s\S]*solid-native\.measure[\s\S]*solid-native\.command[\s\S]*input\.focus\.traversal[\s\S]*<KeyboardAwareScrollView[\s\S]*<TextInputFocusGroup[\s\S]*SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SUCCEEDED[\s\S]*SOLID_NATIVE_KEYBOARD_SCROLL_CAUSALITY_SUCCEEDED/u,
  );
  assert.match(
    iosKeyboardTest,
    /testFocusedFieldScrollOnPhysicalDevice[\s\S]*initialInputY[\s\S]*softwareKeyboard\.waitForExistence[\s\S]*initialInputY - 20[\s\S]*firstInput\.typeText\("\\n"\)[\s\S]*Solid Native next field focused above keyboard[\s\S]*softwareKeyboard\.frame\.minY - 15[\s\S]*secondInput\.typeText\("SolidNativeSecond42"\)[\s\S]*Solid Native focus traversal submit and hide observed/u,
  );
  assert.match(
    androidKeyboardTest,
    /testFocusedFieldScrollOnPhysicalDevice[\s\S]*SOFT_INPUT_ADJUST_NOTHING[\s\S]*initialBounds[\s\S]*minimumMovementPixels[\s\S]*movedBounds\.bottom <= imeTop -[\s\S]*SolidNativeFirst42[\s\S]*SCROLL_TRAVERSED_TEXT[\s\S]*SCROLL_SECOND_INPUT_LABEL && it\.isFocused[\s\S]*SolidNativeSecond42[\s\S]*SCROLL_SUCCEEDED_TEXT/u,
  );
  assert.match(
    iosKeyboardRunner,
    /focused-scroll\)[\s\S]*ENTRY_FILE=keyboard-scroll\.tsx[\s\S]*testFocusedFieldScrollOnPhysicalDevice[\s\S]*SOLID_NATIVE_KEYBOARD_FOCUS_VISIBILITY_APPLIED[\s\S]*SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SCROLL_APPLIED[\s\S]*SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SUCCEEDED[\s\S]*SOLID_NATIVE_KEYBOARD_SCROLL_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_KEYBOARD_SCROLL_TEARDOWN_SUCCEEDED/u,
  );
  assert.match(
    androidKeyboardRunner,
    /focused-scroll\)[\s\S]*entry_file=keyboard-scroll\.tsx[\s\S]*test_method=testFocusedFieldScrollOnPhysicalDevice[\s\S]*SOLID_NATIVE_KEYBOARD_FOCUS_VISIBILITY_APPLIED[\s\S]*SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SCROLL_APPLIED[\s\S]*SOLID_NATIVE_KEYBOARD_FOCUS_TRAVERSAL_SUCCEEDED[\s\S]*SOLID_NATIVE_KEYBOARD_SCROLL_CAUSALITY_SUCCEEDED[\s\S]*SOLID_NATIVE_KEYBOARD_SCROLL_TEARDOWN_SUCCEEDED/u,
  );
  assert.match(
    source,
    /MULTILINE_TEXT_INPUT_COMPUTATION_NAME = "input\.multiline\.value\.output"[\s\S]*verifyMultilineTextInputCausality\([\s\S]*"changeText"[\s\S]*"keyPress"[\s\S]*"contentSizeChange"/u,
  );
  assert.match(
    source,
    /causedEvents\.length <= changeEvents\.length[\s\S]*causedEvents\.every\(\(record\) => changeEvents\.includes\(record\)\)[\s\S]*!JSON\.stringify\(interactionRecords\)\.includes\(MULTILINE_TEXT_INPUT_VALUE\)/u,
  );
  assert.match(
    source,
    /sizeObservedSequence === observedSequence[\s\S]*sizeObservedSequence === commitSequence[\s\S]*!commitCauseIds\.includes\(record\.operationId\)/u,
  );
  assert.match(
    source,
    /multilineTelemetryStart = telemetryRecords\.length[\s\S]*SOLID_NATIVE_TEXTINPUT_MULTILINE_CAUSALITY_SUCCEEDED[\s\S]*name=\{MULTILINE_TEXT_INPUT_COMPUTATION_NAME\}[\s\S]*solid-native-multiline-text-input-value/u,
  );
});

test("fails unless the physical controlled Switch preserves command causality", async () => {
  const source = await readFile(
    new URL("../index.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /SWITCH_CONTROLLED_COMPUTATION_NAME = "input\.switch\.controlled\.output"[\s\S]*verifySwitchControlledCommandCausality/u,
  );
  assert.match(
    source,
    /"valueChange"[\s\S]*"setValue"[\s\S]*commandStarted\.causes\.includes\(eventStarted\.operationId\)[\s\S]*commandStarted\.causes\.includes\(computationStarted\.operationId\)/u,
  );
  assert.match(
    source,
    /PERMITTED_NATIVE_EVENT_START_ATTRIBUTES\.has\(name\)[\s\S]*name\.startsWith\("resource\."\)[\s\S]*PERMITTED_NATIVE_COMMAND_START_ATTRIBUTES\.has\(name\)[\s\S]*"user-blocking"[\s\S]*"commit\.mutation\.command"\] === 1/u,
  );
  assert.match(
    source,
    /switchTelemetryStart = telemetryRecords\.length[\s\S]*verifySwitchControlledCommandCausality\([\s\S]*SOLID_NATIVE_SWITCH_CAUSALITY_SUCCEEDED[\s\S]*name=\{SWITCH_CONTROLLED_COMPUTATION_NAME\}/u,
  );
  assert.match(
    source,
    /PERMITTED_MEASUREMENT_FINISH_ATTRIBUTES[\s\S]*switchMeasurementTelemetryStart = telemetryRecords\.length[\s\S]*switchTarget\.measure\(\)[\s\S]*verifySwitchMeasurementCausality\(/u,
  );
});
