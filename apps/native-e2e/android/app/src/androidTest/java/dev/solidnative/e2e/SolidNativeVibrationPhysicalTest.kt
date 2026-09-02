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
class SolidNativeVibrationPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testNativeVibrationTimingCancellationAndOwnerTeardownOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT)
    waitForVibrationStopped()

    tapControl(START_LABEL)
    waitForText(ACTIVE_TEXT)
    waitForExpectedVibration()

    tapControl(CANCEL_LABEL)
    waitForText(CANCELLED_TEXT)
    waitForVibrationStopped()

    tapControl(START_LABEL)
    waitForText(ACTIVE_TEXT)
    waitForExpectedVibration()
    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    waitForVibrationStopped()
    waitForTeardownAcknowledgement()

    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during vibration teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during vibration teardown.", activity.isDestroyed)
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
    assertTrue("The vibration control $label was not clickable.", control.isClickable)
    tapCenter(control)
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
    fail("The expected native vibration accessibility node did not appear.")
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
    fail("The vibration accessibility tree survived owner teardown.")
  }

  private fun waitForExpectedVibration() {
    val deadline = SystemClock.uptimeMillis() + VIBRATION_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val current = currentVibration(readVibratorState())
      if (
          current.contains("status = running") &&
              current.contains("durationMs = -1") &&
              current.contains("duration=0") &&
              current.contains("duration=80") &&
              current.contains("duration=160") &&
              current.contains("duration=140") &&
              current.contains("repeat=0") &&
              current.contains("opPkg=$APP_ID")
      ) {
        return
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("Android never reported the expected repeating Solid Native waveform.")
  }

  private fun waitForVibrationStopped() {
    val deadline = SystemClock.uptimeMillis() + VIBRATION_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      if (currentVibration(readVibratorState()).trim() == "null") return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The Solid-owned Android waveform survived cancellation or teardown.")
  }

  private fun currentVibration(state: String): String =
      state.substringAfter("CurrentVibration:", "missing").substringBefore("NextVibration:")

  private fun readVibratorState(): String = readShell("dumpsys vibrator_manager")

  private fun waitForTeardownAcknowledgement() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readShell("logcat -d -v brief -s ReactNativeJS:I")
      if (logs.contains(FAILURE_MARKER)) {
        fail("The native vibration proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native vibration proof did not acknowledge terminal surface teardown.")
  }

  private fun readShell(command: String): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              instrumentation.uiAutomation.executeShellCommand(command)
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
    assertFalse("The vibration control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject vibration touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject vibration touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native vibration ready"
    private const val START_LABEL = "Start repeating native vibration"
    private const val CANCEL_LABEL = "Cancel native vibration"
    private const val DISPOSE_LABEL = "Dispose Solid Native vibration proof"
    private const val ACTIVE_TEXT = "Repeating vibration active"
    private const val CANCELLED_TEXT = "Vibration cancelled"
    private const val FAILURE_MARKER = "SOLID_NATIVE_VIBRATION_FAILED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_VIBRATION_TEARDOWN_SUCCEEDED"
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val VIBRATION_TIMEOUT_MS = 5_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
