package dev.solidnative.e2e

import android.app.Activity
import android.content.Intent
import android.graphics.Rect
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.accessibility.AccessibilityEvent
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
class SolidNativeAccessibilityPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val uiAutomation = instrumentation.uiAutomation
  private val arguments = InstrumentationRegistry.getArguments()

  @Test
  fun testPreferenceDeliveryAnnouncementAndOwnerTeardownOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val originalTransitionScale = requiredSettingArgument(TRANSITION_ARGUMENT)
    val originalHighContrast = requiredSettingArgument(HIGH_CONTRAST_ARGUMENT)
    val originalReduceMotionEnabled = transitionScaleIsZero(originalTransitionScale)
    val originalHighContrastEnabled = settingIsEnabled(originalHighContrast)

    val activity = launchApplication()
    try {
      waitForText(READY_TEXT)
      waitForText(preferenceSummary(originalReduceMotionEnabled))
      waitForText(platformSummary(originalHighContrastEnabled))
      waitForLogMarker(TIMEOUT_MARKER)

      exercisePreference(
          namespace = "global",
          key = "transition_animation_scale",
          originalValue = originalTransitionScale,
          changedValue = if (originalReduceMotionEnabled) "1" else "0",
          expectedChangedSummary = preferenceSummary(!originalReduceMotionEnabled),
          expectedRestoredSummary = preferenceSummary(originalReduceMotionEnabled),
      )
      exercisePreference(
          namespace = "secure",
          key = "high_text_contrast_enabled",
          originalValue = originalHighContrast,
          changedValue = if (originalHighContrastEnabled) "0" else "1",
          expectedChangedSummary = platformSummary(!originalHighContrastEnabled),
          expectedRestoredSummary = platformSummary(originalHighContrastEnabled),
      )

      val refreshMarkers = countLogMarker(REFRESH_MARKER)
      tapControl(REFRESH_LABEL)
      waitForLogMarkerCount(REFRESH_MARKER, refreshMarkers + 1)

      val announcement =
          uiAutomation.executeAndWaitForEvent(
              { tapControl(ANNOUNCE_LABEL) },
              { event ->
                event.eventType == AccessibilityEvent.TYPE_ANNOUNCEMENT &&
                    event.packageName?.toString() == APP_ID &&
                    event.text.any { it?.toString() == READY_TEXT }
              },
              PROOF_TIMEOUT_MS,
          )
      assertEquals(AccessibilityEvent.TYPE_ANNOUNCEMENT, announcement.eventType)
      assertEquals(APP_ID, announcement.packageName?.toString())
      assertTrue(announcement.text.any { it?.toString() == READY_TEXT })
      waitForLogMarker(ANNOUNCED_MARKER)

      tapControl(DISPOSE_LABEL)
      waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
      waitForLogMarker(TEARDOWN_MARKER)
      instrumentation.runOnMainSync {
        assertFalse("The host Activity finished during accessibility teardown.", activity.isFinishing)
        assertFalse("The host Activity was destroyed during accessibility teardown.", activity.isDestroyed)
      }
    } finally {
      restoreSetting("global", "transition_animation_scale", originalTransitionScale)
      restoreSetting("secure", "high_text_contrast_enabled", originalHighContrast)
    }
  }

  private fun exercisePreference(
      namespace: String,
      key: String,
      originalValue: String,
      changedValue: String,
      expectedChangedSummary: String,
      expectedRestoredSummary: String,
  ) {
    val causalCommits = countLogMarker(CAUSALITY_MARKER)
    putSetting(namespace, key, changedValue)
    waitForSetting(namespace, key, changedValue)
    tapControl(COMMIT_LABEL)
    waitForText(expectedChangedSummary)
    waitForLogMarkerCount(CAUSALITY_MARKER, causalCommits + 1)

    restoreSetting(namespace, key, originalValue)
    waitForSetting(namespace, key, originalValue)
    tapControl(COMMIT_LABEL)
    waitForText(expectedRestoredSummary)
    waitForLogMarkerCount(CAUSALITY_MARKER, causalCommits + 2)
  }

  private fun launchApplication(): Activity {
    val launchIntent =
        checkNotNull(instrumentation.targetContext.packageManager.getLaunchIntentForPackage(APP_ID))
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
    val activity = instrumentation.startActivitySync(launchIntent)
    instrumentation.waitForIdleSync()
    return activity
  }

  private fun requiredSettingArgument(name: String): String {
    val value = checkNotNull(arguments.getString(name)) { "Missing instrumentation argument $name." }
    assertTrue(
        "Instrumentation argument $name was not a bounded numeric or null setting.",
        value == "null" || SETTING_VALUE.matches(value),
    )
    return value
  }

  private fun transitionScaleIsZero(value: String): Boolean =
      value != "null" && value.toFloatOrNull() == 0f

  private fun settingIsEnabled(value: String): Boolean =
      value != "null" && value.toFloatOrNull()?.let { it != 0f } == true

  private fun preferenceSummary(reducedMotionEnabled: Boolean): String =
      "Screen reader disabled; reduced motion ${enabledLabel(reducedMotionEnabled)}"

  private fun platformSummary(highContrastEnabled: Boolean): String =
      "High contrast ${enabledLabel(highContrastEnabled)}; accessibility service enabled"

  private fun enabledLabel(enabled: Boolean): String = if (enabled) "enabled" else "disabled"

  private fun putSetting(namespace: String, key: String, value: String) {
    readShell("settings put $namespace $key $value")
  }

  private fun restoreSetting(namespace: String, key: String, value: String) {
    if (value == "null") {
      readShell("settings delete $namespace $key")
    } else {
      putSetting(namespace, key, value)
    }
  }

  private fun waitForSetting(namespace: String, key: String, expected: String) {
    val deadline = SystemClock.uptimeMillis() + SETTING_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      if (readShell("settings get $namespace $key").trim() == expected) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("Android did not apply or restore $namespace setting $key=$expected.")
  }

  private fun tapControl(label: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) { it.contentDescription?.toString() == label }
    assertTrue("The accessibility control $label was not clickable.", control.isClickable)
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
    fail("The expected native accessibility proof node did not appear.")
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
    fail("The accessibility proof tree survived owner teardown.")
  }

  private fun waitForLogMarker(marker: String) {
    waitForLogMarkerCount(marker, 1)
  }

  private fun waitForLogMarkerCount(marker: String, expectedCount: Int) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readProofLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The native accessibility proof emitted its JavaScript failure marker.")
      }
      if (logs.lineSequence().count { it.contains(marker) } >= expectedCount) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native accessibility proof omitted marker $marker occurrence $expectedCount.")
  }

  private fun countLogMarker(marker: String): Int =
      readProofLogs().lineSequence().count { it.contains(marker) }

  private fun readProofLogs(): String =
      readShell("logcat -d -v brief -s ReactNativeJS:I")

  private fun readShell(command: String): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              uiAutomation.executeShellCommand(command)
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
    assertFalse("The accessibility control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject accessibility touch-down.",
          uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject accessibility touch-up.",
          uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native accessibility ready"
    private const val REFRESH_LABEL = "Refresh native accessibility preferences"
    private const val COMMIT_LABEL = "Commit native accessibility preference"
    private const val ANNOUNCE_LABEL = "Announce Solid Native accessibility proof"
    private const val DISPOSE_LABEL = "Dispose Solid Native accessibility proof"
    private const val TRANSITION_ARGUMENT = "original_transition_scale"
    private const val HIGH_CONTRAST_ARGUMENT = "original_high_contrast"
    private const val FAILURE_MARKER = "SOLID_NATIVE_ACCESSIBILITY_FAILED"
    private const val CAUSALITY_MARKER =
        "SOLID_NATIVE_ACCESSIBILITY_PREFERENCE_CAUSALITY_SUCCEEDED"
    private const val REFRESH_MARKER = "SOLID_NATIVE_ACCESSIBILITY_REFRESHED"
    private const val ANNOUNCED_MARKER = "SOLID_NATIVE_ACCESSIBILITY_ANNOUNCED"
    private const val TIMEOUT_MARKER = "SOLID_NATIVE_ACCESSIBILITY_TIMEOUT_READY"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_ACCESSIBILITY_TEARDOWN_SUCCEEDED"
    private val SETTING_VALUE = Regex("-?[0-9]+(?:\\.[0-9]+)?")
    private const val PROOF_TIMEOUT_MS = 15_000L
    private const val SETTING_TIMEOUT_MS = 5_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
