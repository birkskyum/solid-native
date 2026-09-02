package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
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
class SolidNativeLocalizationPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testLTRStartupSnapshotAndPhysicalLayout() {
    verifyStartupSnapshotAndLayout(
        expectedLocale = LTR_LOCALE,
        expectedDirection = "ltr",
        expectedNativeDirection = View.LAYOUT_DIRECTION_LTR,
        leadingShouldBeLeft = true,
    )
  }

  @Test
  fun testRTLStartupSnapshotAndPhysicalLayout() {
    verifyStartupSnapshotAndLayout(
        expectedLocale = RTL_LOCALE,
        expectedDirection = "rtl",
        expectedNativeDirection = View.LAYOUT_DIRECTION_RTL,
        leadingShouldBeLeft = false,
    )
  }

  private fun verifyStartupSnapshotAndLayout(
      expectedLocale: String,
      expectedDirection: String,
      expectedNativeDirection: Int,
      leadingShouldBeLeft: Boolean,
  ) {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT)
    waitForText("Locale $expectedLocale")
    waitForText("Direction $expectedDirection")
    waitForText(SWAPPING_TEXT)

    instrumentation.runOnMainSync {
      assertEquals(
          "The Activity did not start with the configured application locale.",
          expectedLocale,
          activity.resources.configuration.locales[0].toLanguageTag(),
      )
      assertEquals(
          "The Android decor view did not receive the expected layout direction.",
          expectedNativeDirection,
          activity.window.decorView.layoutDirection,
      )
    }

    val leading = waitForControl(LEADING_MARKER_LABEL)
    val trailing = waitForControl(TRAILING_MARKER_LABEL)
    val leadingBounds = Rect().also(leading::getBoundsInScreen)
    val trailingBounds = Rect().also(trailing::getBoundsInScreen)
    assertFalse("The leading localization marker had empty bounds.", leadingBounds.isEmpty)
    assertFalse("The trailing localization marker had empty bounds.", trailingBounds.isEmpty)
    if (leadingShouldBeLeft) {
      assertTrue(
          "The LTR Fabric row did not place its leading child left of its trailing child.",
          leadingBounds.centerX() < trailingBounds.centerX(),
      )
    } else {
      assertTrue(
          "The RTL Fabric row did not mirror its leading and trailing children.",
          leadingBounds.centerX() > trailingBounds.centerX(),
      )
    }

    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    waitForTeardownAcknowledgement(expectedLocale, expectedDirection)
    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during localization teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during localization teardown.", activity.isDestroyed)
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

  private fun tapControl(label: String) {
    val control = waitForControl(label)
    assertTrue("The localization control $label was not clickable.", control.isClickable)
    tapCenter(control)
  }

  private fun waitForControl(label: String): AccessibilityNodeInfo =
      waitForNode(PROOF_TIMEOUT_MS) { it.contentDescription?.toString() == label }

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
    fail("The expected native localization accessibility node did not appear.")
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
    fail("The localization accessibility tree survived surface teardown.")
  }

  private fun waitForTeardownAcknowledgement(expectedLocale: String, expectedDirection: String) {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The native localization proof emitted its JavaScript failure marker.")
      }
      if (
          logs.contains(READY_MARKER) &&
              logs.contains(expectedLocale) &&
              logs.contains(expectedDirection) &&
              logs.contains(TEARDOWN_MARKER)
      ) {
        return
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native localization proof did not acknowledge its exact snapshot and teardown.")
  }

  private fun readReactNativeJsLogs(): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              instrumentation.uiAutomation.executeShellCommand(
                  "logcat -d -v brief -s ReactNativeJS:I"
              )
          )
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
    assertFalse("The localization control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject localization touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject localization touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val LTR_LOCALE = "en-US"
    private const val RTL_LOCALE = "ar-SA"
    private const val READY_TEXT = "Solid Native localization ready"
    private const val LEADING_MARKER_LABEL = "Localization leading marker"
    private const val TRAILING_MARKER_LABEL = "Localization trailing marker"
    private const val DISPOSE_LABEL = "Dispose Solid Native localization proof"
    private const val SWAPPING_TEXT = "RTL style swapping enabled"
    private const val FAILURE_MARKER = "SOLID_NATIVE_LOCALIZATION_FAILED"
    private const val READY_MARKER = "SOLID_NATIVE_LOCALIZATION_READY"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_LOCALIZATION_TEARDOWN_SUCCEEDED"
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
