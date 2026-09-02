package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
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
class SolidNativeLinkingPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val uiAutomation = instrumentation.uiAutomation

  @Test
  fun testOutboundApplicationURLAndSettingsHandoffsOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()

    try {
      waitForText(READY_TEXT)
      waitForText(WAITING_TEXT)

      tapControl(OPEN_SELF_LABEL)
      waitForLogMarker(CAPABILITY_MARKER)
      waitForLogMarker(OPEN_MARKER)
      waitForIntentData(activity, SELF_URL)
      instrumentation.runOnMainSync {
        assertFalse("The registered URL finished the single-task Activity.", activity.isFinishing)
        assertFalse("The registered URL destroyed the single-task Activity.", activity.isDestroyed)
      }

      tapControl(COMMIT_LINK_LABEL)
      waitForText(RECEIVED_TEXT)
      waitForLogMarker(CAUSALITY_MARKER)

      tapControl(OPEN_SETTINGS_LABEL)
      waitForActivePackage(SETTINGS_PACKAGE)
      waitForText(APP_LABEL)
      waitForLogMarker(SETTINGS_MARKER)
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      waitForActivePackage(APP_ID)
      waitForText(READY_TEXT)
      waitForText(RECEIVED_TEXT)
      instrumentation.runOnMainSync {
        assertFalse("The Settings handoff finished the host Activity.", activity.isFinishing)
        assertFalse("The Settings handoff destroyed the host Activity.", activity.isDestroyed)
      }

      tapControl(DISPOSE_LABEL)
      waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
      waitForLogMarker(TEARDOWN_MARKER)
      instrumentation.runOnMainSync {
        assertFalse("The host Activity finished during linking teardown.", activity.isFinishing)
        assertFalse("The host Activity was destroyed during linking teardown.", activity.isDestroyed)
      }
    } finally {
      if (activePackage() == SETTINGS_PACKAGE) {
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      }
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

  private fun waitForIntentData(activity: Activity, expected: String) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var actual: String? = null
      instrumentation.runOnMainSync { actual = activity.intent?.dataString }
      if (actual == expected) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("Android did not deliver the registered URL to the existing Activity.")
  }

  private fun waitForActivePackage(expected: String) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      if (activePackage() == expected) {
        instrumentation.waitForIdleSync()
        return
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The expected foreground package $expected did not appear.")
  }

  private fun activePackage(): String? =
      uiAutomation.rootInActiveWindow?.packageName?.toString()

  private fun tapControl(label: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) { it.contentDescription?.toString() == label }
    assertTrue("The linking control $label was not clickable.", control.isClickable)
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
      val found = findNode(uiAutomation.rootInActiveWindow, predicate)
      if (found != null) return found
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The expected native linking proof node did not appear.")
    throw AssertionError("unreachable")
  }

  private fun waitForNodeToDisappear(
      timeoutMilliseconds: Long,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ) {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      if (findNode(uiAutomation.rootInActiveWindow, predicate) == null) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The linking proof tree survived owner teardown.")
  }

  private fun waitForLogMarker(marker: String) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readProofLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The linking proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(marker)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The linking proof omitted marker $marker.")
  }

  private fun readProofLogs(): String = readShell("logcat -d -v brief -s ReactNativeJS:I")

  private fun readShell(command: String): String =
      ParcelFileDescriptor.AutoCloseInputStream(uiAutomation.executeShellCommand(command))
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
    assertFalse("The linking control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject platform touch-down.",
          uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject platform touch-up.",
          uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val SETTINGS_PACKAGE = "com.android.settings"
    private const val APP_LABEL = "Solid Native E2E"
    private const val SELF_URL = "dev.solidnative.e2e://navigation/outbound-link-proof"
    private const val READY_TEXT = "Solid Native linking ready"
    private const val WAITING_TEXT = "Native URL delivery: waiting"
    private const val RECEIVED_TEXT = "Native URL delivery: received"
    private const val OPEN_SELF_LABEL = "Open registered application URL"
    private const val COMMIT_LINK_LABEL = "Commit native URL delivery"
    private const val OPEN_SETTINGS_LABEL = "Open application settings"
    private const val DISPOSE_LABEL = "Dispose Solid Native linking proof"
    private const val FAILURE_MARKER = "SOLID_NATIVE_LINKING_FAILED"
    private const val CAPABILITY_MARKER = "SOLID_NATIVE_LINKING_CAPABILITY_SUCCEEDED"
    private const val OPEN_MARKER = "SOLID_NATIVE_LINKING_OPEN_SUCCEEDED"
    private const val CAUSALITY_MARKER = "SOLID_NATIVE_LINKING_CAUSALITY_SUCCEEDED"
    private const val SETTINGS_MARKER = "SOLID_NATIVE_LINKING_SETTINGS_SUCCEEDED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_LINKING_TEARDOWN_SUCCEEDED"
    private const val PROOF_TIMEOUT_MS = 15_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
