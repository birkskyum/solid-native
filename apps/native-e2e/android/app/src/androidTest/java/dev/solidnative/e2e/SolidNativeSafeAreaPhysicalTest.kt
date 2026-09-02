package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.th3rdwave.safeareacontext.SafeAreaProvider as NativeSafeAreaProvider
import com.th3rdwave.safeareacontext.SafeAreaView as NativeSafeAreaView
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SolidNativeSafeAreaPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testNativeSafeAreaDeliveryAndLayoutOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }

    waitForSafeAreaLayout(activity)

    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == DISPOSE_LABEL
    }
    assertTrue("The safe-area teardown control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
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

  private fun waitForSafeAreaLayout(activity: Activity) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    var lastFailure = "The native safe-area views were not mounted."
    while (SystemClock.uptimeMillis() < deadline) {
      var matched = false
      instrumentation.runOnMainSync {
        val decor = activity.window.decorView
        val provider = findAndroidView(decor) { it is NativeSafeAreaProvider }
        val safeView = findAndroidView(decor) { it is NativeSafeAreaView }
        val topAnchor = findAndroidView(decor) {
          it.contentDescription?.toString() == TOP_ANCHOR_LABEL
        }
        val bottomAnchor = findAndroidView(decor) {
          it.contentDescription?.toString() == BOTTOM_ANCHOR_LABEL
        }
        if (provider == null || safeView == null || topAnchor == null || bottomAnchor == null) {
          return@runOnMainSync
        }
        val nativeProvider = provider as NativeSafeAreaProvider
        val nativeSafeView = safeView as NativeSafeAreaView
        assertNotNull("The native safe-area provider was detached.", nativeProvider.parent)
        assertTrue(
            "The Solid safe-area view did not mount below the native provider.",
            isDescendant(nativeProvider, nativeSafeView),
        )
        val windowInsets =
            decor.rootWindowInsets?.getInsets(
                WindowInsets.Type.statusBars() or
                    WindowInsets.Type.displayCutout() or
                    WindowInsets.Type.navigationBars() or
                    WindowInsets.Type.captionBar()
            )
        if (windowInsets == null || nativeProvider.height == 0 || nativeSafeView.height == 0) {
          return@runOnMainSync
        }

        val providerVisible = Rect()
        if (!nativeProvider.getGlobalVisibleRect(providerVisible)) return@runOnMainSync
        val root = nativeProvider.rootView
        val expectedTop = max(windowInsets.top - providerVisible.top, 0)
        val expectedBottom =
            max(
                min(providerVisible.top + nativeProvider.height - root.height, 0) +
                    windowInsets.bottom,
                0,
            )
        if (expectedTop + expectedBottom <= 0) {
          lastFailure = "The physical window reported no top or bottom safe-area inset."
          return@runOnMainSync
        }

        val safeBounds = boundsFor(nativeSafeView)
        val topBounds = boundsFor(topAnchor)
        val bottomBounds = boundsFor(bottomAnchor)
        val appliedTop = topBounds.top - safeBounds.top
        val appliedBottom = safeBounds.bottom - bottomBounds.bottom
        val tolerance = max(2, (2 * activity.resources.displayMetrics.density).toInt())
        if (
            abs(appliedTop - expectedTop) <= tolerance &&
                abs(appliedBottom - expectedBottom) <= tolerance
        ) {
          matched = true
        } else {
          lastFailure =
              "Safe-area layout mismatch: expected top/bottom $expectedTop/$expectedBottom px, " +
                  "applied $appliedTop/$appliedBottom px."
        }
      }
      if (matched) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(lastFailure)
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
    fail("The expected safe-area accessibility node did not appear.")
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
    fail("The safe-area accessibility tree survived owner teardown.")
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

  private fun findAndroidView(view: View, predicate: (View) -> Boolean): View? {
    if (predicate(view)) return view
    if (view !is ViewGroup) return null
    for (index in 0 until view.childCount) {
      val found = findAndroidView(view.getChildAt(index), predicate)
      if (found != null) return found
    }
    return null
  }

  private fun isDescendant(parent: ViewGroup, child: View): Boolean {
    var current = child.parent
    while (current != null) {
      if (current === parent) return true
      current = current.parent
    }
    return false
  }

  private fun boundsFor(view: View): Rect {
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    return Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
  }

  private fun boundsFor(node: AccessibilityNodeInfo): Rect {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertFalse("The safe-area proof control had empty physical bounds.", bounds.isEmpty)
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
    private const val READY_TEXT = "Solid Native safe area ready"
    private const val TOP_ANCHOR_LABEL = "Solid Native safe area top anchor"
    private const val BOTTOM_ANCHOR_LABEL = "Solid Native safe area bottom anchor"
    private const val DISPOSE_LABEL = "Dispose Solid Native safe area proof"
    private const val READY_TIMEOUT_MS = 10_000L
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
