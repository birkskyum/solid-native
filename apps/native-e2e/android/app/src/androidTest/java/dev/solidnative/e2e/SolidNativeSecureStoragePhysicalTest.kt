package dev.solidnative.e2e

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
import java.io.File
import java.security.KeyStore
import javax.crypto.SecretKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SolidNativeSecureStoragePhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testNativeKeystorePersistenceCausalityDeletionAndTeardownOnPhysicalDevice() {
    assertEquals(APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForText(READY_TEXT)

    tapControl(STORE_LABEL)
    waitForText(STORED_TEXT)
    waitForPersistedService(true)
    val keyStore = androidKeyStore()
    val key = keyStore.getKey(SERVICE, null)
    assertTrue("The secure-storage key was not an Android SecretKey.", key is SecretKey)
    assertNull("Android Keystore unexpectedly exported private key material.", key?.encoded)
    val encryptedFile = keychainDataFile()
    assertTrue("The Keychain DataStore file was not created.", encryptedFile.isFile)
    val encryptedBytes = encryptedFile.readBytes()
    assertTrue(
        "The encrypted native record omitted its selected service.",
        encryptedBytes.toString(Charsets.UTF_8).contains(SERVICE),
    )
    assertFalse(
        "The private proof value appeared in native storage plaintext.",
        encryptedBytes.toString(Charsets.UTF_8).contains(PROOF_SECRET),
    )

    tapControl(READ_LABEL)
    waitForText(RESTORED_TEXT)

    tapControl(DELETE_LABEL)
    waitForText(DELETED_TEXT)
    waitForPersistedService(false)
    assertFalse(
        "The deleted secure-storage service remained in native persistence.",
        keychainDataFile().readBytes().toString(Charsets.UTF_8).contains(SERVICE),
    )

    tapControl(DISPOSE_LABEL)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) { it.text?.toString() == READY_TEXT }
    waitForTeardownAcknowledgement()
    instrumentation.runOnMainSync {
      assertFalse("The host Activity finished during secure-storage teardown.", activity.isFinishing)
      assertFalse("The host Activity was destroyed during secure-storage teardown.", activity.isDestroyed)
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

  private fun androidKeyStore(): KeyStore =
      KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun keychainDataFile(): File =
      File(instrumentation.targetContext.filesDir, "datastore/RN_KEYCHAIN.preferences_pb")

  private fun waitForPersistedService(expected: Boolean) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val present = androidKeyStore().containsAlias(SERVICE)
      if (present == expected) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    assertEquals("The Android Keystore service did not reach the expected state.", expected, androidKeyStore().containsAlias(SERVICE))
  }

  private fun tapControl(label: String) {
    val control = waitForNode(PROOF_TIMEOUT_MS) { it.contentDescription?.toString() == label }
    assertTrue("The secure-storage control $label was not clickable.", control.isClickable)
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
    fail("The expected native secure-storage accessibility node did not appear.")
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
    fail("The secure-storage accessibility tree survived owner teardown.")
  }

  private fun waitForTeardownAcknowledgement() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(FAILURE_MARKER)) {
        fail("The native secure-storage proof emitted its JavaScript failure marker.")
      }
      if (logs.contains(READ_CAUSALITY_MARKER) && logs.contains(TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native secure-storage proof did not acknowledge causality and teardown.")
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
    assertFalse("The secure-storage control had empty physical bounds.", bounds.isEmpty)
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
          "The Android runner did not inject secure-storage touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      SystemClock.sleep(TAP_DURATION_MS)
      assertTrue(
          "The Android runner did not inject secure-storage touch-up.",
          instrumentation.uiAutomation.injectInputEvent(up, true),
      )
    } finally {
      down.recycle()
      up.recycle()
    }
  }

  companion object {
    private const val APP_ID = "dev.solidnative.e2e"
    private const val READY_TEXT = "Solid Native secure storage ready"
    private const val PROOF_SECRET = "Private Solid Native refresh token proof"
    private const val SERVICE = "dev.solidnative.e2e.secure-storage:refresh-session"
    private const val STORE_LABEL = "Store encrypted session proof"
    private const val READ_LABEL = "Restore encrypted session proof"
    private const val DELETE_LABEL = "Delete encrypted session proof"
    private const val DISPOSE_LABEL = "Dispose Solid Native secure storage proof"
    private const val STORED_TEXT = "Session proof stored in native secure storage"
    private const val RESTORED_TEXT = "Session proof restored from native secure storage"
    private const val DELETED_TEXT = "Session proof deleted from native secure storage"
    private const val FAILURE_MARKER = "SOLID_NATIVE_SECURE_STORAGE_FAILED"
    private const val READ_CAUSALITY_MARKER =
        "SOLID_NATIVE_SECURE_STORAGE_READ_CAUSALITY_SUCCEEDED"
    private const val TEARDOWN_MARKER = "SOLID_NATIVE_SECURE_STORAGE_TEARDOWN_SUCCEEDED"
    private const val PROOF_TIMEOUT_MS = 15_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
  }
}
