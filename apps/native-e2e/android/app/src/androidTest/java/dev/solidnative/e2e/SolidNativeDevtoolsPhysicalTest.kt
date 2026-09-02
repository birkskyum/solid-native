package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SolidNativeDevtoolsPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testDevelopmentErrorOverlayRecoveryOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT)

    tapControl(OPEN_NETWORK_LABEL)
    waitForText(NETWORK_TITLE)
    tapControl(CLOSE_NETWORK_LABEL)
    waitForText(READY_TEXT)
    tapControl(OPEN_NETWORK_LABEL)
    waitForText(NETWORK_TITLE)
    tapControl(CLOSE_NETWORK_LABEL)
    waitForText(READY_TEXT)

    tapControl(OPEN_CAUSAL_LABEL)
    waitForText(CAUSAL_TITLE)
    tapControl(GROUP_CAUSAL_LABEL)
    setControlText(CAUSAL_FILTER_LABEL, CAUSAL_COMMIT_ID)
    waitForText(SINGLE_MATCHING_GROUP_TEXT)
    tapControl("$INSPECT_CAUSAL_GROUP_PREFIX($CAUSAL_GROUP_ID)")
    waitForText(SELECTED_TRACE_GROUP_TEXT)
    tapControl("$INSPECT_CAUSAL_PREFIX$CAUSAL_COMMIT_NAME ($CAUSAL_COMMIT_ID)")
    waitForText(SELECTED_OPERATION_TEXT)
    waitForText("$RETAINED_CAUSES_PREFIX (1)")
    waitForText("$RETAINED_EFFECTS_PREFIX (0)")
    tapControl("$INSPECT_CAUSAL_PREFIX$CAUSAL_EVENT_NAME ($CAUSAL_EVENT_ID)")
    waitForText("$RETAINED_CAUSES_PREFIX (0)")
    waitForText("$RETAINED_EFFECTS_PREFIX (1)")
    tapControl(BACK_TO_CAUSAL_GROUP_LABEL)
    waitForText(SELECTED_TRACE_GROUP_TEXT)
    tapControl(BACK_TO_CAUSAL_GROUPS_LABEL)
    waitForText(SINGLE_MATCHING_GROUP_TEXT)
    tapControl(CLEAR_CAUSAL_LABEL)
    waitForText(EMPTY_CAUSAL_TEXT)
    tapControl(CLOSE_CAUSAL_LABEL)
    waitForText(READY_TEXT)
    assertEquals(1, countNodes { it.text?.toString() == READY_TEXT })

    tapControl(OPEN_CAUSAL_LABEL)
    waitForText(CAUSAL_TITLE)
    tapControl(START_SOLID_CAPTURE_LABEL)
    waitForText(STOP_SOLID_CAPTURE_TEXT)
    tapControl(DIAGNOSTICS_BUTTON_LABEL)
    waitForText(DIAGNOSTICS_UPDATED_TEXT)
    tapControl(STOP_SOLID_CAPTURE_LABEL)
    waitForText(SOLID_CORRELATION_TITLE)
    waitForText(DIAGNOSTICS_CORRELATION_ROW)
    assertEquals(
        0,
        countNodes { it.text?.toString() == DIAGNOSTICS_COUNTER_NAME },
    )
    tapControl(CLOSE_CAUSAL_LABEL)
    waitForText(DIAGNOSTICS_UPDATED_TEXT)

    tapControl(ASYNC_BUTTON_LABEL)
    waitForText(ASYNC_ERROR_TEXT)
    waitForText("Source: async")
    tapControl(DISMISS_ERROR_LABEL)
    waitForText(ASYNC_RECOVERED_TEXT)
    assertEquals(1, countNodes { it.text?.toString() == ASYNC_RECOVERED_TEXT })

    tapControl(RUNTIME_BUTTON_LABEL)
    waitForText(RUNTIME_ERROR_TEXT)
    waitForText("Source: runtime")
    tapControl(DISMISS_ERROR_LABEL)
    waitForText(RUNTIME_RECOVERED_TEXT)
    assertEquals(1, countNodes { it.text?.toString() == RUNTIME_RECOVERED_TEXT })

    tapControl(RENDER_BUTTON_LABEL)
    waitForText(RENDER_ERROR_TEXT)
    waitForText("Source: render")
    tapControl(RETRY_ERROR_LABEL)
    waitForText(RENDER_RECOVERED_TEXT)
    assertEquals(1, countNodes { it.text?.toString() == RENDER_RECOVERED_TEXT })
    assertEquals(
        0,
        countNodes { it.contentDescription?.toString() == RETRY_ERROR_LABEL },
    )

    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == RENDER_RECOVERED_TEXT
    }
    waitForTeardownAcknowledgement()
    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during devtools teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during devtools teardown.", activity.isDestroyed)
    }
  }

  private fun launchApplication(): Activity {
    val launchIntent =
        checkNotNull(
            instrumentation.targetContext.packageManager.getLaunchIntentForPackage(APP_ID)
        )
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
    val activity = instrumentation.startActivitySync(launchIntent)
    instrumentation.waitForIdleSync()
    return activity
  }

  private fun tapControl(label: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == label
    }
    assertTrue("The development control $label was not clickable.", control.isClickable)
    tapCenter(control)
  }

  private fun setControlText(label: String, text: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == label
    }
    val arguments = Bundle()
    arguments.putCharSequence(
        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
        text,
    )
    assertTrue(
        "The development control $label did not accept native text input.",
        control.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments),
    )
  }

  private fun waitForText(text: String): AccessibilityNodeInfo =
      waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == text }

  private fun waitForNode(
      timeoutMilliseconds: Long,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ): AccessibilityNodeInfo {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      val found = findNode(instrumentation.uiAutomation.rootInActiveWindow, predicate)
      if (found != null) return found
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The expected native development-overlay accessibility node did not appear.\n" +
            describeAccessibilityTree(instrumentation.uiAutomation.rootInActiveWindow)
    )
    throw AssertionError("unreachable")
  }

  private fun describeAccessibilityTree(root: AccessibilityNodeInfo?): String {
    if (root == null) return "Accessibility tree: <unavailable>"
    val description = StringBuilder("Accessibility tree:")
    appendAccessibilityTree(description, root, 0)
    return description.toString()
  }

  private fun appendAccessibilityTree(
      description: StringBuilder,
      node: AccessibilityNodeInfo,
      depth: Int,
  ) {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    description
        .append('\n')
        .append("  ".repeat(depth))
        .append(node.className ?: "<unknown>")
        .append(" text=")
        .append(node.text ?: "<none>")
        .append(" label=")
        .append(node.contentDescription ?: "<none>")
        .append(" clickable=")
        .append(node.isClickable)
        .append(" focused=")
        .append(node.isFocused)
        .append(" bounds=")
        .append(bounds)
    for (index in 0 until node.childCount) {
      val child = node.getChild(index) ?: continue
      appendAccessibilityTree(description, child, depth + 1)
    }
  }

  private fun waitForNodeToDisappear(
      timeoutMilliseconds: Long,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ) {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      if (findNode(instrumentation.uiAutomation.rootInActiveWindow, predicate) == null) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The development overlay survived dismissal or teardown.")
  }

  private fun waitForTeardownAcknowledgement() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The development-overlay proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(BRIDGE_REMOVED_MARKER) && logs.contains(TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The development-overlay proof did not acknowledge bridge removal and terminal teardown.")
  }

  private fun readReactNativeJsLogs(): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              instrumentation.uiAutomation.executeShellCommand(
                  "logcat -d -v brief -s ReactNativeJS:I"
              )
          )
          .bufferedReader()
          .use { it.readText() }

  private fun countNodes(predicate: (AccessibilityNodeInfo) -> Boolean): Int =
      countNodes(instrumentation.uiAutomation.rootInActiveWindow, predicate)

  private fun countNodes(
      root: AccessibilityNodeInfo?,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ): Int {
    if (root == null) return 0
    var count = if (predicate(root)) 1 else 0
    for (index in 0 until root.childCount) {
      count += countNodes(root.getChild(index), predicate)
    }
    return count
  }

  private fun findNode(
      root: AccessibilityNodeInfo?,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ): AccessibilityNodeInfo? {
    if (root == null) return null
    if (predicate(root)) return root
    for (index in 0 until root.childCount) {
      val found = findNode(root.getChild(index), predicate)
      if (found != null) return found
    }
    return null
  }

  private fun tapCenter(node: AccessibilityNodeInfo) {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertFalse("The development overlay control had empty physical bounds.", bounds.isEmpty)
    val downTime = SystemClock.uptimeMillis()
    val down =
        MotionEvent.obtain(
            downTime,
            downTime,
            MotionEvent.ACTION_DOWN,
            bounds.exactCenterX(),
            bounds.exactCenterY(),
            0,
        )
    val up =
        MotionEvent.obtain(
            downTime,
            downTime + TAP_DURATION_MS,
            MotionEvent.ACTION_UP,
            bounds.exactCenterX(),
            bounds.exactCenterY(),
            0,
        )
    down.source = InputDevice.SOURCE_TOUCHSCREEN
    up.source = InputDevice.SOURCE_TOUCHSCREEN
    try {
      assertTrue(
          "The Android test runner did not inject touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android test runner did not inject touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native development overlay ready"
    private const val OPEN_NETWORK_LABEL = "Open network inspector (0 retained requests)"
    private const val CLOSE_NETWORK_LABEL = "Close network inspector"
    private const val NETWORK_TITLE = "Native network"
    private const val OPEN_CAUSAL_LABEL = "Open causal trace inspector"
    private const val START_SOLID_CAPTURE_LABEL = "Start Solid diagnostics capture"
    private const val STOP_SOLID_CAPTURE_LABEL = "Stop Solid diagnostics capture"
    private const val STOP_SOLID_CAPTURE_TEXT = "Stop Solid"
    private const val SOLID_CORRELATION_TITLE = "SOLID → NATIVE CORRELATION"
    private const val CAUSAL_FILTER_LABEL = "Filter causal operations"
    private const val GROUP_CAUSAL_LABEL = "Group causal operations"
    private const val CLOSE_CAUSAL_LABEL = "Close causal trace inspector"
    private const val BACK_TO_CAUSAL_GROUP_LABEL = "Back to causal trace group"
    private const val BACK_TO_CAUSAL_GROUPS_LABEL = "Back to causal trace groups"
    private const val CLEAR_CAUSAL_LABEL = "Clear causal trace"
    private const val INSPECT_CAUSAL_PREFIX = "Inspect causal operation "
    private const val INSPECT_CAUSAL_GROUP_PREFIX = "Inspect causal trace group "
    private const val CAUSAL_TITLE = "Causal trace"
    private const val CAUSAL_EVENT_NAME = "solid-native.event"
    private const val CAUSAL_EVENT_ID = "devtools-seed-event"
    private const val CAUSAL_GROUP_ID = CAUSAL_EVENT_ID
    private const val CAUSAL_COMMIT_NAME = "solid-native.commit"
    private const val CAUSAL_COMMIT_ID = "devtools-seed-commit"
    private const val SELECTED_OPERATION_TEXT = "SELECTED OPERATION"
    private const val SELECTED_TRACE_GROUP_TEXT = "SELECTED TRACE GROUP"
    private const val RETAINED_CAUSES_PREFIX = "RETAINED CAUSES"
    private const val RETAINED_EFFECTS_PREFIX = "RETAINED EFFECTS"
    private const val EMPTY_CAUSAL_TEXT = "No causal operations captured."
    private const val SINGLE_MATCHING_GROUP_TEXT = "1 matching retained trace group."
    private const val DIAGNOSTICS_BUTTON_LABEL = "Exercise Solid diagnostics capture"
    private const val DIAGNOSTICS_COUNTER_NAME = "solid-native.devtools.diagnostics.counter"
    private const val DIAGNOSTICS_OUTPUT_NAME = "solid-native.devtools.diagnostics.output"
    private const val DIAGNOSTICS_UPDATED_TEXT = "Solid diagnostics updates: 1"
    private const val DIAGNOSTICS_CORRELATION_ROW =
        "$DIAGNOSTICS_OUTPUT_NAME · 1 reruns · 1 frames"
    private const val ASYNC_BUTTON_LABEL = "Report async development error"
    private const val ASYNC_ERROR_TEXT = "Physical async failure"
    private const val ASYNC_RECOVERED_TEXT = "Async overlay recovered"
    private const val RUNTIME_BUTTON_LABEL = "Report guarded Hermes error"
    private const val RUNTIME_ERROR_TEXT = "Physical guarded Hermes failure"
    private const val RUNTIME_RECOVERED_TEXT = "Runtime overlay recovered"
    private const val RENDER_BUTTON_LABEL = "Throw Solid render error"
    private const val RENDER_ERROR_TEXT = "Physical Solid render failure"
    private const val RENDER_RECOVERED_TEXT = "Render overlay recovered"
    private const val DISMISS_ERROR_LABEL = "Dismiss development error"
    private const val RETRY_ERROR_LABEL = "Retry failed Solid subtree"
    private const val DISPOSE_LABEL = "Dispose development overlay proof"
    private const val FAILURE_MARKER = "SOLID_NATIVE_DEVTOOLS_FAILED"
    private const val BRIDGE_REMOVED_MARKER = "SOLID_NATIVE_DEVTOOLS_BRIDGE_REMOVED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_DEVTOOLS_TEARDOWN_SUCCEEDED"
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
