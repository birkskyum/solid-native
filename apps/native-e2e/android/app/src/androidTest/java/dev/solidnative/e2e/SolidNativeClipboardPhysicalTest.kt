package dev.solidnative.e2e

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
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
class SolidNativeClipboardPhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val clipboardManager =
      instrumentation.targetContext.getSystemService(ClipboardManager::class.java)

  @Test
  fun testNativeClipboardBoundaryCausalityAndTeardownOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val originalClip = readPrimaryClip()
    try {
      val activity = launchApplication()
      waitForText(READY_TEXT)

      tapControl(WRITE_LABEL)
      waitForText(WRITTEN_TEXT)
      assertEquals(WRITE_PROOF_TEXT, readClipboardText())

      writeClipboardText(READ_PROOF_TEXT)
      tapControl(READ_LABEL)
      waitForText(READ_TEXT)

      tapControl(CLEAR_LABEL)
      waitForText(CLEARED_TEXT)
      assertEquals("", readClipboardText())

      tapControl(DISPOSE_LABEL)
      waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
      waitForTeardownAcknowledgement()
      instrumentation.runOnMainSync {
        assertFalse("The host Activity finished during clipboard teardown.", activity.isFinishing)
        assertFalse("The host Activity was destroyed during clipboard teardown.", activity.isDestroyed)
      }
    } finally {
      restorePrimaryClip(originalClip)
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

  private fun readPrimaryClip(): ClipData? {
    var result: ClipData? = null
    instrumentation.runOnMainSync { result = clipboardManager.primaryClip }
    return result
  }

  private fun restorePrimaryClip(clip: ClipData?) {
    instrumentation.runOnMainSync {
      if (clip === null) clipboardManager.clearPrimaryClip()
      else clipboardManager.setPrimaryClip(clip)
    }
  }

  private fun readClipboardText(): String {
    var result = ""
    instrumentation.runOnMainSync {
      val clip = clipboardManager.primaryClip
      result =
          if (clip === null || clip.itemCount == 0) ""
          else clip.getItemAt(0).text?.toString() ?: ""
    }
    return result
  }

  private fun writeClipboardText(text: String) {
    instrumentation.runOnMainSync {
      clipboardManager.setPrimaryClip(ClipData.newPlainText(null, text))
    }
  }

  private fun tapControl(label: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) { it.contentDescription?.toString() == label }
    assertTrue("The clipboard control $label was not clickable.", control.isClickable)
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
      val found = findNode(instrumentation.uiAutomation.rootInActiveWindow, predicate)
      if (found != null) return found
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The expected native clipboard accessibility node did not appear.")
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
    fail("The clipboard accessibility tree survived owner teardown.")
  }

  private fun waitForTeardownAcknowledgement() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The native clipboard proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(READ_CAUSALITY_MARKER) && logs.contains(TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native clipboard proof did not acknowledge read causality and teardown.")
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
    assertFalse("The clipboard control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject clipboard touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject clipboard touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native clipboard ready"
    private const val WRITE_PROOF_TEXT = "Private Solid Native clipboard write proof"
    private const val READ_PROOF_TEXT = "Private external clipboard read proof"
    private const val WRITE_LABEL = "Write Solid Native clipboard proof"
    private const val READ_LABEL = "Read Solid Native clipboard proof"
    private const val CLEAR_LABEL = "Clear native clipboard"
    private const val DISPOSE_LABEL = "Dispose Solid Native clipboard proof"
    private const val WRITTEN_TEXT = "Clipboard proof written"
    private const val READ_TEXT = "External clipboard proof read"
    private const val CLEARED_TEXT = "Clipboard cleared"
    private const val FAILURE_MARKER = "SOLID_NATIVE_CLIPBOARD_FAILED"
    private const val READ_CAUSALITY_MARKER =
        "SOLID_NATIVE_CLIPBOARD_READ_CAUSALITY_SUCCEEDED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_CLIPBOARD_TEARDOWN_SUCCEEDED"
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
