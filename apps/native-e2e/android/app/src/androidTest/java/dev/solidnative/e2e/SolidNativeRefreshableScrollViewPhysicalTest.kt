package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.swiperefresh.ReactSwipeRefreshLayout
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SolidNativeRefreshableScrollViewPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testControlledPullToRefreshOnPhysicalDevice() {
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    val retainedTree = waitForRefreshTree(activity)

    injectPull(retainedTree.refreshControl)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == REJECTED_TEXT }
    waitForRefreshing(activity, retainedTree, false)

    injectPull(retainedTree.refreshControl)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == ACCEPTED_TEXT }
    waitForRefreshing(activity, retainedTree, true)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == COMPLETED_TEXT }
    waitForRefreshing(activity, retainedTree, false)

    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == DISPOSE_LABEL
    }
    assertTrue("The pull-to-refresh teardown control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    waitForLogMarker(TEARDOWN_TIMEOUT_MS, TEARDOWN_MARKER)
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

  private fun waitForRefreshTree(activity: Activity): RefreshTree {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var result: RefreshTree? = null
      instrumentation.runOnMainSync {
        val refreshControl =
            findAndroidView(activity.window.decorView) { it is ReactSwipeRefreshLayout }
                as? ReactSwipeRefreshLayout
        val scrollView =
            refreshControl?.let { control ->
              findAndroidView(control) { it is ReactScrollView } as? ReactScrollView
            }
        if (
            refreshControl != null &&
                scrollView != null &&
                refreshControl.width > 0 &&
                refreshControl.height > 0 &&
                scrollView.width > 0 &&
                scrollView.height > 0
        ) {
          assertTrue("The native refresh control was disabled.", refreshControl.isEnabled)
          assertTrue(
              "The backing ScrollView was not mounted below the native refresh control.",
              isDescendant(refreshControl, scrollView),
          )
          assertFalse("The refresh indicator started active.", refreshControl.isRefreshing)
          result = RefreshTree(refreshControl, scrollView)
        }
      }
      if (result != null) return result!!
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The AndroidSwipeRefreshLayout and backing ScrollView did not mount with geometry.")
    throw AssertionError("unreachable")
  }

  private fun waitForRefreshing(
      activity: Activity,
      retained: RefreshTree,
      expected: Boolean,
  ) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var matched = false
      instrumentation.runOnMainSync {
        val refreshControl =
            findAndroidView(activity.window.decorView) { it is ReactSwipeRefreshLayout }
                as? ReactSwipeRefreshLayout
        val scrollView =
            refreshControl?.let { control ->
              findAndroidView(control) { it is ReactScrollView } as? ReactScrollView
            }
        if (refreshControl != null && scrollView != null) {
          assertSame("The controlled refresh replaced its native wrapper.", retained.refreshControl, refreshControl)
          assertSame("The controlled refresh replaced its backing ScrollView.", retained.scrollView, scrollView)
          matched = refreshControl.isRefreshing == expected
        }
      }
      if (matched) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native refresh indicator did not settle to $expected.")
  }

  private fun injectPull(refreshControl: ReactSwipeRefreshLayout) {
    val bounds = Rect()
    instrumentation.runOnMainSync {
      assertTrue(
          "The native refresh control had no visible physical bounds.",
          refreshControl.getGlobalVisibleRect(bounds),
      )
    }
    val x = bounds.exactCenterX()
    val startY = bounds.top + bounds.height() / 4f
    val endY = bounds.top + bounds.height() * 3f / 4f
    assertTrue("The pull-to-refresh gesture had insufficient vertical distance.", endY - startY > 240f)

    val command =
        "input touchscreen swipe ${x.toInt()} ${startY.toInt()} ${x.toInt()} ${endY.toInt()} $PULL_DURATION_MS"
    val descriptor = instrumentation.uiAutomation.executeShellCommand(command)
    ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { stream ->
      val buffer = ByteArray(128)
      while (stream.read(buffer) >= 0) {
        // Drain the shell command so the gesture is complete before observing state.
      }
    }
    instrumentation.waitForIdleSync()
  }

  private fun injectMotion(event: MotionEvent) {
    event.source = InputDevice.SOURCE_TOUCHSCREEN
    try {
      assertTrue(
          "The Android runner could not inject the pull-to-refresh gesture.",
          instrumentation.uiAutomation.injectInputEvent(event, true),
      )
    } finally {
      event.recycle()
    }
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
    fail("The expected pull-to-refresh accessibility node did not appear.")
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
    fail("The pull-to-refresh accessibility tree survived owner teardown.")
  }

  private fun waitForLogMarker(timeoutMilliseconds: Long, marker: String) {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      val descriptor =
          instrumentation.uiAutomation.executeShellCommand(
              "logcat -d -v brief ReactNativeJS:I '*:S'"
          )
      val logs =
          ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use {
            it.readText()
          }
      if (logs.contains(marker)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The pull-to-refresh application did not publish terminal teardown evidence.")
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

  private fun tapCenter(node: AccessibilityNodeInfo) {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertFalse("The pull-to-refresh teardown control had empty bounds.", bounds.isEmpty)
    val downTime = SystemClock.uptimeMillis()
    injectMotion(
        MotionEvent.obtain(
            downTime,
            downTime,
            MotionEvent.ACTION_DOWN,
            bounds.exactCenterX(),
            bounds.exactCenterY(),
            0,
        )
    )
    SystemClock.sleep(TAP_DURATION_MS)
    injectMotion(
        MotionEvent.obtain(
            downTime,
            SystemClock.uptimeMillis(),
            MotionEvent.ACTION_UP,
            bounds.exactCenterX(),
            bounds.exactCenterY(),
            0,
        )
    )
  }

  private data class RefreshTree(
      val refreshControl: ReactSwipeRefreshLayout,
      val scrollView: ReactScrollView,
  )

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native pull to refresh ready"
    private const val REJECTED_TEXT = "Rejected native refresh 1"
    private const val ACCEPTED_TEXT = "Accepted native refresh 2"
    private const val COMPLETED_TEXT = "Completed native refresh 2"
    private const val DISPOSE_LABEL = "Dispose Solid Native pull to refresh proof"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_REFRESHABLE_SCROLL_TEARDOWN_SUCCEEDED"
    private const val READY_TIMEOUT_MS = 10_000L
    private const val PROOF_TIMEOUT_MS = 12_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val PULL_DURATION_MS = 600
    private const val TAP_DURATION_MS = 50L
  }
}
