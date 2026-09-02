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
class SolidNativeSharingPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testNativeSharesheetPayloadsAndTeardownOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT)

    proveShare(
        controlLabel = SHARE_COMBINED_LABEL,
        captureResult = SolidNativeShareCaptureActivity.COMBINED_RESULT_TEXT,
        applicationResult = COMBINED_RESULT_TEXT,
    )
    proveShare(
        controlLabel = SHARE_URL_ONLY_LABEL,
        captureResult = SolidNativeShareCaptureActivity.URL_ONLY_RESULT_TEXT,
        applicationResult = URL_ONLY_RESULT_TEXT,
    )

    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    waitForTeardownAcknowledgement()
    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during sharing teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during sharing teardown.", activity.isDestroyed)
    }
  }

  private fun proveShare(
      controlLabel: String,
      captureResult: String,
    applicationResult: String,
  ) {
    tapControl(controlLabel)
    val receiver = waitForPhysicalReceiver()
    val receiverTarget = clickableAncestor(receiver)
    assertTrue("The physical sharing receiver was not clickable.", receiverTarget.isClickable)
    tapCenter(receiverTarget)
    waitForText(captureResult)
    assertFalse(
        "The physical receiver accepted an invalid native share payload.",
        hasNode { it.text?.toString() == SolidNativeShareCaptureActivity.INVALID_RESULT_TEXT },
    )
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
    waitForText(applicationResult)
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
    assertTrue("The sharing control $label was not clickable.", control.isClickable)
    tapCenter(control)
  }

  private fun waitForText(text: String): AccessibilityNodeInfo =
      waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == text }

  private fun waitForPhysicalReceiver(): AccessibilityNodeInfo {
    val deadline = SystemClock.uptimeMillis() + SHARESHEET_TIMEOUT_MS
    var nextSwipe = 0L
    while (SystemClock.uptimeMillis() < deadline) {
      val receiver =
          findNode(instrumentation.uiAutomation.rootInActiveWindow) { node ->
            hasPhysicalBounds(node) &&
                (node.text?.toString() == RECEIVER_LABEL ||
                    node.contentDescription?.toString()?.contains(RECEIVER_LABEL) == true)
          }
      if (receiver != null) return receiver
      val now = SystemClock.uptimeMillis()
      if (now >= nextSwipe) {
        swipeSharesheetUp()
        nextSwipe = now + SWIPE_INTERVAL_MS
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The physical Solid Native receiver did not become visible in the native sharesheet.")
    throw AssertionError("unreachable")
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
    fail("The expected native sharing accessibility node did not appear.")
    throw AssertionError("unreachable")
  }

  private fun waitForNodeToDisappear(
      timeoutMilliseconds: Long,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ) {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      if (!hasNode(predicate)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The sharing accessibility tree survived owner teardown.")
  }

  private fun waitForTeardownAcknowledgement() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The native sharing proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native sharing proof did not acknowledge terminal surface teardown.")
  }

  private fun readReactNativeJsLogs(): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              instrumentation.uiAutomation.executeShellCommand(
                  "logcat -d -v brief -s ReactNativeJS:I"
              )
          )
          .bufferedReader()
          .use { it.readText() }

  private fun hasNode(predicate: (AccessibilityNodeInfo) -> Boolean): Boolean =
      findNode(instrumentation.uiAutomation.rootInActiveWindow, predicate) != null

  private fun hasPhysicalBounds(node: AccessibilityNodeInfo): Boolean {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    return !bounds.isEmpty
  }

  private fun clickableAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo {
    var candidate = node
    while (!candidate.isClickable) {
      candidate = candidate.parent ?: return node
    }
    return candidate
  }

  private fun swipeSharesheetUp() {
    val root = instrumentation.uiAutomation.rootInActiveWindow ?: return
    val bounds = Rect()
    root.getBoundsInScreen(bounds)
    if (bounds.isEmpty) return
    val x = bounds.exactCenterX()
    val startY = bounds.top + bounds.height() * 0.95f
    val endY = bounds.top + bounds.height() * 0.68f
    val downTime = SystemClock.uptimeMillis()
    val down =
        MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, startY, 0).apply {
          source = InputDevice.SOURCE_TOUCHSCREEN
        }
    try {
      assertTrue(
          "The Android runner did not inject sharesheet swipe-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      for (step in 1..SWIPE_STEPS) {
        val progress = step.toFloat() / SWIPE_STEPS
        val move =
            MotionEvent.obtain(
                downTime,
                downTime + step * SWIPE_STEP_DURATION_MS,
                MotionEvent.ACTION_MOVE,
                x,
                startY + (endY - startY) * progress,
                0,
            ).apply { source = InputDevice.SOURCE_TOUCHSCREEN }
        try {
          assertTrue(
              "The Android runner did not inject sharesheet swipe movement.",
              instrumentation.uiAutomation.injectInputEvent(move, true),
          )
        } finally {
          move.recycle()
        }
      }
      val up =
          MotionEvent.obtain(
              downTime,
              downTime + (SWIPE_STEPS + 1) * SWIPE_STEP_DURATION_MS,
              MotionEvent.ACTION_UP,
              x,
              endY,
              0,
          ).apply { source = InputDevice.SOURCE_TOUCHSCREEN }
      try {
        assertTrue(
            "The Android runner did not inject sharesheet swipe-up.",
            instrumentation.uiAutomation.injectInputEvent(up, true),
        )
      } finally {
        up.recycle()
      }
    } finally {
      down.recycle()
    }
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
    assertFalse("The sharing control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject sharing touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject sharing touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native sharing ready"
    private const val SHARE_COMBINED_LABEL = "Share message and URL"
    private const val SHARE_URL_ONLY_LABEL = "Share URL only"
    private const val RECEIVER_LABEL = "Solid Native proof receiver"
    private const val COMBINED_RESULT_TEXT = "Combined share result: presented"
    private const val URL_ONLY_RESULT_TEXT = "URL-only share result: presented"
    private const val DISPOSE_LABEL = "Dispose Solid Native sharing proof"
    private const val FAILURE_MARKER = "SOLID_NATIVE_SHARING_FAILED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_SHARING_TEARDOWN_SUCCEEDED"
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val SHARESHEET_TIMEOUT_MS = 20_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
    private const val SWIPE_INTERVAL_MS = 750L
    private const val SWIPE_STEPS = 10
    private const val SWIPE_STEP_DURATION_MS = 25L
  }
}
