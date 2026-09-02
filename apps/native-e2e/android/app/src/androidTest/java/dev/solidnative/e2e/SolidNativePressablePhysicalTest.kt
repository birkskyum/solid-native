package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.RippleDrawable
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.ScrollView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlin.math.abs
import kotlin.math.roundToInt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SolidNativePressablePhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private var activeGesture: ActiveGesture? = null

  @Test
  fun testRetainedRegionCancellationScrollTakeoverAndNativeRippleOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT)

    try {
      verifyDiagonalRetainedRegion(activity)
      verifyCancellationAndRecovery(activity)
      verifyNativeRipple(activity)
      verifyScrollViewTakeover(activity)
    } finally {
      cancelActiveGesture()
    }

    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    waitForTeardownAcknowledgement()

    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during Pressable teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during Pressable teardown.", activity.isDestroyed)
    }
  }

  private fun verifyDiagonalRetainedRegion(activity: Activity) {
    val node = waitForControl(RETENTION_LABEL)
    val bounds = bounds(node, "The retained-region target had empty physical bounds.")
    val target = waitForNativeView(activity, RETENTION_LABEL)
    val density = activity.resources.displayMetrics.density
    val centerX = bounds.exactCenterX()
    val centerY = bounds.exactCenterY()
    val downTime = SystemClock.uptimeMillis()

    inject(downTime, downTime, MotionEvent.ACTION_DOWN, centerX, centerY)
    waitForCounts("Retention", ins = 1, outs = 0, presses = 0)
    SystemClock.sleep(GESTURE_STEP_MS)

    var eventStep =
        moveGesture(
            downTime,
            centerX,
            centerY,
            bounds.right + 16f * density,
            bounds.bottom + 16f * density,
            firstStep = 1,
            steps = RETENTION_MOVE_STEPS,
        )
    waitForCounts("Retention", ins = 1, outs = 0, presses = 0, minimumMoves = 1)

    eventStep =
        moveGesture(
            downTime,
            bounds.right + 16f * density,
            bounds.bottom + 16f * density,
            bounds.right + 48f * density,
            bounds.bottom + 48f * density,
            firstStep = eventStep,
            steps = RETENTION_BOUNDARY_STEPS,
        )
    waitForCounts("Retention", ins = 1, outs = 1, presses = 0, minimumMoves = 2)

    eventStep =
        moveGesture(
            downTime,
            bounds.right + 48f * density,
            bounds.bottom + 48f * density,
            centerX,
            centerY,
            firstStep = eventStep,
            steps = RETENTION_MOVE_STEPS,
        )
    waitForCounts("Retention", ins = 2, outs = 1, presses = 0, minimumMoves = 3)

    inject(
        downTime,
        downTime + eventStep * GESTURE_STEP_MS,
        MotionEvent.ACTION_UP,
        centerX,
        centerY,
    )
    waitForCounts("Retention", ins = 2, outs = 2, presses = 1, minimumMoves = 3)
    waitForNativePressed(target, false)
  }

  private fun verifyCancellationAndRecovery(activity: Activity) {
    val node = waitForControl(CANCEL_LABEL)
    val bounds = bounds(node, "The cancellation target had empty physical bounds.")
    val centerX = bounds.exactCenterX()
    val centerY = bounds.exactCenterY()
    val downTime = SystemClock.uptimeMillis()

    inject(downTime, downTime, MotionEvent.ACTION_DOWN, centerX, centerY)
    waitForCounts("Cancellation", ins = 1, outs = 0, presses = 0)
    inject(
        downTime,
        downTime + GESTURE_STEP_MS,
        MotionEvent.ACTION_CANCEL,
        centerX,
        centerY,
    )
    waitForCounts("Cancellation", ins = 1, outs = 1, presses = 0)

    tapCenter(node)
    waitForCounts("Cancellation", ins = 2, outs = 2, presses = 1)
    val target = waitForNativeView(activity, CANCEL_LABEL)
    waitForNativePressed(target, false)
  }

  private fun verifyNativeRipple(activity: Activity) {
    val node = waitForControl(RIPPLE_LABEL)
    val bounds = bounds(node, "The native ripple target had empty physical bounds.")
    val target = waitForNativeView(activity, RIPPLE_LABEL)
    val ripple = nativeForegroundRipple(target)
    val expectedRadius = (36f * activity.resources.displayMetrics.density).roundToInt()
    assertTrue(
        "The mounted Android RippleDrawable did not retain the configured density-scaled radius.",
        abs(ripple.radius - expectedRadius) <= 2,
    )

    val before = takeScreenshot()
    val centerX = bounds.exactCenterX()
    val centerY = bounds.exactCenterY()
    val downTime = SystemClock.uptimeMillis()
    inject(downTime, downTime, MotionEvent.ACTION_DOWN, centerX, centerY)
    waitForCounts("Ripple", ins = 1, outs = 0, presses = 0)
    waitForNativePressed(target, true)
    SystemClock.sleep(RIPPLE_SETTLE_MS)
    val during = takeScreenshot()
    val visualDelta = meanColorDelta(before, during, bounds)
    assertTrue(
        "The physical foreground ripple did not change rendered pixels (mean delta=$visualDelta).",
        visualDelta >= MINIMUM_RIPPLE_COLOR_DELTA,
    )

    inject(
        downTime,
        downTime + RIPPLE_SETTLE_MS + GESTURE_STEP_MS,
        MotionEvent.ACTION_UP,
        centerX,
        centerY,
    )
    waitForCounts("Ripple", ins = 1, outs = 1, presses = 1)
    waitForNativePressed(target, false)
  }

  private fun verifyScrollViewTakeover(activity: Activity) {
    val node = waitForControl(SCROLL_LABEL)
    val bounds = bounds(node, "The ScrollView takeover target had empty physical bounds.")
    val target = waitForNativeView(activity, SCROLL_LABEL)
    val scrollView = findAncestorScrollView(target)
    var initialScrollY = -1
    instrumentation.runOnMainSync { initialScrollY = scrollView.scrollY }
    assertEquals("The takeover ScrollView did not start at its leading edge.", 0, initialScrollY)

    val density = activity.resources.displayMetrics.density
    val centerX = bounds.exactCenterX()
    val startY = bounds.exactCenterY()
    val endY = startY - 112f * density
    val downTime = SystemClock.uptimeMillis()
    inject(downTime, downTime, MotionEvent.ACTION_DOWN, centerX, startY)
    waitForCounts("Scroll", ins = 1, outs = 0, presses = 0)
    for (step in 1..SCROLL_STEPS) {
      val fraction = step / SCROLL_STEPS.toFloat()
      inject(
          downTime,
          downTime + step * GESTURE_STEP_MS,
          MotionEvent.ACTION_MOVE,
          centerX,
          startY + (endY - startY) * fraction,
      )
      SystemClock.sleep(GESTURE_STEP_MS)
    }
    inject(
        downTime,
        downTime + (SCROLL_STEPS + 1) * GESTURE_STEP_MS,
        MotionEvent.ACTION_UP,
        centerX,
        endY,
    )

    waitForScrollOffset(scrollView)
    waitForCounts("Scroll", ins = 1, outs = 1, presses = 0)
    waitForNativePressed(target, false)
  }

  private fun launchApplication(): Activity {
    val launchIntent =
        checkNotNull(instrumentation.targetContext.packageManager.getLaunchIntentForPackage(APP_ID))
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
    val activity = instrumentation.startActivitySync(launchIntent)
    instrumentation.waitForIdleSync()
    return activity
  }

  private fun waitForControl(label: String): AccessibilityNodeInfo {
    val control = waitForNode(PROOF_TIMEOUT_MS) { it.contentDescription?.toString() == label }
    assertTrue("The Pressable control $label was not clickable.", control.isClickable)
    return control
  }

  private fun tapControl(label: String) {
    tapCenter(waitForControl(label))
  }

  private fun waitForText(text: String): AccessibilityNodeInfo =
      waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == text }

  private fun waitForCounts(
      prefix: String,
      ins: Int,
      outs: Int,
      presses: Int,
      minimumMoves: Int = 0,
  ): Counts {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    var last: Counts? = null
    while (SystemClock.uptimeMillis() < deadline) {
      val node =
          findNode(instrumentation.uiAutomation.rootInActiveWindow) {
            it.text?.toString()?.startsWith("$prefix in=") == true
          }
      val parsed = node?.text?.toString()?.let(::parseCounts)
      if (parsed != null) {
        last = parsed
        if (
            parsed.ins == ins &&
                parsed.outs == outs &&
                parsed.presses == presses &&
                parsed.moves >= minimumMoves
        ) {
          return parsed
        }
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The $prefix Pressable state did not become in=$ins out=$outs move>=$minimumMoves press=$presses; last=$last."
    )
    throw AssertionError("unreachable")
  }

  private fun parseCounts(text: String): Counts? {
    val match = COUNTS_PATTERN.matchEntire(text) ?: return null
    return Counts(
        ins = match.groupValues[2].toInt(),
        outs = match.groupValues[3].toInt(),
        moves = match.groupValues[4].toInt(),
        presses = match.groupValues[5].toInt(),
    )
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
    fail("The expected native Pressable accessibility node did not appear.")
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
    fail("The Pressable accessibility tree survived owner teardown.")
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

  private fun waitForNativeView(activity: Activity, label: String): View {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var found: View? = null
      instrumentation.runOnMainSync {
        found = findView(activity.window.decorView) { it.contentDescription?.toString() == label }
      }
      if (found != null) return checkNotNull(found)
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native Android view for $label did not appear.")
    throw AssertionError("unreachable")
  }

  private fun findView(root: View, predicate: (View) -> Boolean): View? {
    if (predicate(root)) return root
    if (root !is ViewGroup) return null
    for (index in 0 until root.childCount) {
      val found = findView(root.getChildAt(index), predicate)
      if (found != null) return found
    }
    return null
  }

  private fun nativeForegroundRipple(target: View): RippleDrawable {
    var drawable: RippleDrawable? = null
    instrumentation.runOnMainSync { drawable = target.foreground as? RippleDrawable }
    assertNotNull("The Pressable did not mount a native foreground RippleDrawable.", drawable)
    return checkNotNull(drawable)
  }

  private fun findAncestorScrollView(target: View): ScrollView {
    var current = target.parent
    while (current != null) {
      if (current is ScrollView) return current
      current = current.parent
    }
    fail("The takeover Pressable was not mounted inside an Android ScrollView.")
    throw AssertionError("unreachable")
  }

  private fun waitForNativePressed(target: View, expected: Boolean) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    var actual = false
    while (SystemClock.uptimeMillis() < deadline) {
      instrumentation.runOnMainSync { actual = target.isPressed }
      if (actual == expected) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native Android Pressable pressed state was $actual instead of $expected.")
  }

  private fun waitForScrollOffset(scrollView: ScrollView) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    var offset = 0
    while (SystemClock.uptimeMillis() < deadline) {
      instrumentation.runOnMainSync { offset = scrollView.scrollY }
      if (offset > 0) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The Android ScrollView did not take over and produce a native scroll offset.")
  }

  private fun bounds(node: AccessibilityNodeInfo, message: String): Rect {
    val result = Rect()
    node.getBoundsInScreen(result)
    assertFalse(message, result.isEmpty)
    return result
  }

  private fun tapCenter(node: AccessibilityNodeInfo) {
    val targetBounds = bounds(node, "The Pressable control had empty physical bounds.")
    val downTime = SystemClock.uptimeMillis()
    inject(
        downTime,
        downTime,
        MotionEvent.ACTION_DOWN,
        targetBounds.exactCenterX(),
        targetBounds.exactCenterY(),
    )
    SystemClock.sleep(TAP_DURATION_MS)
    inject(
        downTime,
        downTime + TAP_DURATION_MS,
        MotionEvent.ACTION_UP,
        targetBounds.exactCenterX(),
        targetBounds.exactCenterY(),
    )
  }

  private fun inject(
      downTime: Long,
      eventTime: Long,
      action: Int,
      x: Float,
      y: Float,
  ) {
    when (action) {
      MotionEvent.ACTION_DOWN -> activeGesture = ActiveGesture(downTime, x, y)
      MotionEvent.ACTION_MOVE,
      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL ->
          activeGesture?.takeIf { it.downTime == downTime }?.also {
            it.x = x
            it.y = y
          }
    }
    val event = MotionEvent.obtain(downTime, eventTime, action, x, y, 0)
    event.source = InputDevice.SOURCE_TOUCHSCREEN
    try {
      val injected = instrumentation.uiAutomation.injectInputEvent(event, true)
      if (
          injected &&
              (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL)
      ) {
        activeGesture = null
      }
      assertTrue(
          "The Android runner did not inject ${MotionEvent.actionToString(action)}.",
          injected,
      )
    } finally {
      event.recycle()
    }
  }

  private fun cancelActiveGesture() {
    val gesture = activeGesture ?: return
    val now = SystemClock.uptimeMillis()
    val event =
        MotionEvent.obtain(
            gesture.downTime,
            now.coerceAtLeast(gesture.downTime),
            MotionEvent.ACTION_CANCEL,
            gesture.x,
            gesture.y,
            0,
        )
    event.source = InputDevice.SOURCE_TOUCHSCREEN
    try {
      instrumentation.uiAutomation.injectInputEvent(event, true)
    } finally {
      event.recycle()
      activeGesture = null
    }
  }

  private fun moveGesture(
      downTime: Long,
      fromX: Float,
      fromY: Float,
      toX: Float,
      toY: Float,
      firstStep: Int,
      steps: Int,
  ): Int {
    for (offset in 0 until steps) {
      val fraction = (offset + 1) / steps.toFloat()
      val eventStep = firstStep + offset
      inject(
          downTime,
          downTime + eventStep * GESTURE_STEP_MS,
          MotionEvent.ACTION_MOVE,
          fromX + (toX - fromX) * fraction,
          fromY + (toY - fromY) * fraction,
      )
      SystemClock.sleep(GESTURE_STEP_MS)
    }
    return firstStep + steps
  }

  private fun takeScreenshot(): Bitmap {
    instrumentation.waitForIdleSync()
    return checkNotNull(instrumentation.uiAutomation.takeScreenshot())
  }

  private fun meanColorDelta(before: Bitmap, during: Bitmap, bounds: Rect): Double {
    assertEquals("Ripple screenshots had different widths.", before.width, during.width)
    assertEquals("Ripple screenshots had different heights.", before.height, during.height)
    val inset = (bounds.width().coerceAtMost(bounds.height()) / 5).coerceAtLeast(2)
    val left = (bounds.left + inset).coerceIn(0, before.width - 1)
    val right = (bounds.right - inset).coerceIn(left + 1, before.width)
    val top = (bounds.top + inset).coerceIn(0, before.height - 1)
    val bottom = (bounds.bottom - inset).coerceIn(top + 1, before.height)
    var difference = 0L
    var samples = 0L
    for (y in top until bottom step SCREENSHOT_SAMPLE_STRIDE) {
      for (x in left until right step SCREENSHOT_SAMPLE_STRIDE) {
        val first = before.getPixel(x, y)
        val second = during.getPixel(x, y)
        difference += abs(Color.red(first) - Color.red(second))
        difference += abs(Color.green(first) - Color.green(second))
        difference += abs(Color.blue(first) - Color.blue(second))
        samples += 3
      }
    }
    before.recycle()
    during.recycle()
    return difference.toDouble() / samples.coerceAtLeast(1)
  }

  private fun waitForTeardownAcknowledgement() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readShell("logcat -d -v brief -s ReactNativeJS:I")
      if (logs.contains(FAILURE_MARKER)) {
        fail("The native Pressable proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native Pressable proof did not acknowledge terminal surface teardown.")
  }

  private fun readShell(command: String): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              instrumentation.uiAutomation.executeShellCommand(command)
          )
          .bufferedReader()
          .use { it.readText() }

  private data class Counts(
      val ins: Int,
      val outs: Int,
      val moves: Int,
      val presses: Int,
  )

  private data class ActiveGesture(
      val downTime: Long,
      var x: Float,
      var y: Float,
  )

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native Pressable ready"
    private const val RETENTION_LABEL = "Diagonal retained-region Pressable"
    private const val CANCEL_LABEL = "Cancellation recovery Pressable"
    private const val RIPPLE_LABEL = "Native foreground ripple Pressable"
    private const val SCROLL_LABEL = "Scroll takeover Pressable"
    private const val DISPOSE_LABEL = "Dispose Solid Native Pressable proof"
    private const val FAILURE_MARKER = "SOLID_NATIVE_PRESSABLE_FAILED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_PRESSABLE_TEARDOWN_SUCCEEDED"
    private val COUNTS_PATTERN = Regex("^(Retention|Cancellation|Ripple|Scroll) in=(\\d+) out=(\\d+) move=(\\d+) press=(\\d+)(?: y=\\d+)?$")
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
    private const val GESTURE_STEP_MS = 32L
    private const val RIPPLE_SETTLE_MS = 120L
    private const val RETENTION_MOVE_STEPS = 8
    private const val RETENTION_BOUNDARY_STEPS = 4
    private const val SCROLL_STEPS = 10
    private const val SCREENSHOT_SAMPLE_STRIDE = 3
    private const val MINIMUM_RIPPLE_COLOR_DELTA = 3.0
  }
}
