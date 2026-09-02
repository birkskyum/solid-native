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
class SolidNativeNetworkingPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testNativeNetworkingProtocolsAndOwnerTeardownOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT, READY_TIMEOUT_MS)

    tapControl(RUN_LABEL)
    waitForText(COMPLETE_TEXT, PROTOCOL_TIMEOUT_MS)

    tapControl(START_DISPOSAL_LABEL)
    waitForText(DISPOSAL_ACTIVE_TEXT, PROOF_TIMEOUT_MS)
    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == READY_TEXT
    }
    waitForTeardownAcknowledgement()

    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during networking teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during networking teardown.", activity.isDestroyed)
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
    assertTrue("The networking control $label was not clickable.", control.isClickable)
    tapCenter(control)
  }

  private fun waitForText(text: String, timeoutMilliseconds: Long): AccessibilityNodeInfo =
      waitForNode(timeoutMilliseconds) { it.text?.toString() == text }

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
    fail("The expected native networking accessibility node did not appear.")
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
    fail("The networking accessibility tree survived owner teardown.")
  }

  private fun waitForTeardownAcknowledgement() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The native networking proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(OWNER_CANCELLATION_MARKER) && logs.contains(TEARDOWN_MARKER)) {
        return
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native networking proof did not acknowledge owner cancellation and teardown.")
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

  private fun tapCenter(node: AccessibilityNodeInfo) {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertFalse("The networking proof control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject networking touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject networking touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native networking ready"
    private const val RUN_LABEL = "Run native networking protocol proof"
    private const val COMPLETE_TEXT =
        "Networking proof complete (2 SSE events, JSON 2, failure, cancellation)"
    private const val START_DISPOSAL_LABEL = "Start owner-disposal network request"
    private const val DISPOSAL_ACTIVE_TEXT = "Owner-disposal request active"
    private const val DISPOSE_LABEL = "Dispose active networking owner"
    private const val FAILURE_MARKER = "SOLID_NATIVE_NETWORKING_FAILED"
    private const val OWNER_CANCELLATION_MARKER =
        "SOLID_NATIVE_NETWORKING_OWNER_CANCELLATION_SUCCEEDED"
    private const val TEARDOWN_MARKER =
        "SOLID_NATIVE_NETWORKING_TEARDOWN_SUCCEEDED"
    private const val READY_TIMEOUT_MS = 10_000L
    private const val PROOF_TIMEOUT_MS = 15_000L
    private const val PROTOCOL_TIMEOUT_MS = 30_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
