package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
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
class SolidNativeMemoryWarningPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testMemoryWarningOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT)
    waitForText("Memory warnings 0")

    instrumentation.runOnMainSync {
      (activity.application as MainApplication).onTrimMemory(UI_HIDDEN)
    }
    SystemClock.sleep(NON_PRESSURE_SETTLE_MS)
    assertTrue(
        "UI_HIDDEN was incorrectly converted into memory pressure.",
        findNode(instrumentation.uiAutomation.rootInActiveWindow) {
          it.text?.toString() == "Memory warnings 0"
        } != null,
    )

    // Invoke the exact Application callback Android calls for a running
    // process under pressure. This is deterministic injection, not a claim
    // that the test forced the device into genuine system-wide low memory.
    instrumentation.runOnMainSync {
      (activity.application as MainApplication).onTrimMemory(RUNNING_CRITICAL)
    }
    waitForText(SUCCEEDED_TEXT)
    waitForText("Memory warnings 1")

    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == SUCCEEDED_TEXT
    }
    waitForTeardownAcknowledgement()
    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during owner teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during owner teardown.", activity.isDestroyed)
    }
  }

  private fun launchApplication(): Activity {
    val launchIntent =
        checkNotNull(instrumentation.targetContext.packageManager.getLaunchIntentForPackage(APP_ID))
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
    val activity = instrumentation.startActivitySync(launchIntent)
    instrumentation.waitForIdleSync()
    return activity
  }

  private fun tapControl(label: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) { it.contentDescription?.toString() == label }
    assertTrue("The memory-warning control $label was not clickable.", control.isClickable)
    val bounds = Rect()
    control.getBoundsInScreen(bounds)
    assertFalse("The memory-warning control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject memory-warning touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject memory-warning touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
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
    fail("The expected memory-warning accessibility node did not appear.")
    throw AssertionError("unreachable")
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
    fail("The memory-warning accessibility tree survived owner teardown.")
  }

  private fun waitForTeardownAcknowledgement() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The memory-warning proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The memory-warning proof did not acknowledge terminal surface teardown.")
  }

  private fun readReactNativeJsLogs(): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              instrumentation.uiAutomation.executeShellCommand(
                  "logcat -d -v brief -s ReactNativeJS:I"
              )
          )
          .bufferedReader()
          .use { it.readText() }

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

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native memory-warning proof ready"
    private const val SUCCEEDED_TEXT = "Solid Native memory-warning causal proof succeeded"
    private const val DISPOSE_LABEL = "Dispose Solid Native memory-warning proof"
    private const val FAILURE_MARKER = "SOLID_NATIVE_MEMORY_WARNING_FAILED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_MEMORY_WARNING_TEARDOWN_SUCCEEDED"
    private const val UI_HIDDEN = 20
    private const val RUNNING_CRITICAL = 15
    private const val PROOF_TIMEOUT_MS = 20_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
    private const val NON_PRESSURE_SETTLE_MS = 1_000L
  }
}
