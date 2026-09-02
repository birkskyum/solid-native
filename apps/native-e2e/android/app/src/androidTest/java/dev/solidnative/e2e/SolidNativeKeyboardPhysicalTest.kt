package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

@RunWith(AndroidJUnit4::class)
class SolidNativeKeyboardPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testSoftwareKeyboardAvoidanceOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    instrumentation.runOnMainSync {
      activity.window.setSoftInputMode(
          WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
      )
    }

    waitForNode(READY_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    val initialAnchor = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == AVOIDANCE_ANCHOR_LABEL
    }
    val initialBounds = boundsFor(initialAnchor)
    val textInput = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == INPUT_LABEL
    }
    assertEquals("android.widget.EditText", textInput.className?.toString())
    assertTrue("The keyboard proof input was not clickable.", textInput.isClickable)
    tapCenter(textInput)

    waitForImeVisibility(activity, true)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == VISIBLE_TEXT }
    val movedBounds = waitForAnchorBounds(PROOF_TIMEOUT_MS) {
      it.top <= initialBounds.top - minimumMovementPixels(activity)
    }
    var imeTop = 0
    instrumentation.runOnMainSync {
      val decor = activity.window.decorView
      val inset = decor.rootWindowInsets?.getInsets(WindowInsets.Type.ime())?.bottom ?: 0
      imeTop = decor.height - inset
    }
    assertTrue("Android did not report a positive IME inset.", imeTop > 0)
    assertTrue(
        "The avoidance anchor remained underneath the Android keyboard.",
        movedBounds.bottom <= imeTop + activity.resources.displayMetrics.density,
    )

    instrumentation.sendStringSync("SolidNative42")
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_ENTER)
    waitForImeVisibility(activity, false)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == SUCCEEDED_TEXT }
    waitForAnchorBounds(PROOF_TIMEOUT_MS) {
      abs(it.top - initialBounds.top) <= restorationTolerancePixels(activity)
    }

    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == DISPOSE_LABEL
    }
    assertTrue("The keyboard teardown control was not clickable.", dispose.isClickable)
    activateAccessibilityNode(dispose, "keyboard teardown")
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == TITLE_TEXT
    }
    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during owner teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during owner teardown.", activity.isDestroyed)
    }
  }

  @Test
  fun testFocusedFieldScrollOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    instrumentation.runOnMainSync {
      activity.window.setSoftInputMode(
          WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
      )
    }

    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == SCROLL_READY_TEXT
    }
    val firstInput = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == SCROLL_FIRST_INPUT_LABEL
    }
    assertEquals("android.widget.EditText", firstInput.className?.toString())
    assertTrue("The focused-scroll input was not clickable.", firstInput.isClickable)
    val initialBounds = boundsFor(firstInput)
    tapCenter(firstInput)

    waitForImeVisibility(activity, true)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == SCROLL_VISIBLE_TEXT
    }
    val movedBounds = waitForInputBounds(PROOF_TIMEOUT_MS, SCROLL_FIRST_INPUT_LABEL) {
      it.top <= initialBounds.top - minimumMovementPixels(activity)
    }
    var imeTop = 0
    instrumentation.runOnMainSync {
      val decor = activity.window.decorView
      val inset = decor.rootWindowInsets?.getInsets(WindowInsets.Type.ime())?.bottom ?: 0
      imeTop = decor.height - inset
    }
    assertTrue("Android did not report a positive focused-scroll IME inset.", imeTop > 0)
    assertTrue(
        "The automatically scrolled editor remained underneath the Android keyboard.",
        movedBounds.bottom <= imeTop - (15 * activity.resources.displayMetrics.density),
    )

    instrumentation.sendStringSync("SolidNativeFirst42")
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_ENTER)
    waitForImeVisibility(activity, true)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == SCROLL_TRAVERSED_TEXT
    }
    val secondInput = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == SCROLL_SECOND_INPUT_LABEL && it.isFocused
    }
    assertEquals("android.widget.EditText", secondInput.className?.toString())
    var traversalImeTop = 0
    instrumentation.runOnMainSync {
      val decor = activity.window.decorView
      val inset = decor.rootWindowInsets?.getInsets(WindowInsets.Type.ime())?.bottom ?: 0
      traversalImeTop = decor.height - inset
    }
    val traversalMaximumBottom =
        traversalImeTop - (15 * activity.resources.displayMetrics.density)
    println(
        "Focused-scroll traversal expected bottom <= $traversalMaximumBottom " +
            "from IME top $traversalImeTop."
    )
    waitForInputBounds(PROOF_TIMEOUT_MS, SCROLL_SECOND_INPUT_LABEL) {
      it.bottom <= traversalMaximumBottom
    }

    instrumentation.sendStringSync("SolidNativeSecond42")
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_ENTER)
    waitForImeVisibility(activity, false)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == SCROLL_SUCCEEDED_TEXT
    }

    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == SCROLL_DISPOSE_LABEL
    }
    assertTrue("The focused-scroll teardown control was not clickable.", dispose.isClickable)
    activateAccessibilityNode(dispose, "focused-scroll teardown")
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == SCROLL_SUCCEEDED_TEXT
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
    launchIntent.addFlags(
        Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK
    )
    val activity = instrumentation.startActivitySync(launchIntent)
    instrumentation.waitForIdleSync()
    return activity
  }

  private fun waitForImeVisibility(activity: Activity, expected: Boolean) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var visible = false
      instrumentation.runOnMainSync {
        visible =
            activity.window.decorView.rootWindowInsets
                ?.isVisible(WindowInsets.Type.ime()) == true
      }
      if (visible == expected) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The Android software keyboard did not become ${if (expected) "visible" else "hidden"}.")
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
    fail("The expected keyboard accessibility node did not appear within ${timeoutMilliseconds}ms.")
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
    fail("The keyboard accessibility node survived owner teardown.")
  }

  private fun waitForAnchorBounds(
      timeoutMilliseconds: Long,
      predicate: (Rect) -> Boolean,
  ): Rect {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      val anchor =
          findNode(instrumentation.uiAutomation.rootInActiveWindow) {
            it.contentDescription?.toString() == AVOIDANCE_ANCHOR_LABEL
          }
      if (anchor != null) {
        val bounds = boundsFor(anchor)
        if (predicate(bounds)) return bounds
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The keyboard avoidance anchor did not reach its expected physical frame.")
    throw AssertionError("unreachable")
  }

  private fun waitForInputBounds(
      timeoutMilliseconds: Long,
      label: String,
      predicate: (Rect) -> Boolean,
  ): Rect {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    var lastBounds: Rect? = null
    while (SystemClock.uptimeMillis() < deadline) {
      val input =
          findNode(instrumentation.uiAutomation.rootInActiveWindow) {
            it.contentDescription?.toString() == label
          }
      if (input != null) {
        val bounds = boundsFor(input)
        lastBounds = bounds
        if (predicate(bounds)) return bounds
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The focused native editor did not reach its expected physical frame; " +
            "last bounds were ${lastBounds ?: "unavailable"}."
    )
    throw AssertionError("unreachable")
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
    assertFalse("The keyboard proof node had empty physical bounds.", bounds.isEmpty)
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

  private fun activateAccessibilityNode(node: AccessibilityNodeInfo, description: String) {
    assertTrue(
        "The $description control was not visible to Android accessibility.",
        node.isVisibleToUser,
    )
    assertTrue(
        "Android accessibility did not activate the $description control.",
        node.performAction(AccessibilityNodeInfo.ACTION_CLICK),
    )
  }

  private fun minimumMovementPixels(activity: Activity): Int =
      (20 * activity.resources.displayMetrics.density).toInt()

  private fun restorationTolerancePixels(activity: Activity): Int =
      (3 * activity.resources.displayMetrics.density).toInt()

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val TITLE_TEXT = "Solid Native keyboard proof"
    private const val READY_TEXT = "Solid Native keyboard ready"
    private const val VISIBLE_TEXT =
        "Solid Native keyboard visible with positive metrics"
    private const val SUCCEEDED_TEXT =
        "Solid Native keyboard show, submit, blur, and hide observed"
    private const val INPUT_LABEL = "Solid Native keyboard proof input"
    private const val AVOIDANCE_ANCHOR_LABEL =
        "Solid Native keyboard avoidance anchor"
    private const val DISPOSE_LABEL = "Dispose Solid Native keyboard proof"
    private const val SCROLL_READY_TEXT = "Solid Native focused scroll ready"
    private const val SCROLL_VISIBLE_TEXT =
        "Solid Native focused field visible above keyboard"
    private const val SCROLL_TRAVERSED_TEXT =
        "Solid Native next field focused above keyboard"
    private const val SCROLL_SUCCEEDED_TEXT =
        "Solid Native focus traversal submit and hide observed"
    private const val SCROLL_FIRST_INPUT_LABEL =
        "Solid Native focused scroll first input"
    private const val SCROLL_SECOND_INPUT_LABEL =
        "Solid Native focused scroll second input"
    private const val SCROLL_DISPOSE_LABEL =
        "Dispose Solid Native focused scroll proof"
    private const val READY_TIMEOUT_MS = 10_000L
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
