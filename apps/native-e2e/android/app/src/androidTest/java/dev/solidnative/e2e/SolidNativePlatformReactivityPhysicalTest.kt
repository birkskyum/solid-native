package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
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
class SolidNativePlatformReactivityPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val uiAutomation = instrumentation.uiAutomation
  private val arguments = InstrumentationRegistry.getArguments()

  @Test
  fun testOrientationAndSystemAppearanceReachSolidAndFabricOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val originalNightMode = requiredNightModeArgument()
    val activity = launchApplication()
    val originalNightEnabled = nightEnabled(activity)

    try {
      waitForText(READY_TEXT)
      assertWindowSnapshot(activity, waitForWindow("portrait"), portrait = true)
      waitForText(appearanceText(originalNightEnabled))

      val initialWindowMarkers = countLogMarker(WINDOW_CAUSALITY_MARKER)
      requestOrientation(activity, ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)
      waitForOrientation(activity, Configuration.ORIENTATION_LANDSCAPE)
      tapControl(COMMIT_LABEL)
      assertWindowSnapshot(activity, waitForWindow("landscape"), portrait = false)
      waitForLogMarkerCount(WINDOW_CAUSALITY_MARKER, initialWindowMarkers + 1)

      requestOrientation(activity, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)
      waitForOrientation(activity, Configuration.ORIENTATION_PORTRAIT)
      tapControl(COMMIT_LABEL)
      assertWindowSnapshot(activity, waitForWindow("portrait"), portrait = true)
      waitForLogMarkerCount(WINDOW_CAUSALITY_MARKER, initialWindowMarkers + 2)

      val initialAppearanceMarkers = countLogMarker(APPEARANCE_CAUSALITY_MARKER)
      setNightMode(if (originalNightEnabled) "no" else "yes")
      waitForNight(activity, !originalNightEnabled)
      tapControl(COMMIT_LABEL)
      waitForText(appearanceText(!originalNightEnabled))
      waitForLogMarkerCount(
          APPEARANCE_CAUSALITY_MARKER,
          initialAppearanceMarkers + 1,
      )

      setNightMode(originalNightMode)
      waitForNight(activity, originalNightEnabled)
      tapControl(COMMIT_LABEL)
      waitForText(appearanceText(originalNightEnabled))
      waitForLogMarkerCount(
          APPEARANCE_CAUSALITY_MARKER,
          initialAppearanceMarkers + 2,
      )

      tapControl(DISPOSE_LABEL)
      waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
      waitForLogMarker(TEARDOWN_MARKER)
      instrumentation.runOnMainSync {
        assertFalse("The host Activity finished during platform teardown.", activity.isFinishing)
        assertFalse("The host Activity was destroyed during platform teardown.", activity.isDestroyed)
      }
    } finally {
      requestOrientation(activity, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)
      setNightMode(originalNightMode)
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

  private fun requiredNightModeArgument(): String {
    val mode =
        checkNotNull(arguments.getString(NIGHT_MODE_ARGUMENT)) {
          "Missing instrumentation argument $NIGHT_MODE_ARGUMENT."
        }
    assertTrue("Unsupported original Android night mode $mode.", NIGHT_MODES.contains(mode))
    return mode
  }

  private fun requestOrientation(activity: Activity, orientation: Int) {
    instrumentation.runOnMainSync { activity.requestedOrientation = orientation }
  }

  private fun waitForOrientation(activity: Activity, expected: Int) {
    val deadline = SystemClock.uptimeMillis() + CONFIGURATION_TIMEOUT_MS
    var stableSince = 0L
    while (SystemClock.uptimeMillis() < deadline) {
      var decorWidth = 0
      var decorHeight = 0
      instrumentation.runOnMainSync {
        decorWidth = activity.window.decorView.width
        decorHeight = activity.window.decorView.height
      }
      val decorMatches =
          if (expected == Configuration.ORIENTATION_LANDSCAPE) {
            decorWidth > decorHeight
          } else {
            decorHeight > decorWidth
          }
      if (activity.resources.configuration.orientation == expected && decorMatches) {
        if (stableSince == 0L) stableSince = SystemClock.uptimeMillis()
        if (SystemClock.uptimeMillis() - stableSince >= ROTATION_SETTLE_MS) {
          instrumentation.waitForIdleSync()
          return
        }
      } else {
        stableSince = 0L
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("Android did not deliver Activity orientation $expected.")
  }

  private fun setNightMode(mode: String) {
    assertTrue("Unsupported Android night mode $mode.", NIGHT_MODES.contains(mode))
    readShell("cmd uimode night $mode")
  }

  private fun waitForNight(activity: Activity, expected: Boolean) {
    val deadline = SystemClock.uptimeMillis() + CONFIGURATION_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      if (nightEnabled(activity) == expected) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("Android did not deliver the expected system appearance.")
  }

  private fun nightEnabled(activity: Activity): Boolean =
      activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
          Configuration.UI_MODE_NIGHT_YES

  private fun appearanceText(nightEnabled: Boolean): String =
      "Appearance ${if (nightEnabled) "dark" else "light"}"

  private fun waitForWindow(orientation: String): WindowSnapshot {
    val node = waitForNode(PROOF_TIMEOUT_MS) { node ->
      node.text?.toString()?.startsWith("Window $orientation ") == true
    }
    val text = checkNotNull(node.text?.toString())
    val match = checkNotNull(WINDOW_TEXT.matchEntire(text)) { "Malformed window proof text: $text" }
    return WindowSnapshot(
        orientation = match.groupValues[1],
        width = match.groupValues[2].toDouble(),
        height = match.groupValues[3].toDouble(),
        scale = match.groupValues[4].toDouble(),
        fontScale = match.groupValues[5].toDouble(),
    )
  }

  private fun assertWindowSnapshot(
      activity: Activity,
      snapshot: WindowSnapshot,
      portrait: Boolean,
  ) {
    assertEquals(if (portrait) "portrait" else "landscape", snapshot.orientation)
    assertTrue("The native window width was not positive.", snapshot.width > 0.0)
    assertTrue("The native window height was not positive.", snapshot.height > 0.0)
    assertEquals(
        "The Solid window orientation disagreed with Android.",
        portrait,
        snapshot.height > snapshot.width,
    )
    assertEquals(
        activity.resources.displayMetrics.density.toDouble(),
        snapshot.scale,
        METRIC_TOLERANCE,
    )
    assertEquals(
        activity.resources.configuration.fontScale.toDouble(),
        snapshot.fontScale,
        METRIC_TOLERANCE,
    )
  }

  private fun tapControl(label: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) { it.contentDescription?.toString() == label }
    assertTrue("The platform control $label was not clickable.", control.isClickable)
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
    fail("The expected platform-reactivity proof node did not appear.")
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
    fail("The platform-reactivity proof tree survived owner teardown.")
  }

  private fun waitForLogMarker(marker: String) {
    waitForLogMarkerCount(marker, 1)
  }

  private fun waitForLogMarkerCount(marker: String, expectedCount: Int) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readProofLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The platform-reactivity proof emitted its JavaScript failure marker.")
      }
      if (logs.lineSequence().count { it.contains(marker) } >= expectedCount) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The platform-reactivity proof omitted marker $marker occurrence $expectedCount.")
  }

  private fun countLogMarker(marker: String): Int =
      readProofLogs().lineSequence().count { it.contains(marker) }

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
    assertFalse("The platform control had empty physical bounds.", bounds.isEmpty)
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

  private data class WindowSnapshot(
      val orientation: String,
      val width: Double,
      val height: Double,
      val scale: Double,
      val fontScale: Double,
  )

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native platform reactivity ready"
    private const val COMMIT_LABEL = "Commit native platform change"
    private const val DISPOSE_LABEL = "Dispose Solid Native platform reactivity proof"
    private const val NIGHT_MODE_ARGUMENT = "original_night_mode"
    private const val FAILURE_MARKER = "SOLID_NATIVE_PLATFORM_REACTIVITY_FAILED"
    private const val WINDOW_CAUSALITY_MARKER =
        "SOLID_NATIVE_PLATFORM_WINDOW_CAUSALITY_SUCCEEDED"
    private const val APPEARANCE_CAUSALITY_MARKER =
        "SOLID_NATIVE_PLATFORM_APPEARANCE_CAUSALITY_SUCCEEDED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_PLATFORM_REACTIVITY_TEARDOWN_SUCCEEDED"
    private val NIGHT_MODES =
        setOf("yes", "no", "auto", "custom_schedule", "custom_bedtime")
    private val WINDOW_TEXT =
        Regex(
            "Window (portrait|landscape) ([0-9]+(?:\\.[0-9]+)?)x([0-9]+(?:\\.[0-9]+)?) scale ([0-9]+(?:\\.[0-9]+)?) font ([0-9]+(?:\\.[0-9]+)?)"
        )
    private const val METRIC_TOLERANCE = 0.02
    private const val PROOF_TIMEOUT_MS = 15_000L
    private const val CONFIGURATION_TIMEOUT_MS = 10_000L
    private const val ROTATION_SETTLE_MS = 750L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
