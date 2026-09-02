package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
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
class SolidNativeAlertPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testNativeAlertButtonAndDismissalOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT)

    tapControl(SHOW_BUTTON_LABEL)
    waitForText(DELETE_ALERT_TITLE)
    tapText(DELETE_BUTTON_TEXT)
    waitForText(DELETE_RESULT_TEXT)

    tapControl(SHOW_DISMISS_LABEL)
    waitForText(DISMISS_ALERT_TITLE)
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
    waitForText(DISMISSED_RESULT_TEXT)
    waitForNodeToDisappear(PROOF_TIMEOUT_MS) {
      it.text?.toString() == DISMISS_ALERT_TITLE
    }

    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == READY_TEXT
    }
    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during owner teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during owner teardown.", activity.isDestroyed)
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
    assertTrue("The alert control $label was not clickable.", control.isClickable)
    tapCenter(control)
  }

  private fun tapText(text: String) {
    val control =
        waitForNode(PROOF_TIMEOUT_MS) {
          it.text?.toString()?.equals(text, ignoreCase = true) == true
        }
    assertTrue(
        "The native alert button label did not preserve its text across Android theme casing.",
        control.text?.toString()?.equals(text, ignoreCase = true) == true,
    )
    assertTrue("The native alert button $text was not clickable.", control.isClickable)
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
    fail("The expected native alert accessibility node did not appear.")
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
    fail("The native alert accessibility node survived dismissal or teardown.")
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
    assertFalse("The native alert control had empty physical bounds.", bounds.isEmpty)
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
    private const val READY_TEXT = "Solid Native alert ready"
    private const val SHOW_BUTTON_LABEL = "Show destructive native alert"
    private const val DELETE_ALERT_TITLE = "Delete local draft?"
    private const val DELETE_BUTTON_TEXT = "Delete"
    private const val DELETE_RESULT_TEXT = "Alert result: delete"
    private const val SHOW_DISMISS_LABEL = "Show cancellable native alert"
    private const val DISMISS_ALERT_TITLE = "Dismiss this alert"
    private const val DISMISSED_RESULT_TEXT = "Alert result: dismissed"
    private const val DISPOSE_LABEL = "Dispose Solid Native alert proof"
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
