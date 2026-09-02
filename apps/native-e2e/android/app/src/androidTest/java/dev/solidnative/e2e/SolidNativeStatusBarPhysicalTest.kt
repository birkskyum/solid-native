package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.WindowInsets
import android.view.WindowInsetsController
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
class SolidNativeStatusBarPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testStatusBarOwnerStackOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    waitForStatusBar(activity, visible = true, darkIcons = true)

    tapControl(MOUNT_OVERLAY_LABEL)
    waitForStatusBar(activity, visible = true, darkIcons = false)

    tapControl(HIDE_OVERLAY_LABEL)
    waitForStatusBar(activity, visible = false, darkIcons = false)

    tapControl(DISPOSE_OVERLAY_LABEL)
    waitForStatusBar(activity, visible = true, darkIcons = true)

    tapControl(DISPOSE_APPLICATION_LABEL)
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

  private fun waitForStatusBar(activity: Activity, visible: Boolean, darkIcons: Boolean) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    var observedVisible: Boolean? = null
    var observedDarkIcons: Boolean? = null
    while (SystemClock.uptimeMillis() < deadline) {
      instrumentation.runOnMainSync {
        val decor = activity.window.decorView
        observedVisible =
            decor.rootWindowInsets?.isVisible(WindowInsets.Type.statusBars())
        val appearance = activity.window.insetsController?.systemBarsAppearance
        observedDarkIcons =
            appearance?.let {
              it and WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS != 0
            }
      }
      if (observedVisible == visible && observedDarkIcons == darkIcons) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "Status-bar state mismatch: expected visible/darkIcons $visible/$darkIcons, " +
            "observed $observedVisible/$observedDarkIcons."
    )
  }

  private fun tapControl(label: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == label
    }
    assertTrue("The status-bar control $label was not clickable.", control.isClickable)
    tapCenter(control)
  }

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
    fail("The expected status-bar accessibility node did not appear.")
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
    fail("The status-bar accessibility tree survived owner teardown.")
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

  private fun boundsFor(node: AccessibilityNodeInfo): Rect {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertFalse("The status-bar proof control had empty physical bounds.", bounds.isEmpty)
    return bounds
  }

  private fun tapCenter(node: AccessibilityNodeInfo) {
    val bounds = boundsFor(node)
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
    private const val READY_TEXT = "Solid Native status bar ready"
    private const val MOUNT_OVERLAY_LABEL = "Mount light status bar owner"
    private const val HIDE_OVERLAY_LABEL = "Hide status bar from child owner"
    private const val DISPOSE_OVERLAY_LABEL = "Dispose child status bar owner"
    private const val DISPOSE_APPLICATION_LABEL = "Dispose Solid Native status bar proof"
    private const val READY_TIMEOUT_MS = 10_000L
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
