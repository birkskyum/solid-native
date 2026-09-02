package dev.solidnative.e2e

import android.accessibilityservice.AccessibilityService
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
class SolidNativeModalStackPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testNestedModalStackOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()

    waitForNode(READY_TIMEOUT_MS) { it.text?.toString() == ROOT_TITLE }
    tapCenter(waitForDescription(OPEN_FIRST_LABEL))
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == FIRST_TITLE }
    tapCenter(waitForDescription(OPEN_SECOND_LABEL))
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == SECOND_TITLE }

    assertTrue(
        "Android did not deliver Back to the top nested native Modal.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK,
        ),
    )
    waitForDescription(FIRST_RETAINED_STATE)
    assertTrue(
        "Android did not deliver Back to the retained first native Modal.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK,
        ),
    )
    waitForDescription(PLATFORM_CLOSED_STATE)

    tapCenter(waitForDescription(OPEN_FIRST_LABEL))
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == FIRST_TITLE }
    tapCenter(waitForDescription(OPEN_SECOND_LABEL))
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == SECOND_TITLE }
    tapCenter(waitForDescription(APPLICATION_CLOSE_LABEL))
    waitForDescription(APPLICATION_CLOSED_STATE)

    tapCenter(waitForDescription(DISPOSE_LABEL))
    waitForNodeGone(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == DISPOSE_LABEL
    }
    waitForTeardown()
    assertFalse(
        "The nested modal proof disposed its Fabric surface by finishing the Activity.",
        activity.isFinishing,
    )
  }

  private fun launchApplication(): Activity {
    val launchIntent =
        checkNotNull(
            instrumentation.targetContext.packageManager.getLaunchIntentForPackage(APP_ID),
        )
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
    val activity = instrumentation.startActivitySync(launchIntent)
    instrumentation.waitForIdleSync()
    return activity
  }

  private fun waitForDescription(description: String): AccessibilityNodeInfo =
      waitForNode(PROOF_TIMEOUT_MS) {
        it.contentDescription?.toString() == description
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
    fail("The expected accessibility node did not appear within ${timeoutMilliseconds}ms.")
    throw AssertionError("unreachable")
  }

  private fun waitForNodeGone(
      timeoutMilliseconds: Long,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ) {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      if (findNode(instrumentation.uiAutomation.rootInActiveWindow, predicate) == null) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The accessibility node remained after ${timeoutMilliseconds}ms.")
  }

  private fun waitForTeardown() {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The nested modal-stack proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The nested modal-stack proof did not acknowledge native-surface teardown.")
  }

  private fun readReactNativeJsLogs(): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              instrumentation.uiAutomation.executeShellCommand(
                  "logcat -d -v brief -s ReactNativeJS:I"
              )
          )
          .bufferedReader()
          .use { it.readText() }

  private fun tapCenter(node: AccessibilityNodeInfo) {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertFalse("The nested modal control had empty bounds.", bounds.isEmpty)
    val x = bounds.exactCenterX()
    val y = bounds.exactCenterY()
    val downTime = SystemClock.uptimeMillis()
    val down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0)
    val up =
        MotionEvent.obtain(
            downTime,
            downTime + TAP_DURATION_MS,
            MotionEvent.ACTION_UP,
            x,
            y,
            0,
        )
    down.source = InputDevice.SOURCE_TOUCHSCREEN
    up.source = InputDevice.SOURCE_TOUCHSCREEN
    try {
      assertTrue(
          "The Android runner did not inject touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
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

  companion object {
    private const val APP_ID = "dev.solidnative.navigation"
    private const val ROOT_TITLE = "Solid Native nested modal root"
    private const val FIRST_TITLE = "Solid Native nested modal level one"
    private const val SECOND_TITLE = "Solid Native nested modal level two"
    private const val OPEN_FIRST_LABEL = "Open first nested native modal"
    private const val OPEN_SECOND_LABEL = "Open second nested native modal"
    private const val APPLICATION_CLOSE_LABEL =
        "Close nested native modals through application history"
    private const val DISPOSE_LABEL = "Dispose nested native modal proof"
    private const val FIRST_RETAINED_STATE =
        "First modal retained after one Android platform Back"
    private const val PLATFORM_CLOSED_STATE =
        "Android platform Back closed both modal levels exactly"
    private const val APPLICATION_CLOSED_STATE =
        "Application multi-pop closed both modal levels exactly"
    private const val FAILURE_MARKER = "SOLID_NATIVE_NAVIGATION_MODAL_STACK_FAILED"
    private const val TEARDOWN_MARKER =
        "SOLID_NATIVE_NAVIGATION_MODAL_STACK_TEARDOWN_SUCCEEDED"
    private const val POLL_INTERVAL_MS = 25L
    private const val TAP_DURATION_MS = 50L
    private const val READY_TIMEOUT_MS = 15_000L
    private const val PROOF_TIMEOUT_MS = 10_000L
  }
}
