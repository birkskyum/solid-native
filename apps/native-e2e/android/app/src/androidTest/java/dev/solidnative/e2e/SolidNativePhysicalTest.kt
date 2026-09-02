package dev.solidnative.e2e

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.service.notification.StatusBarNotification
import android.util.Log
import android.view.FrameMetrics
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowInsets
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.appcompat.widget.Toolbar
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.views.scroll.ReactScrollView
import com.swmansion.rnscreens.ScreenStack
import dev.solidnative.runtime.SolidNativeBindingsInstaller
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.IdentityHashMap

@RunWith(AndroidJUnit4::class)
class SolidNativePhysicalTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()

  @Test
  fun testPhysicalRendererUpdate() {
    if (instrumentation.targetContext.packageName == WORKLET_APP_ID) {
      testNativeUIWorklet()
      return
    }
    if (instrumentation.targetContext.packageName == NAVIGATION_PROCESS_APP_ID) {
      when (
          InstrumentationRegistry.getArguments().getString(NAVIGATION_PROCESS_PHASE_ARGUMENT)
              ?: NAVIGATION_PROCESS_PHASE_COLD
      ) {
        NAVIGATION_PROCESS_PHASE_SEED -> testNavigationProcessSeed()
        NAVIGATION_PROCESS_PHASE_RESTORE -> testNavigationProcessRestore()
        NAVIGATION_PROCESS_PHASE_PRESSURE -> testNavigationProcessMemoryPressure()
        NAVIGATION_PROCESS_PHASE_CHURN -> testNavigationProcessChurn()
        NAVIGATION_PROCESS_PHASE_PRODUCT -> testNavigationProcessProductInterruption()
        NAVIGATION_PROCESS_PHASE_COLD -> testNavigationProcessColdLink()
        else -> fail("The navigation-process instrumentation phase was not recognized.")
      }
      return
    }
    if (instrumentation.targetContext.packageName == TABS_APP_ID) {
      when (
          InstrumentationRegistry.getArguments().getString(NATIVE_TABS_PHASE_ARGUMENT)
              ?: NATIVE_TABS_PHASE_COLD
      ) {
        NATIVE_TABS_PHASE_SEED -> testSolidNativeTabsSeedRestoration()
        NATIVE_TABS_PHASE_RESTORE -> testSolidNativeTabsRestoreProcess()
        NATIVE_TABS_PHASE_PRODUCT -> testSolidNativeTabsProductComposition()
        NATIVE_TABS_PHASE_PRODUCT_RESTORE -> testSolidNativeTabsProductSessionRestore()
        NATIVE_TABS_PHASE_COLD -> testSolidNativeTabsColdLink()
        else -> fail("The native-tabs instrumentation phase was not recognized.")
      }
      return
    }
    if (instrumentation.targetContext.packageName == REACT_LIST_CONTROL_APP_ID) {
      testReactVirtualizedList()
      return
    }
    if (
        instrumentation.targetContext.packageName == SOLID_TELEMETRY_BASELINE_APP_ID ||
            instrumentation.targetContext.packageName == SOLID_TELEMETRY_OBSERVED_APP_ID
    ) {
      testMatchedProductWorkload()
      return
    }
    if (
        instrumentation.targetContext.packageName == SOLID_MEMORY_APP_ID ||
            instrumentation.targetContext.packageName == REACT_MEMORY_CONTROL_APP_ID
    ) {
      when (
          InstrumentationRegistry.getArguments().getString(MATCHED_UPDATE_SCENARIO_ARGUMENT)
              ?: MATCHED_UPDATE_SCENARIO_STEADY
      ) {
        MATCHED_UPDATE_SCENARIO_STEADY -> testMatchedPropertyUpdates()
        MATCHED_UPDATE_SCENARIO_PRODUCT -> testMatchedProductWorkload()
        else -> fail("The matched-update instrumentation scenario was not recognized.")
      }
      return
    }
    if (instrumentation.targetContext.packageName == CONTROL_APP_ID) {
      testReactControlUpdate()
      return
    }
    if (
        instrumentation.targetContext.packageName == LIST_APP_ID ||
            instrumentation.targetContext.packageName == LIST_RECYCLING_APP_ID
    ) {
      testSolidVirtualizedList()
      return
    }

    assertEquals(SOLID_APP_ID, instrumentation.targetContext.packageName)
    testSolidPressSignalAndTeardown()
  }

  private fun testNativeUIWorklet() {
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) { it.text?.toString() == WORKLET_READY_TEXT }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_TARGET_LABEL
    }
    val install = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_INSTALL_LABEL
    }
    assertTrue("The native UI worklet install control was not clickable.", install.isClickable)
    tapCenter(install)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_INITIAL_TEXT }

    var initialSequence = 0L
    var updatedSequence = initialSequence
    instrumentation.runOnMainSync {
      val target =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == WORKLET_TARGET_LABEL
          }
      assertTrue("The UI worklet target was not a mounted Android View.", target != null)
      assertTrue("The UI worklet target had an invalid Fabric tag.", (target?.id ?: 0) > 0)
      assertEquals(
          "The initial native worklet opacity was not applied.",
          0.25f,
          target?.alpha ?: -1f,
          WORKLET_FLOAT_TOLERANCE,
      )
      assertEquals(0f, target?.translationY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      val frame = SolidNativeBindingsInstaller.getLastUIWorkletFrame()
      assertTrue("The native worklet frame was not recorded.", frame != null)
      assertTrue("The native worklet callback did not run on Android's main thread.", frame?.onMainThread == true)
      assertTrue("The native worklet callback did not apply to its Fabric View.", frame?.applied == true)
      assertEquals(target?.id, frame?.targetTag)
      assertTrue("The native worklet did not receive a Choreographer timestamp.", (frame?.frameTimeNanoseconds ?: 0) > 0)
      initialSequence = frame?.sequence ?: 0
      assertTrue("The initial native worklet sequence was not positive.", initialSequence > 0)
    }

    val update = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_UPDATE_LABEL
    }
    assertTrue("The native UI worklet update control was not clickable.", update.isClickable)
    tapCenter(update)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_UPDATED_TEXT }

    instrumentation.runOnMainSync {
      val target =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == WORKLET_TARGET_LABEL
          }
      assertTrue("The updated UI worklet target disappeared.", target != null)
      val density = activity.resources.displayMetrics.density
      assertEquals(1f, target?.alpha ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(
          12f * density,
          target?.translationX ?: -1f,
          WORKLET_FLOAT_TOLERANCE,
      )
      assertEquals(0f, target?.translationY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(8f, target?.rotation ?: -1f, WORKLET_FLOAT_TOLERANCE)
      val frame = SolidNativeBindingsInstaller.getLastUIWorkletFrame()
      assertTrue("The updated native worklet frame was not applied.", frame?.applied == true)
      assertTrue("The updated native worklet did not advance its frame sequence.", (frame?.sequence ?: 0) > initialSequence)
      updatedSequence = frame?.sequence ?: initialSequence
    }

    val timing = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_TIMING_LABEL
    }
    assertTrue("The native UI worklet timing control was not clickable.", timing.isClickable)
    tapCenter(timing)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_TIMING_TEXT }

    var timedSequence = updatedSequence
    instrumentation.runOnMainSync {
      val target =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == WORKLET_TARGET_LABEL
          }
      assertTrue("The timed UI worklet target disappeared.", target != null)
      val density = activity.resources.displayMetrics.density
      assertEquals(0.625f, target?.alpha ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(
          -8f * density,
          target?.translationX ?: 1f,
          WORKLET_FLOAT_TOLERANCE,
      )
      assertEquals(0f, target?.translationY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.1f, target?.scaleX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.1f, target?.scaleY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(4f, target?.rotation ?: -1f, WORKLET_FLOAT_TOLERANCE)
      val frame = SolidNativeBindingsInstaller.getLastUIWorkletFrame()
      assertTrue("The final native timing frame was not applied.", frame?.applied == true)
      assertTrue(
          "The interrupted native timing did not evaluate multiple UI frames.",
          (frame?.sequence ?: 0) > updatedSequence + 2,
      )
      timedSequence = frame?.sequence ?: updatedSequence
    }

    val stability = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_STABILITY_LABEL
    }
    assertTrue("The native UI worklet stability control was not clickable.", stability.isClickable)
    tapCenter(stability)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_STABILITY_TEXT }

    var stableSequence = timedSequence
    instrumentation.runOnMainSync {
      val target =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == WORKLET_TARGET_LABEL
          }
      assertTrue("The sustained UI worklet target disappeared.", target != null)
      val density = activity.resources.displayMetrics.density
      assertEquals(0.8125f, target?.alpha ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(8f * density, target?.translationX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(0f, target?.translationY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.15f, target?.scaleX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.15f, target?.scaleY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(6f, target?.rotation ?: -1f, WORKLET_FLOAT_TOLERANCE)
      val frame = SolidNativeBindingsInstaller.getLastUIWorkletFrame()
      assertTrue("The sustained native timing endpoint was not applied.", frame?.applied == true)
      assertTrue("The sustained native timing left the main thread.", frame?.onMainThread == true)
      assertTrue(
          "The sustained native timing did not deliver enough UI frames.",
          (frame?.sequence ?: 0) >= timedSequence + WORKLET_MINIMUM_STABILITY_FRAMES,
      )
      stableSequence = frame?.sequence ?: timedSequence
    }

    val keyframes = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_KEYFRAMES_LABEL
    }
    assertTrue("The native UI worklet keyframe control was not clickable.", keyframes.isClickable)
    tapCenter(keyframes)

    var maximumKeyframeTranslationX = Float.NEGATIVE_INFINITY
    var minimumKeyframeTranslationX = Float.POSITIVE_INFINITY
    val keyframeDeadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < keyframeDeadline) {
      instrumentation.runOnMainSync {
        val target =
            findAndroidView(activity.window.decorView) {
              it.contentDescription?.toString() == WORKLET_TARGET_LABEL
            }
        if (target != null) {
          maximumKeyframeTranslationX =
              maxOf(maximumKeyframeTranslationX, target.translationX)
          minimumKeyframeTranslationX =
              minOf(minimumKeyframeTranslationX, target.translationX)
        }
      }
      if (
          findNode(instrumentation.uiAutomation.rootInActiveWindow) {
            it.text?.toString() == WORKLET_KEYFRAMES_TEXT
          } != null
      ) {
        break
      }
      SystemClock.sleep(WORKLET_KEYFRAMES_POLL_INTERVAL_MS)
    }
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_KEYFRAMES_TEXT }
    val density = activity.resources.displayMetrics.density
    assertTrue(
        "The mounted Android View never displayed the first native keyframe leg.",
        maximumKeyframeTranslationX > 24f * density,
    )
    assertTrue(
        "The mounted Android View never displayed the second native keyframe leg.",
        minimumKeyframeTranslationX < -12f * density,
    )

    var keyframedSequence = stableSequence
    instrumentation.runOnMainSync {
      val target =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == WORKLET_TARGET_LABEL
          }
      assertTrue("The keyframed UI worklet target disappeared.", target != null)
      assertEquals(1f, target?.alpha ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(4f * density, target?.translationX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(0f, target?.translationY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(8f, target?.rotation ?: -1f, WORKLET_FLOAT_TOLERANCE)
      val frame = SolidNativeBindingsInstaller.getLastUIWorkletFrame()
      assertTrue("The native keyframe endpoint was not applied.", frame?.applied == true)
      assertTrue("The native keyframes left Android's main thread.", frame?.onMainThread == true)
      assertTrue(
          "The native keyframe sequence did not evaluate enough UI frames.",
          (frame?.sequence ?: 0) >= stableSequence + WORKLET_MINIMUM_KEYFRAME_FRAMES,
      )
      keyframedSequence = frame?.sequence ?: stableSequence
    }

    val spring = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_SPRING_LABEL
    }
    assertTrue("The native UI worklet spring control was not clickable.", spring.isClickable)
    tapCenter(spring)

    var minimumSpringTranslationX = Float.POSITIVE_INFINITY
    val springOvershootDeadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (
        SystemClock.uptimeMillis() < springOvershootDeadline &&
            minimumSpringTranslationX >= -8.5f * density
    ) {
      instrumentation.runOnMainSync {
        val target =
            findAndroidView(activity.window.decorView) {
              it.contentDescription?.toString() == WORKLET_TARGET_LABEL
            }
        if (target != null) {
          minimumSpringTranslationX =
              minOf(minimumSpringTranslationX, target.translationX)
        }
      }
      SystemClock.sleep(WORKLET_SPRING_POLL_INTERVAL_MS)
    }
    assertTrue(
        "The mounted Android View never displayed native spring overshoot.",
        minimumSpringTranslationX < -8.5f * density,
    )
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_SPRING_TEXT }

    var sprungSequence = keyframedSequence
    instrumentation.runOnMainSync {
      val target =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == WORKLET_TARGET_LABEL
          }
      assertTrue("The sprung UI worklet target disappeared.", target != null)
      assertEquals(1f, target?.alpha ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(-8f * density, target?.translationX ?: 1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(0f, target?.translationY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(8f, target?.rotation ?: -1f, WORKLET_FLOAT_TOLERANCE)
      val frame = SolidNativeBindingsInstaller.getLastUIWorkletFrame()
      assertTrue("The native spring endpoint was not applied.", frame?.applied == true)
      assertTrue("The native spring left Android's main thread.", frame?.onMainThread == true)
      assertTrue(
          "The native spring did not evaluate enough UI frames.",
          (frame?.sequence ?: 0) >= keyframedSequence + WORKLET_MINIMUM_SPRING_FRAMES,
      )
      sprungSequence = frame?.sequence ?: keyframedSequence
    }

    val decay = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_DECAY_LABEL
    }
    assertTrue("The native UI worklet decay control was not clickable.", decay.isClickable)
    tapCenter(decay)

    var minimumDecayTranslationX = -8f * density
    val decayDeadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < decayDeadline) {
      instrumentation.runOnMainSync {
        val target =
            findAndroidView(activity.window.decorView) {
              it.contentDescription?.toString() == WORKLET_TARGET_LABEL
            }
        if (target != null) {
          minimumDecayTranslationX =
              minOf(minimumDecayTranslationX, target.translationX)
        }
      }
      if (
          findNode(instrumentation.uiAutomation.rootInActiveWindow) {
            it.text?.toString() == WORKLET_DECAY_TEXT
          } != null
      ) {
        break
      }
      SystemClock.sleep(WORKLET_DECAY_POLL_INTERVAL_MS)
    }
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_DECAY_TEXT }
    assertTrue(
        "The mounted Android View never displayed native decay movement.",
        minimumDecayTranslationX < -8.5f * density,
    )

    var decayedSequence = sprungSequence
    var decayOriginX = 0f
    var decayOriginY = 0f
    instrumentation.runOnMainSync {
      val target =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == WORKLET_TARGET_LABEL
          }
      assertTrue("The decayed UI worklet target disappeared.", target != null)
      decayOriginX = target?.translationX ?: 0f
      decayOriginY = target?.translationY ?: 0f
      assertEquals(1f, target?.alpha ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertTrue(
          "The native decay X endpoint escaped its analytical range.",
          decayOriginX < -8f * density && decayOriginX > -36f * density,
      )
      assertEquals(9f * density, decayOriginY, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(8f, target?.rotation ?: -1f, WORKLET_FLOAT_TOLERANCE)
      val frame = SolidNativeBindingsInstaller.getLastUIWorkletFrame()
      assertTrue("The native decay endpoint was not applied.", frame?.applied == true)
      assertTrue("The native decay left Android's main thread.", frame?.onMainThread == true)
      assertTrue(
          "The native decay did not evaluate enough UI frames.",
          (frame?.sequence ?: 0) >= sprungSequence + WORKLET_MINIMUM_DECAY_FRAMES,
      )
      decayedSequence = frame?.sequence ?: sprungSequence
    }

    val gesture = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_GESTURE_LABEL
    }
    assertTrue("The native UI worklet pan control was not clickable.", gesture.isClickable)
    tapCenter(gesture)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_GESTURE_READY_TEXT }

    val gestureTarget = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_TARGET_LABEL
    }
    dragBy(gestureTarget, 36f * density, 24f * density)
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == WORKLET_GESTURE_TEXT }

    instrumentation.runOnMainSync {
      val target =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == WORKLET_TARGET_LABEL
          }
      assertTrue("The panned UI worklet target disappeared.", target != null)
      assertEquals(1f, target?.alpha ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertTrue(
          "The native pan release did not continue horizontally under decay.",
          (target?.translationX ?: Float.NEGATIVE_INFINITY) > decayOriginX + 36f * density,
      )
      assertTrue(
          "The native pan release did not continue vertically under decay.",
          (target?.translationY ?: Float.NEGATIVE_INFINITY) > decayOriginY + 24f * density,
      )
      assertEquals(1.2f, target?.scaleX ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(1.2f, target?.scaleY ?: -1f, WORKLET_FLOAT_TOLERANCE)
      assertEquals(8f, target?.rotation ?: -1f, WORKLET_FLOAT_TOLERANCE)
      val frame = SolidNativeBindingsInstaller.getLastUIWorkletFrame()
      assertTrue("The native pan-to-decay frame was not applied.", frame?.applied == true)
      assertTrue("The native pan-to-decay callback did not run on Android's main thread.", frame?.onMainThread == true)
      assertTrue(
          "The native pan did not advance the UI-owned frame sequence.",
          (frame?.sequence ?: 0) > decayedSequence,
      )
    }

    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_DISPOSE_LABEL
    }
    assertTrue("The native UI worklet disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.contentDescription?.toString() == WORKLET_TARGET_LABEL ||
          it.contentDescription?.toString() == WORKLET_INSTALL_LABEL ||
          it.contentDescription?.toString() == WORKLET_UPDATE_LABEL ||
          it.contentDescription?.toString() == WORKLET_TIMING_LABEL ||
          it.contentDescription?.toString() == WORKLET_STABILITY_LABEL ||
          it.contentDescription?.toString() == WORKLET_KEYFRAMES_LABEL ||
          it.contentDescription?.toString() == WORKLET_SPRING_LABEL ||
          it.contentDescription?.toString() == WORKLET_DECAY_LABEL ||
          it.contentDescription?.toString() == WORKLET_GESTURE_LABEL
    }
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(WORKLET_FAILURE_MARKER)) {
        fail("The native UI worklet proof emitted its failure marker.")
      }
      if (logs.contains(WORKLET_TEARDOWN_MARKER)) {
        assertProcessStillRunning(activity)
        return
      }
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native UI worklet proof did not acknowledge terminal teardown.")
  }

  private fun testNavigationProcessSeed() {
    val accessibilityFocusEvents = ConcurrentLinkedQueue<String>()
    instrumentation.uiAutomation.setOnAccessibilityEventListener { event ->
      if (event.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED) {
        val source = event.source
        val label = source?.text?.toString() ?: source?.contentDescription?.toString()
        if (label != null) accessibilityFocusEvents.add(label)
      }
    }
    val activity = launchApplication(NAVIGATION_PROCESS_SEED_URL)
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_ROOT_CONTENT
    }
    waitForAccessibilityFocus(accessibilityFocusEvents, NAVIGATION_PROCESS_ROOT_CONTENT)
    assertNavigationProcessStack(activity, NAVIGATION_PROCESS_ROOT_HEADER)
    val rootScrollView = waitForNavigationProcessScrollView(activity)
    val scrollTarget =
        (NAVIGATION_PROCESS_SCROLL_TARGET_DP * activity.resources.displayMetrics.density)
            .toInt()
    instrumentation.runOnMainSync {
      assertTrue(
          "The process seed root ScrollView had no overflow to persist.",
          rootScrollView.canScrollVertically(1),
      )
      rootScrollView.scrollTo(0, scrollTarget)
    }
    waitForNavigationProcessScrollOffset(rootScrollView, scrollTarget)
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_MARKER)
    val push = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_PUSH_LABEL
    }
    assertTrue("The navigation process seed push was not clickable.", push.isClickable)
    tapCenter(push)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT
    }
    waitForAccessibilityFocus(accessibilityFocusEvents, NAVIGATION_PROCESS_DETAIL_CONTENT)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith(NAVIGATION_PROCESS_DETAIL_LOADER_STATE) == true
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_ROUTED_DETAIL_STATE
    }
    collapseNavigationSheet(activity)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_SHEET_COLLAPSED_STATE
    }
    val persist = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_SEED_LABEL
    }
    assertTrue("The navigation process seed control was not clickable.", persist.isClickable)
    tapCenter(persist)
    waitForNavigationProcessTeardown()
    assertProcessStillRunning(activity)
    instrumentation.uiAutomation.setOnAccessibilityEventListener(null)
  }

  private fun waitForAccessibilityFocus(
      events: ConcurrentLinkedQueue<String>,
      expectedText: String,
  ) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      if (events.contains(expectedText)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The native navigation screen did not move accessibility focus to " +
            "$expectedText; observed ${events.toList()}.",
    )
  }

  private fun testNavigationProcessRestore() {
    val accessibilityFocusEvents = ConcurrentLinkedQueue<String>()
    instrumentation.uiAutomation.setOnAccessibilityEventListener { event ->
      if (event.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED) {
        val source = event.source
        val label = source?.text?.toString() ?: source?.contentDescription?.toString()
        if (label != null) accessibilityFocusEvents.add(label)
      }
    }
    val activity = launchApplication()
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith(NAVIGATION_PROCESS_DETAIL_LOADER_STATE) == true
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_RESTORATION_STATE
    }
    assertNavigationProcessStack(activity, NAVIGATION_PROCESS_DETAIL_HEADER)
    val headerAction = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_DETAIL_HEADER_ACTION_LABEL
    }
    assertTrue("The Solid-owned native header action was not clickable.", headerAction.isClickable)
    tapCenter(headerAction)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_DETAIL_HEADER_ACTION_DONE
    }
    assertTrue(
        "Android did not deliver the blocker-tested system Back to the process-restored navigation stack.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_BLOCKED_BACK_STATE
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT
    }
    assertNavigationProcessStack(activity, NAVIGATION_PROCESS_DETAIL_HEADER)
    assertTrue(
        "Android did not deliver the allowed system Back to the process-restored navigation stack.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_ROOT_CONTENT
    }
    waitForAccessibilityFocus(accessibilityFocusEvents, NAVIGATION_PROCESS_ROOT_CONTENT)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith(NAVIGATION_PROCESS_ROOT_LOADER_STATE) == true
    }
    val restoredRootScrollView = waitForNavigationProcessScrollView(activity)
    val restoredScrollTarget =
        (NAVIGATION_PROCESS_SCROLL_TARGET_DP * activity.resources.displayMetrics.density)
            .toInt()
    waitForNavigationProcessScrollOffset(restoredRootScrollView, restoredScrollTarget)
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_MARKER)
    instrumentation.runOnMainSync { restoredRootScrollView.scrollTo(0, 0) }
    waitForNavigationProcessScrollOffset(restoredRootScrollView, 0)
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The process-restored navigation detail remained after Android system Back.",
    ) {
      it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT
    }
    assertNavigationProcessStack(activity, NAVIGATION_PROCESS_ROOT_HEADER)
    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_DISPOSE_LABEL
    }
    assertTrue("The restored navigation disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNavigationProcessTeardown()
    assertProcessStillRunning(activity)
    instrumentation.uiAutomation.setOnAccessibilityEventListener(null)
  }

  private fun testNavigationProcessColdLink() {
    val activity = launchApplication(NAVIGATION_PROCESS_COLD_LINK_URL)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_LINKED_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_LINKED_LOADER_STATE
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_COLD_LINK_STATE
    }
    assertNavigationProcessStack(activity, NAVIGATION_PROCESS_LINKED_HEADER)
    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_DISPOSE_LABEL
    }
    assertTrue("The cold-linked navigation disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNavigationProcessTeardown()
    assertProcessStillRunning(activity)
  }

  private fun testNavigationProcessProductInterruption() {
    val accessibilityFocusEvents = ConcurrentLinkedQueue<String>()
    instrumentation.uiAutomation.setOnAccessibilityEventListener { event ->
      if (event.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED) {
        val source = event.source
        val label = source?.text?.toString() ?: source?.contentDescription?.toString()
        if (label != null) accessibilityFocusEvents.add(label)
      }
    }
    val activity = launchApplication(NAVIGATION_PROCESS_PRODUCT_URL)
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_PRODUCT_LOGIN_CONTENT
    }
    waitForAccessibilityFocus(
        accessibilityFocusEvents,
        NAVIGATION_PROCESS_PRODUCT_LOGIN_CONTENT,
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_PRODUCT_AUTH_REDIRECT_STATE
    }
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_PRODUCT_AUTH_REDIRECT_MARKER)
    val retainedStack =
        assertNavigationProcessStack(activity, NAVIGATION_PROCESS_PRODUCT_LOGIN_HEADER)
    val loginScreen = waitForNavigationProcessScreens(activity, 1).single()

    val start = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_PRODUCT_START_LABEL
    }
    assertTrue("The authenticated product start control was not clickable.", start.isClickable)
    tapCenter(start)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_PRODUCT_SLOW_PENDING_STATE
    }
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_PRODUCT_SLOW_LOADER_MARKER)
    val interrupt = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_PRODUCT_INTERRUPT_LABEL
    }
    assertTrue("The pending product interruption control was not clickable.", interrupt.isClickable)
    assertTrue(
        "The native ScreenStack changed while protected data was pending.",
        retainedStack === assertNavigationProcessStack(activity, NAVIGATION_PROCESS_PRODUCT_SLOW_HEADER),
    )
    val pendingScreens = waitForNavigationProcessScreens(activity, 2)
    assertTrue(
        "The authentication screen was not retained behind pending native work.",
        pendingScreens.any { it === loginScreen },
    )
    val pendingRouteScreen = pendingScreens.single { it !== loginScreen }

    accessibilityFocusEvents.clear()
    tapCenter(interrupt)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_PRODUCT_HOME_CONTENT
    }
    waitForAccessibilityFocus(
        accessibilityFocusEvents,
        NAVIGATION_PROCESS_PRODUCT_HOME_CONTENT,
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith(NAVIGATION_PROCESS_PRODUCT_HOME_LOADER_STATE) == true
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_PRODUCT_HOME_STATE
    }
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_PRODUCT_INTERRUPTION_MARKER)
    assertTrue(
        "The native ScreenStack changed when the winning route settled.",
        retainedStack === assertNavigationProcessStack(activity, NAVIGATION_PROCESS_PRODUCT_HOME_HEADER),
    )
    val settledScreens = waitForNavigationProcessScreens(activity, 2)
    assertTrue(
        "The authentication screen was not retained behind the winning route.",
        settledScreens.any { it === loginScreen },
    )
    assertTrue(
        "The pending native Screen was replaced instead of leaking a third route.",
        settledScreens.any { it === pendingRouteScreen },
    )
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "Denied or stale protected content became visible after interruption.",
    ) {
      it.text?.toString() == NAVIGATION_PROCESS_PRODUCT_DENIED_CONTENT ||
          it.text?.toString() == NAVIGATION_PROCESS_PRODUCT_STALE_CONTENT
    }

    accessibilityFocusEvents.clear()
    assertTrue(
        "Android did not return from authenticated home through system Back.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_PRODUCT_LOGIN_CONTENT
    }
    waitForAccessibilityFocus(
        accessibilityFocusEvents,
        NAVIGATION_PROCESS_PRODUCT_LOGIN_CONTENT,
    )
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The winning home route survived Android system Back.",
    ) {
      it.text?.toString() == NAVIGATION_PROCESS_PRODUCT_HOME_CONTENT
    }
    assertTrue(
        "The retained native ScreenStack changed after product Back.",
        retainedStack === assertNavigationProcessStack(activity, NAVIGATION_PROCESS_PRODUCT_LOGIN_HEADER),
    )
    assertTrue(
        "Android Back did not reveal the original authentication Screen.",
        waitForNavigationProcessScreens(activity, 1).single() === loginScreen,
    )
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_PLATFORM_BACK_MARKER)
    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_DISPOSE_LABEL
    }
    assertTrue("The product navigation disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNavigationProcessTeardown()
    assertProcessStillRunning(activity)
    instrumentation.uiAutomation.setOnAccessibilityEventListener(null)
  }

  private fun testNavigationProcessMemoryPressure() {
    val activity = launchApplication(NAVIGATION_PROCESS_PRESSURE_URL)
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_ROOT_CONTENT
    }
    val retainedStack =
        assertNavigationProcessStack(activity, NAVIGATION_PROCESS_ROOT_HEADER)
    val rootScreen = waitForNavigationProcessScreens(activity, 1).single()
    val rootScrollView = waitForNavigationProcessScrollView(activity)
    val scrollTarget =
        (NAVIGATION_PROCESS_SCROLL_TARGET_DP * activity.resources.displayMetrics.density)
            .toInt()
    instrumentation.runOnMainSync {
      assertTrue(
          "The memory-pressure root ScrollView had no overflow to restore.",
          rootScrollView.canScrollVertically(1),
      )
      rootScrollView.scrollTo(0, scrollTarget)
    }
    waitForNavigationProcessScrollOffset(rootScrollView, scrollTarget)
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_SCROLL_CAPTURE_MARKER)
    val push = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_PUSH_LABEL
    }
    assertTrue("The memory-pressure navigation push was not clickable.", push.isClickable)
    tapCenter(push)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_READY_STATE
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_READY_COUNT
    }
    assertTrue(
        "The native ScreenStack was recreated before the memory warning.",
        retainedStack ===
            assertNavigationProcessStack(activity, NAVIGATION_PROCESS_DETAIL_HEADER),
    )
    val retainedScreens = waitForNavigationProcessScreens(activity, 2)
    assertTrue(
        "The original root Screen was not retained after pushing detail.",
        retainedScreens.any { it === rootScreen },
    )

    instrumentation.runOnMainSync {
      (activity.application as MainApplication)
          .onTrimMemory(NAVIGATION_PROCESS_UI_HIDDEN)
    }
    SystemClock.sleep(NAVIGATION_PROCESS_MEMORY_SETTLE_MS)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_READY_STATE
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_READY_COUNT
    }
    assertNavigationProcessNativeIdentity(
        activity,
        retainedStack,
        retainedScreens,
        "ordinary UI-hidden backgrounding",
    )

    instrumentation.runOnMainSync {
      (activity.application as MainApplication)
          .onTrimMemory(NAVIGATION_PROCESS_RUNNING_CRITICAL)
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_PRESSURE_STATE
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_PRESSURE_COUNT
    }
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_MEMORY_PRESSURE_MARKER)
    instrumentation.runOnMainSync {
      assertTrue(
          "The reclaimed route retained its old ReactScrollView.",
          rootScrollView.parent == null,
      )
      assertTrue(
          "The parked root still exposed a ReactScrollView in the native hierarchy.",
          findAndroidView(activity.window.decorView) { it is ReactScrollView } == null,
      )
    }
    assertNavigationProcessNativeIdentity(
        activity,
        retainedStack,
        retainedScreens,
        "critical memory-pressure reclamation",
    )

    val recover = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_RECOVER_LABEL
    }
    assertTrue("The memory-recovery control was not clickable.", recover.isClickable)
    tapCenter(recover)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_RECOVERED_STATE
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_MEMORY_RECOVERED_COUNT
    }
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_MEMORY_RECOVERY_MARKER)
    assertNavigationProcessNativeIdentity(
        activity,
        retainedStack,
        retainedScreens,
        "explicit memory recovery",
    )

    assertTrue(
        "Android did not deliver system Back after memory recovery.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_ROOT_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith(NAVIGATION_PROCESS_ROOT_LOADER_STATE) == true
    }
    val restoredRootScrollView = waitForNavigationProcessScrollView(activity)
    assertTrue(
        "The reclaimed root reused its disposed ReactScrollView.",
        restoredRootScrollView !== rootScrollView,
    )
    waitForNavigationProcessScrollOffset(restoredRootScrollView, scrollTarget)
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_SCROLL_RESTORATION_MARKER)
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The memory-recovered detail survived Android system Back.",
    ) {
      it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT
    }
    assertTrue(
        "The retained native ScreenStack changed when the reclaimed root remounted.",
        retainedStack ===
            assertNavigationProcessStack(activity, NAVIGATION_PROCESS_ROOT_HEADER),
    )
    assertTrue(
        "The reclaimed root remounted into a replacement native Screen.",
        waitForNavigationProcessScreens(activity, 1).single() === rootScreen,
    )
    waitForNavigationProcessLogMarker(NAVIGATION_PROCESS_PLATFORM_BACK_MARKER)
    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_DISPOSE_LABEL
    }
    assertTrue("The memory-pressure disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNavigationProcessTeardown()
    assertProcessStillRunning(activity)
  }

  private fun testNavigationProcessChurn() {
    val accessibilityFocusEvents = ConcurrentLinkedQueue<String>()
    instrumentation.uiAutomation.setOnAccessibilityEventListener { event ->
      if (event.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED) {
        val source = event.source
        val label = source?.text?.toString() ?: source?.contentDescription?.toString()
        if (label != null) accessibilityFocusEvents.add(label)
      }
    }
    val activity = launchApplication(NAVIGATION_PROCESS_CHURN_URL)
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_PROCESS_ROOT_CONTENT
    }
    waitForAccessibilityFocus(accessibilityFocusEvents, NAVIGATION_PROCESS_ROOT_CONTENT)
    val retainedStack =
        assertNavigationProcessStack(activity, NAVIGATION_PROCESS_ROOT_HEADER)
    repeat(NAVIGATION_PROCESS_CHURN_CYCLES) { cycle ->
      val push = waitForNode(PROOF_TIMEOUT_MS) {
        it.contentDescription?.toString() == NAVIGATION_PROCESS_PUSH_LABEL
      }
      assertTrue(
          "The navigation churn push ${cycle + 1} was not clickable.",
          push.isClickable,
      )
      accessibilityFocusEvents.clear()
      tapCenter(push)
      waitForNode(PROOF_TIMEOUT_MS) {
        it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT
      }
      waitForAccessibilityFocus(accessibilityFocusEvents, NAVIGATION_PROCESS_DETAIL_CONTENT)
      waitForNode(PROOF_TIMEOUT_MS) {
        it.text?.toString()?.startsWith(NAVIGATION_PROCESS_DETAIL_LOADER_STATE) == true
      }
      assertTrue(
          "The native ScreenStack was recreated during navigation churn cycle ${cycle + 1}.",
          retainedStack ===
              assertNavigationProcessStack(activity, NAVIGATION_PROCESS_DETAIL_HEADER),
      )
      accessibilityFocusEvents.clear()
      assertTrue(
          "Android did not deliver system Back during navigation churn cycle ${cycle + 1}.",
          instrumentation.uiAutomation.performGlobalAction(
              AccessibilityService.GLOBAL_ACTION_BACK
          ),
      )
      waitForNode(PROOF_TIMEOUT_MS) {
        it.text?.toString() == NAVIGATION_PROCESS_ROOT_CONTENT
      }
      waitForAccessibilityFocus(accessibilityFocusEvents, NAVIGATION_PROCESS_ROOT_CONTENT)
      waitForNodeToDisappear(
          PROOF_TIMEOUT_MS,
          "The navigation churn detail survived system Back in cycle ${cycle + 1}.",
      ) {
        it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT
      }
      assertTrue(
          "The retained native ScreenStack changed after navigation churn cycle ${cycle + 1}.",
          retainedStack ===
              assertNavigationProcessStack(activity, NAVIGATION_PROCESS_ROOT_HEADER),
      )
    }
    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NAVIGATION_PROCESS_DISPOSE_LABEL
    }
    assertTrue("The navigation churn disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNavigationProcessTeardown()
    assertProcessStillRunning(activity)
    instrumentation.uiAutomation.setOnAccessibilityEventListener(null)
  }

  private fun assertNavigationProcessStack(activity: Activity, expectedHeader: String): View {
    var retainedStack: View? = null
    instrumentation.runOnMainSync {
      val stack =
          findAndroidView(activity.window.decorView) {
            it.javaClass.name == NAVIGATION_PROCESS_SCREEN_STACK_CLASS
          }
      assertTrue("The navigation process proof did not mount a native ScreenStack.", stack != null)
      assertTrue(
          "The navigation process native ScreenStack had empty geometry.",
          (stack?.width ?: 0) > 0 && (stack?.height ?: 0) > 0,
      )
      retainedStack = stack
      val toolbar =
          findAndroidView(activity.window.decorView) {
            it is Toolbar && it.title?.toString() == expectedHeader
          } as? Toolbar
      assertTrue("The navigation process proof did not mount its native toolbar.", toolbar != null)
      assertTrue(
          "The navigation process native toolbar had empty geometry.",
          (toolbar?.width ?: 0) > 0 && (toolbar?.height ?: 0) > 0,
      )
    }
    return checkNotNull(retainedStack)
  }

  private fun assertNavigationProcessNativeIdentity(
      activity: Activity,
      retainedStack: View,
      retainedScreens: List<View>,
      phase: String,
  ) {
    assertTrue(
        "The native ScreenStack was recreated during $phase.",
        retainedStack ===
            assertNavigationProcessStack(activity, NAVIGATION_PROCESS_DETAIL_HEADER),
    )
    val screens = waitForNavigationProcessScreens(activity, retainedScreens.size)
    assertTrue(
        "A native Screen was recreated during $phase.",
        retainedScreens.all { retained -> screens.any { it === retained } },
    )
  }

  private fun waitForNavigationProcessScreens(
      activity: Activity,
      expectedCount: Int,
  ): List<View> {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var screens = emptyList<View>()
      instrumentation.runOnMainSync {
        val stacks = mutableListOf<View>()
        collectAndroidViews(activity.window.decorView, stacks) { it is ScreenStack }
        screens =
            (stacks.singleOrNull() as? ScreenStack)
                ?.fragments
                ?.map { it.screen }
                ?: emptyList()
      }
      if (screens.size == expectedCount) return screens
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The navigation process did not retain $expectedCount native Screen instances.")
    throw AssertionError("unreachable")
  }

  private fun waitForNavigationProcessScrollView(
      activity: Activity,
  ): ReactScrollView {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var scrollView: ReactScrollView? = null
      instrumentation.runOnMainSync {
        scrollView =
            findAndroidView(activity.window.decorView) { it is ReactScrollView }
                as? ReactScrollView
      }
      if (scrollView != null) return checkNotNull(scrollView)
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The navigation process did not mount its restorable ReactScrollView.")
    throw AssertionError("unreachable")
  }

  private fun waitForNavigationProcessScrollOffset(
      scrollView: ReactScrollView,
      expected: Int,
  ) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    val tolerance = 4
    while (SystemClock.uptimeMillis() < deadline) {
      var actual = 0
      instrumentation.runOnMainSync { actual = scrollView.scrollY }
      if (kotlin.math.abs(actual - expected) <= tolerance) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The navigation ScrollView did not settle at $expected; received ${scrollView.scrollY}.",
    )
  }

  private fun collectAndroidViews(
      view: View,
      views: MutableList<View>,
      predicate: (View) -> Boolean,
  ) {
    if (predicate(view)) views.add(view)
    if (view !is ViewGroup) return
    for (index in 0 until view.childCount) {
      collectAndroidViews(view.getChildAt(index), views, predicate)
    }
  }

  private fun waitForNavigationProcessLogMarker(marker: String) {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(NAVIGATION_PROCESS_FAILURE_MARKER)) {
        fail("The navigation process emitted its JavaScript failure marker before $marker.")
      }
      if (logs.contains(marker)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The navigation process did not emit $marker.")
  }

  private fun waitForNavigationProcessTeardown() {
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
          it.text?.toString() == NAVIGATION_PROCESS_ROOT_CONTENT ||
          it.text?.toString() == NAVIGATION_PROCESS_DETAIL_CONTENT ||
          it.text?.toString() == NAVIGATION_PROCESS_LINKED_CONTENT ||
          it.text?.toString() == NAVIGATION_PROCESS_PRODUCT_LOGIN_CONTENT ||
          it.text?.toString() == NAVIGATION_PROCESS_PRODUCT_HOME_CONTENT ||
          it.contentDescription?.toString() == NAVIGATION_PROCESS_PUSH_LABEL ||
          it.contentDescription?.toString() == NAVIGATION_PROCESS_PRODUCT_START_LABEL ||
          it.contentDescription?.toString() == NAVIGATION_PROCESS_PRODUCT_INTERRUPT_LABEL ||
          it.contentDescription?.toString() == NAVIGATION_PROCESS_SEED_LABEL ||
          it.contentDescription?.toString() == NAVIGATION_PROCESS_DISPOSE_LABEL
    }
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(NAVIGATION_PROCESS_FAILURE_MARKER)) {
        fail("The navigation process emitted its JavaScript failure marker during teardown.")
      }
      if (logs.contains(NAVIGATION_PROCESS_TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The navigation process did not acknowledge terminal native-surface teardown.")
  }

  private fun readReactNativeJsLogs(): String =
      ParcelFileDescriptor.AutoCloseInputStream(
              instrumentation.uiAutomation.executeShellCommand(
                  "logcat -d -v brief -s ReactNativeJS:I"
              )
          )
          .bufferedReader()
          .use { it.readText() }

  private fun testSolidNativeTabsSeedRestoration() {
    val activity = launchApplication(NATIVE_TABS_PROCESS_SEED_URL)
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_HOME_CONTENT
    }
    val settingsTab = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    assertTrue("The native Settings seed tab was not clickable.", settingsTab.isClickable)
    tapCenter(settingsTab)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_SETTINGS_CONTENT
    }
    val nestedPush = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_NESTED_PUSH_LABEL
    }
    assertTrue("The process seed stack push was not clickable.", nestedPush.isClickable)
    tapCenter(nestedPush)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_ROUTED_DETAIL_STATE
    }
    val persist = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_PROCESS_SEED_LABEL
    }
    assertTrue("The process seed persistence control was not clickable.", persist.isClickable)
    tapCenter(persist)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT ||
          it.contentDescription?.toString() == NATIVE_TABS_PROCESS_SEED_LABEL ||
          it.contentDescription?.toString() == NATIVE_TABS_HOME_LABEL ||
          it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    waitForNativeTabsTeardown()
    assertProcessStillRunning(activity)
  }

  private fun testSolidNativeTabsRestoreProcess() {
    val activity = launchApplication()
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_PROCESS_RESTORATION_STATE
    }
    val settingsTab = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    assertTrue("The process-restored Settings tab was not selected.", settingsTab.isSelected)
    assertTrue(
        "Android did not deliver system Back to the process-restored Settings history.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_SETTINGS_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_LOADER_PREFIX root"
    }
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The process-restored detail remained after Android system Back.",
    ) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_DISPOSE_LABEL
    }
    assertTrue("The restored native tabs disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_SETTINGS_CONTENT ||
          it.contentDescription?.toString() == NATIVE_TABS_DISPOSE_LABEL ||
          it.contentDescription?.toString() == NATIVE_TABS_HOME_LABEL ||
          it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    waitForNativeTabsTeardown()
    assertProcessStillRunning(activity)
  }

  private fun testSolidNativeTabsProductComposition() {
    val activity = launchApplication(NATIVE_TABS_PRODUCT_COMPOSITION_URL)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_PRODUCT_LOGIN_CONTENT
    }
    waitForNativeTabsLogMarker(NATIVE_TABS_PRODUCT_AUTH_REDIRECT_MARKER)
    val loginScreen = waitForNavigationProcessScreens(activity, 1).single()
    val authenticate = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_PRODUCT_LOGIN_LABEL
    }
    assertTrue("The composed authentication control was not clickable.", authenticate.isClickable)
    tapCenter(authenticate)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_SETTINGS_CONTENT
    }
    val settingsTab = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    assertTrue("The product Settings tab was not selected.", settingsTab.isSelected)
    val retainedBottomNavigation = waitForLoadedNativeTabsBottomNavigation(activity)
    val rootScreen = waitForNavigationProcessScreens(activity, 1).single()
    assertTrue(
        "The authentication replacement did not retain its first native Screen.",
        rootScreen === loginScreen,
    )
    val retainedStack = waitForNativeTabsScreenStack(activity)

    val increment = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_INCREMENT_LABEL
    }
    assertTrue("The product settings state control was not clickable.", increment.isClickable)
    tapCenter(increment)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_SETTINGS_STATE_PREFIX 1"
    }

    val nestedPush = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_NESTED_PUSH_LABEL
    }
    assertTrue("The product nested-stack push was not clickable.", nestedPush.isClickable)
    tapCenter(nestedPush)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith("$NATIVE_TABS_NESTED_STATE_PREFIX 1;") == true
    }
    val detailScreens = waitForNavigationProcessScreens(activity, 2)
    assertTrue(
        "The nested product push replaced its root Screen.",
        detailScreens.any { it === rootScreen },
    )
    val detailScreen = detailScreens.single { it !== rootScreen }
    assertTrue(
        "The product nested ScreenStack was replaced during its push.",
        waitForNativeTabsScreenStack(activity) === retainedStack,
    )

    val openSheet = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_NESTED_SHEET_OPEN_LABEL
    }
    assertTrue("The nested product sheet control was not clickable.", openSheet.isClickable)
    tapCenter(openSheet)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_SHEET_PENDING_STATE
    }
    val interruptSheet = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_NESTED_SHEET_INTERRUPT_LABEL
    }
    assertTrue("The nested product sheet interruption was not clickable.", interruptSheet.isClickable)
    tapCenter(interruptSheet)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_SHEET_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString()?.startsWith(NATIVE_TABS_NESTED_SHEET_STATE) == true
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_LOADER_PREFIX sheet"
    }
    waitForNativeTabsLogMarker(NATIVE_TABS_PRODUCT_INTERRUPTION_MARKER)
    val sheetScreens = waitForNavigationProcessScreens(activity, 3)
    assertTrue(
        "The nested sheet replaced a retained product Screen.",
        sheetScreens.any { it === rootScreen } && sheetScreens.any { it === detailScreen },
    )
    val sheetScreen = sheetScreens.single { it !== rootScreen && it !== detailScreen }
    instrumentation.runOnMainSync {
      assertTrue(
          "The nested Material sheet had empty geometry.",
          sheetScreen.width > 0 && sheetScreen.height > 0,
      )
    }
    assertTrue(
        "The product nested ScreenStack was replaced by its sheet.",
        waitForNativeTabsScreenStack(activity) === retainedStack,
    )

    assertTrue(
        "Android did not dismiss the nested product sheet through system Back.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The nested product sheet remained after Android Back.",
    ) {
      it.text?.toString() == NATIVE_TABS_NESTED_SHEET_CONTENT
    }
    val returnedDetailScreens = waitForNavigationProcessScreens(activity, 2)
    assertTrue(
        "The nested product sheet dismissal replaced retained Screens.",
        returnedDetailScreens.any { it === rootScreen } &&
            returnedDetailScreens.any { it === detailScreen },
    )

    val homeTab = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_HOME_LABEL
    }
    tapCenter(homeTab)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_HOME_CONTENT
    }
    assertTrue(
        "The native tab host changed after dismissing the nested sheet.",
        waitForLoadedNativeTabsBottomNavigation(activity) === retainedBottomNavigation,
    )
    val settingsAgain = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    tapCenter(settingsAgain)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith("$NATIVE_TABS_NESTED_STATE_PREFIX 1;") == true
    }
    assertTrue(
        "The nested ScreenStack changed across the product tab switch.",
        waitForNativeTabsScreenStack(activity) === retainedStack,
    )

    assertTrue(
        "Android did not pop the retained product detail through system Back.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_SETTINGS_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_SETTINGS_STATE_PREFIX 1"
    }
    assertTrue(
        "The product root Screen was not retained after both platform pops.",
        waitForNavigationProcessScreens(activity, 1).single() === rootScreen,
    )
    assertTrue(
        "The nested ScreenStack changed before product teardown.",
        waitForNativeTabsScreenStack(activity) === retainedStack,
    )

    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_DISPOSE_LABEL
    }
    assertTrue("The product composition disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNativeTabsTeardown()
    assertProcessStillRunning(activity)
  }

  private fun testSolidNativeTabsProductSessionRestore() {
    val activity = launchApplication(NATIVE_TABS_PRODUCT_SESSION_RESTORE_URL)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_PRODUCT_SESSION_RESTORED_CONTENT
    }
    waitForNativeTabsLogMarker(NATIVE_TABS_PRODUCT_SESSION_RESTORE_MARKER)
    assertTrue(
        "The protected cold launch rendered login despite its restored device credential.",
        findNode(instrumentation.uiAutomation.rootInActiveWindow) {
          it.text?.toString() == NATIVE_TABS_PRODUCT_LOGIN_CONTENT
        } == null,
    )
    assertEquals(
        "The restored secure session did not mount one protected native Screen.",
        1,
        waitForNavigationProcessScreens(activity, 1).size,
    )
    val clearSession = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_PRODUCT_SESSION_CLEAR_LABEL
    }
    assertTrue("The secure logout control was not clickable.", clearSession.isClickable)
    tapCenter(clearSession)
    waitForNativeTabsLogMarker(NATIVE_TABS_PRODUCT_SESSION_CLEARED_MARKER)
    waitForNativeTabsTeardown()
    assertProcessStillRunning(activity)
  }

  private fun testSolidNativeTabsColdLink() {
    val activity = launchApplication(NATIVE_TABS_DEEP_LINK_URL)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    val settingsTab = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    assertTrue("The cold-linked Settings tab was not selected.", settingsTab.isSelected)
    val initialHomeTab = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_HOME_LABEL
    }
    assertFalse("The cold-linked Home tab was selected.", initialHomeTab.isSelected)
    assertTrue("The unselected native Home tab was not clickable.", initialHomeTab.isClickable)
    val bottomNavigation = waitForLoadedNativeTabsBottomNavigation(activity)
    instrumentation.runOnMainSync {
      assertTrue(
          "The native Android tab bar had empty geometry.",
          bottomNavigation.width > 0 && bottomNavigation.height > 0,
      )
      val menu =
          bottomNavigation
              .javaClass
              .getMethod("getMenu")
              .invoke(bottomNavigation) as? android.view.Menu
      assertEquals("The native Android tab bar did not expose both tabs.", 2, menu?.size())
      assertTrue("The URI-backed native Home tab icon was not installed.", menu?.getItem(0)?.icon != null)
      assertTrue(
          "The native Settings tab drawable was not installed.",
          menu?.getItem(1)?.icon != null,
      )
    }

    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_COLD_LINK_STATE
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_LOADER_PREFIX detail"
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_HEADER
    }
    val resetColdLink = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_NESTED_RESET_LABEL
    }
    assertTrue("The cold-link reset control was not clickable.", resetColdLink.isClickable)
    tapCenter(resetColdLink)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_SETTINGS_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_SETTINGS_STATE_PREFIX 0"
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_LOADER_PREFIX root"
    }
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The reset cold-linked detail remained in the Android accessibility tree.",
    ) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    val increment = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_INCREMENT_LABEL
    }
    assertTrue("The settings state control was not clickable.", increment.isClickable)
    tapCenter(increment)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_SETTINGS_STATE_PREFIX 1"
    }
    val nestedPush = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_NESTED_PUSH_LABEL
    }
    assertTrue("The nested stack push control was not clickable.", nestedPush.isClickable)
    tapCenter(nestedPush)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith("$NATIVE_TABS_NESTED_STATE_PREFIX 1;") == true
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_LOADER_PREFIX detail"
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_HEADER
    }
    instrumentation.runOnMainSync {
      val nestedStack =
          findAndroidView(activity.window.decorView) {
            it.javaClass.name == NATIVE_TABS_SCREEN_STACK_CLASS
          }
      assertTrue("The Settings tab did not mount a native ScreenStack.", nestedStack != null)
      assertTrue(
          "The nested native ScreenStack had empty geometry.",
          nestedStack?.width ?: 0 > 0 && nestedStack?.height ?: 0 > 0,
      )
      val nestedToolbar =
          findAndroidView(activity.window.decorView) {
            it is Toolbar && it.width > 0 && it.height > 0
          }
      assertTrue("The nested native stack header had empty geometry.", nestedToolbar != null)
    }

    val homeTab = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_HOME_LABEL
    }
    tapCenter(homeTab)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_HOME_CONTENT
    }
    val settingsAgain = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    tapCenter(settingsAgain)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString()?.startsWith("$NATIVE_TABS_NESTED_STATE_PREFIX 1;") == true
    }
    assertTrue(
        "Android did not deliver system Back to the selected tab history.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_SETTINGS_CONTENT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_SETTINGS_STATE_PREFIX 1"
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == "$NATIVE_TABS_LOADER_PREFIX root"
    }
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The popped nested detail remained in the Android accessibility tree.",
    ) {
      it.text?.toString() == NATIVE_TABS_NESTED_DETAIL_CONTENT
    }

    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == NATIVE_TABS_DISPOSE_LABEL
    }
    assertTrue("The native tabs disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.text?.toString() == NATIVE_TABS_SETTINGS_CONTENT ||
          it.contentDescription?.toString() == NATIVE_TABS_DISPOSE_LABEL ||
          it.contentDescription?.toString() == NATIVE_TABS_HOME_LABEL ||
          it.contentDescription?.toString() == NATIVE_TABS_SETTINGS_LABEL
    }
    waitForNativeTabsTeardown()
    assertProcessStillRunning(activity)
  }

  private fun waitForNativeTabsTeardown() {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(NATIVE_TABS_FAILURE_MARKER)) {
        fail("The native tabs process emitted its JavaScript failure marker during teardown.")
      }
      if (logs.contains(NATIVE_TABS_TEARDOWN_MARKER)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native tabs process did not acknowledge terminal native-surface teardown.")
  }

  private fun waitForNativeTabsLogMarker(marker: String) {
    val deadline = SystemClock.uptimeMillis() + TEARDOWN_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      val logs = readReactNativeJsLogs()
      if (logs.contains(NATIVE_TABS_FAILURE_MARKER)) {
        fail("The native tabs process emitted its JavaScript failure marker.")
      }
      if (logs.contains(marker)) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native tabs process did not publish $marker.")
  }

  private fun testSolidPressSignalAndTeardown() {
    grantRuntimePermissions()
    val cameraProbe = CameraAvailabilityProbe()
    val initiallyAvailableCameras =
        cameraProbe.waitForInitialAvailability(READY_TIMEOUT_MS)
    val activity = launchApplication(DEEP_LINK_URL)

    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == DEEP_LINK_TEXT
    }

    val title = waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == SOLID_TITLE
    }
    assertTrue("The Solid Native title did not expose its header role.", title.isHeading)
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == SCREEN_FOCUSED_TEXT && hasNonEmptyBounds(it)
    }
    val resourceProofStart = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == RESOURCE_PROOF_START_LABEL &&
          it.isClickable &&
          hasNonEmptyBounds(it)
    }
    assertTrue(
        "The intensive device proof gate was not clickable.",
        resourceProofStart.isClickable,
    )
    tapCenter(resourceProofStart)
    val notification = waitForNotification(READY_TIMEOUT_MS)
    assertEquals(
        NOTIFICATION_PROOF_TITLE,
        notification.notification.extras
            .getCharSequence(Notification.EXTRA_TITLE)
            ?.toString(),
    )
    assertEquals(
        NOTIFICATION_PROOF_BODY,
        notification.notification.extras
            .getCharSequence(Notification.EXTRA_TEXT)
            ?.toString(),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NOTIFICATION_DELIVERED_TEXT
    }
    assertTrue(
        "Android did not open the notification shade.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
        ),
    )
    val notificationBody = waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NOTIFICATION_PROOF_TITLE && hasNonEmptyBounds(it)
    }
    tapCenter(notificationBody)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NOTIFICATION_PRESSED_TEXT
    }
    val openedCameraId =
        cameraProbe.waitForCameraOpen(
            initiallyAvailableCameras,
            READY_TIMEOUT_MS * 2,
        )
    waitForStreamingCameraPreview(activity, READY_TIMEOUT_MS)
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == CAMERA_SESSION_STARTED_TEXT
    }
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == CAMERA_CAPTURE_TEXT
    }
    val image = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == SOLID_IMAGE_LABEL
    }
    assertEquals("android.widget.ImageView", image.className?.toString())
    assertTrue("The native Image was not accessibility-focusable.", image.isFocusable)
    val activityIndicator = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == SOLID_ACTIVITY_INDICATOR_LABEL
    }
    // React Native's AndroidProgressBar manager intentionally exposes its
    // ProgressBarContainerView (a FrameLayout) as the accessible native view;
    // the platform ProgressBar is its implementation child.
    assertEquals(
        "android.widget.FrameLayout",
        activityIndicator.className?.toString(),
    )
    val initialButton = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == SOLID_BUTTON_LABEL
    }
    assertEquals("android.widget.Button", initialButton.className?.toString())
    assertTrue("The Solid Pressable was not clickable.", initialButton.isClickable)
    assertTrue("The Solid Pressable was not enabled.", initialButton.isEnabled)
    assertTrue("The Solid Pressable was not accessibility-focusable.", initialButton.isFocusable)
    assertFalse("The Solid Pressable unexpectedly exposed selected state.", initialButton.isSelected)
    val scrollView = waitForNode(READY_TIMEOUT_MS) {
      it.viewIdResourceName == SOLID_SCROLL_VIEW_ID
    }
    assertEquals("android.widget.ScrollView", scrollView.className?.toString())
    assertTrue("The native ScrollView was not exposed as scrollable.", scrollView.isScrollable)
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == ASYNC_LOADING_TEXT
    }
    var movedToBackground = false
    instrumentation.runOnMainSync {
      movedToBackground = activity.moveTaskToBack(true)
    }
    assertTrue("The app task did not move to the background.", movedToBackground)
    SystemClock.sleep(LIFECYCLE_SETTLE_MS)

    val resumeIntent =
        checkNotNull(
            instrumentation.targetContext.packageManager
                .getLaunchIntentForPackage(SOLID_APP_ID)
        )
    resumeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    instrumentation.targetContext.startActivity(resumeIntent)
    instrumentation.waitForIdleSync()

    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == LIFECYCLE_READY_TEXT
    }
    val resumedButton = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == SOLID_BUTTON_LABEL
    }
    tapCenter(resumedButton)

    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == SIGNAL_TEXT }
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == ASYNC_READY_TEXT }
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == IMAGE_READY_TEXT }
    waitForNode(PROOF_TIMEOUT_MS) { it.text?.toString() == SCROLL_READY_TEXT }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_DETAIL_TEXT
    }
    val navigationHeader = waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_DETAIL_HEADER_TEXT
    }
    assertEquals("android.widget.TextView", navigationHeader.className?.toString())
    var nativeNavigationToolbar: Toolbar? = null
    instrumentation.runOnMainSync {
      nativeNavigationToolbar =
          findAndroidView(activity.window.decorView) {
            it is Toolbar && it.title?.toString() == NAVIGATION_DETAIL_HEADER_TEXT
          } as? Toolbar
    }
    assertTrue(
        "The detail title was not mounted by a native toolbar.",
        nativeNavigationToolbar != null,
    )
    assertTrue(
        "The native detail toolbar had empty geometry.",
        checkNotNull(nativeNavigationToolbar).width > 0 &&
            checkNotNull(nativeNavigationToolbar).height > 0,
    )
    SystemClock.sleep(NAVIGATION_SETTLE_MS)
    assertTrue(
        "Android did not deliver the blocked system back action.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    SystemClock.sleep(NAVIGATION_SETTLE_MS)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == NAVIGATION_DETAIL_TEXT
    }
    assertTrue(
        "Android did not deliver the allowed system back action to RNSScreenStack.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The native navigation detail remained after Android system back.",
    ) {
      it.text?.toString() == NAVIGATION_DETAIL_TEXT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == SOLID_BUTTON_LABEL
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == SCREEN_FOCUSED_TEXT
    }
    // Focus text is mounted by the native lifecycle callback one commit before
    // JavaScript completes its restored-screen measurement. Do not race the
    // next operating-system URL delivery against that measurement.
    SystemClock.sleep(LIFECYCLE_SETTLE_MS)
    val deepLinkIntent =
        Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK_URL)).apply {
          setPackage(SOLID_APP_ID)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    instrumentation.targetContext.startActivity(deepLinkIntent)
    instrumentation.waitForIdleSync()
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == DEEP_LINK_TEXT
    }
    val textInput = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == TEXT_INPUT_LABEL
    }
    assertEquals("android.widget.EditText", textInput.className?.toString())
    assertTrue("The native TextInput was not editable.", textInput.isEditable)
    assertTrue("The native TextInput was not enabled.", textInput.isEnabled)
    assertTrue("The native TextInput was not focusable.", textInput.isFocusable)
    assertFalse("The ordinary native TextInput exposed password state.", textInput.isPassword)
    tapCenter(textInput)
    waitForImeVisibility(activity, true)
    instrumentation.sendStringSync(TEXT_INPUT_VALUE)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == TEXT_INPUT_LABEL &&
          it.text?.toString() == TEXT_INPUT_CONTROLLED_VALUE
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == TEXT_INPUT_SELECTION_READY_TEXT
    }
    instrumentation.sendStringSync(TEXT_INPUT_SELECTION_INSERTION)
    val restoredTextInput = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == TEXT_INPUT_LABEL &&
          it.text?.toString() == TEXT_INPUT_CONTROLLED_VALUE
    }
    assertEquals(
        "Solid did not restore the controlled native editor after selection insertion.",
        TEXT_INPUT_CONTROLLED_VALUE,
        restoredTextInput.text?.toString(),
    )
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == TEXT_INPUT_SUBMIT_READY_TEXT
    }
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_ENTER)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == TEXT_INPUT_SUBMITTED_TEXT
    }
    waitForImeVisibility(activity, false)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == MULTILINE_TEXT_INPUT_READY_TEXT
    }
    val multilineTextInput = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == MULTILINE_TEXT_INPUT_LABEL
    }
    assertEquals("android.widget.EditText", multilineTextInput.className?.toString())
    assertTrue("The multiline TextInput was not exposed as multiline.", multilineTextInput.isMultiLine)
    assertTrue("The multiline TextInput was not editable.", multilineTextInput.isEditable)
    tapCenter(multilineTextInput)
    instrumentation.sendStringSync("Solid")
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == MULTILINE_TEXT_INPUT_LABEL &&
          it.text?.toString() == "Solid"
    }
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_ENTER)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == MULTILINE_TEXT_INPUT_LABEL &&
          it.text?.toString() == "Solid\n"
    }
    instrumentation.sendStringSync("Native")
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == MULTILINE_TEXT_INPUT_SUCCEEDED_TEXT
    }
    val completedMultilineTextInput = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == MULTILINE_TEXT_INPUT_LABEL
    }
    assertEquals(
        "The native multiline editor did not retain the physical newline.",
        MULTILINE_TEXT_INPUT_VALUE,
        completedMultilineTextInput.text?.toString(),
    )
    val controlledSwitch = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == SWITCH_LABEL
    }
    assertEquals("android.widget.Switch", controlledSwitch.className?.toString())
    assertTrue("The native Switch was not checkable.", controlledSwitch.isCheckable)
    assertTrue("The native Switch was not clickable.", controlledSwitch.isClickable)
    assertTrue("The native Switch was not enabled.", controlledSwitch.isEnabled)
    assertFalse("The controlled native Switch did not start off.", controlledSwitch.isChecked)
    tapCenter(controlledSwitch)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == SWITCH_SUCCEEDED_TEXT
    }
    val restoredSwitch = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == SWITCH_LABEL
    }
    assertFalse(
        "Solid did not restore the rejected native Switch change.",
        restoredSwitch.isChecked,
    )
    val modalPresent = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == MODAL_PRESENT_LABEL
    }
    assertEquals("android.widget.Button", modalPresent.className?.toString())
    tapCenter(modalPresent)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == MODAL_TITLE_TEXT
    }
    val modalClose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == MODAL_CLOSE_LABEL
    }
    assertEquals("android.widget.Button", modalClose.className?.toString())
    assertTrue("The native Modal close control was not clickable.", modalClose.isClickable)
    assertTrue(
        "Android did not deliver system Back to the native Modal.",
        instrumentation.uiAutomation.performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        ),
    )
    // Some Android keyboards consume the first Back even after a Switch or
    // button tap has moved accessibility focus. If the Dialog is still the
    // active window, the second Back is the one ReactModalHostView receives.
    SystemClock.sleep(NAVIGATION_SETTLE_MS)
    if (
        findNode(instrumentation.uiAutomation.rootInActiveWindow) {
          it.text?.toString() == MODAL_TITLE_TEXT
        } != null
    ) {
      assertTrue(
          "Android did not deliver the post-IME Back action to the native Modal.",
          instrumentation.uiAutomation.performGlobalAction(
              AccessibilityService.GLOBAL_ACTION_BACK
          ),
      )
    }
    waitForNodeToDisappear(PROOF_TIMEOUT_MS) {
      it.text?.toString() == MODAL_TITLE_TEXT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == DEEP_LINK_TEXT
    }
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.contentDescription?.toString() == SOLID_BUTTON_LABEL ||
          it.text?.toString() == SIGNAL_TEXT ||
          it.text?.toString() == ASYNC_READY_TEXT ||
          it.text?.toString() == IMAGE_READY_TEXT ||
          it.text?.toString() == SCROLL_READY_TEXT ||
          it.text?.toString() == CAMERA_CAPTURE_TEXT ||
          it.text?.toString() == DEEP_LINK_TEXT
    }
    waitForNotificationToDisappear(PROOF_TIMEOUT_MS)
    cameraProbe.waitForCameraRelease(openedCameraId, PROOF_TIMEOUT_MS)
    cameraProbe.close()
    assertProcessStillRunning(activity)
  }

  private fun testSolidVirtualizedList() {
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == VIRTUALIZED_LIST_READY_TEXT
    }
    val list = waitForNode(READY_TIMEOUT_MS) {
      it.viewIdResourceName == VIRTUALIZED_LIST_ID
    }
    assertEquals("android.widget.ScrollView", list.className?.toString())
    assertTrue("The physical VirtualizedList was not scrollable.", list.isScrollable)
    waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == "${VIRTUALIZED_ROW_PREFIX}0"
    }
    val initialNativeRows = captureNativeRows(activity, VIRTUALIZED_ROW_PREFIX)

    val frameProbe = FrameMetricsProbe(activity)
    lateinit var frameSummary: FrameMetricsSummary
    try {
      swipeUp(list)
      waitForNode(PROOF_TIMEOUT_MS) {
        it.text?.toString() == VIRTUALIZED_LIST_SUCCEEDED_TEXT
      }
    } finally {
      frameSummary = frameProbe.stop()
    }
    assertTrue(
        "The physical VirtualizedList produced too few measured frames: ${frameSummary.frameCount}.",
        frameSummary.frameCount >= VIRTUALIZED_MINIMUM_MEASURED_FRAMES,
    )
    assertEquals(
        "Android dropped VirtualizedList frame-metrics reports.",
        0,
        frameSummary.droppedReports,
    )
    assertEquals(
        "The physical VirtualizedList produced a frozen frame.",
        0,
        frameSummary.frozenFrameCount,
    )
    Log.i(
        "SOLID_NATIVE",
        "SOLID_NATIVE_VIRTUALIZED_LIST_FRAME_METRICS " + frameMetricsJson(frameSummary),
    )
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The first virtualized row remained mounted after a physical window shift.",
    ) {
      it.contentDescription?.toString() == "${VIRTUALIZED_ROW_PREFIX}0"
    }
    val mountedRows =
        countNodes(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString()?.startsWith(VIRTUALIZED_ROW_PREFIX) == true
        }
    assertTrue("The physical VirtualizedList mounted no accessible rows.", mountedRows > 0)
    assertTrue(
        "The physical VirtualizedList exceeded its bounded row window: $mountedRows.",
        mountedRows <= VIRTUALIZED_MAXIMUM_MOUNTED_ROWS,
    )
    val scrolledNativeRows = captureNativeRows(activity, VIRTUALIZED_ROW_PREFIX)
    val anchorBefore = captureVisibleVirtualizedRow(list, VIRTUALIZED_ROW_PREFIX)
    val anchoredNativeView =
        scrolledNativeRows.entries.firstOrNull { it.value == anchorBefore.label }?.key
    assertTrue(
        "The visible VirtualizedList anchor had no corresponding native View.",
        anchoredNativeView != null,
    )
    val prependButton = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == VIRTUALIZED_LIST_PREPEND_LABEL
    }
    assertEquals("android.widget.Button", prependButton.className?.toString())
    assertTrue("The VirtualizedList prepend control was not clickable.", prependButton.isClickable)
    assertTrue("The VirtualizedList prepend control was not enabled.", prependButton.isEnabled)
    tapCenter(prependButton)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == VIRTUALIZED_LIST_PREPEND_SUCCEEDED_TEXT
    }
    val anchorAfterNode = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == anchorBefore.label
    }
    val anchorAfterBounds = Rect()
    anchorAfterNode.getBoundsInScreen(anchorAfterBounds)
    assertTrue(
        "The keyed VirtualizedList anchor moved after prepend: " +
            "${anchorBefore.bounds} -> $anchorAfterBounds.",
        kotlin.math.abs(anchorAfterBounds.top - anchorBefore.bounds.top) <=
            VIRTUALIZED_ANCHOR_PIXEL_TOLERANCE &&
            kotlin.math.abs(anchorAfterBounds.bottom - anchorBefore.bounds.bottom) <=
                VIRTUALIZED_ANCHOR_PIXEL_TOLERANCE,
    )
    val prependedNativeRows = captureNativeRows(activity, VIRTUALIZED_ROW_PREFIX)
    assertEquals(
        "The keyed VirtualizedList anchor did not retain its exact native View.",
        anchorBefore.label,
        prependedNativeRows[anchoredNativeView],
    )
    val prependedMountedRows =
        countNodes(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString()?.startsWith(VIRTUALIZED_ROW_PREFIX) == true
        }
    assertTrue(
        "The prepended VirtualizedList mounted no accessible original rows.",
        prependedMountedRows > 0,
    )
    assertTrue(
        "The prepended VirtualizedList exceeded its bounded row window: $prependedMountedRows.",
        prependedMountedRows <= VIRTUALIZED_MAXIMUM_MOUNTED_ROWS,
    )
    Log.i(
        "SOLID_NATIVE",
        "SOLID_NATIVE_VIRTUALIZED_LIST_NATIVE_ANCHOR_SUCCEEDED " +
            JSONObject()
                .put("schemaVersion", 0)
                .put("anchor", anchorBefore.label)
                .put("beforeTop", anchorBefore.bounds.top)
                .put("afterTop", anchorAfterBounds.top)
                .put("nativeViewRetained", true)
                .put("mountedRows", prependedMountedRows),
    )
    val imperativeButton = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == VIRTUALIZED_LIST_IMPERATIVE_LABEL
    }
    assertEquals("android.widget.Button", imperativeButton.className?.toString())
    assertTrue(
        "The VirtualizedList imperative control was not clickable.",
        imperativeButton.isClickable,
    )
    assertTrue(
        "The VirtualizedList imperative control was not enabled.",
        imperativeButton.isEnabled,
    )
    tapCenter(imperativeButton)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == VIRTUALIZED_LIST_IMPERATIVE_SUCCEEDED_TEXT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() ==
          "$VIRTUALIZED_ROW_PREFIX$VIRTUALIZED_LIST_IMPERATIVE_INDEX"
    }
    val imperativeMountedRows =
        countNodes(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString()?.startsWith(VIRTUALIZED_ROW_PREFIX) == true
        }
    assertTrue(
        "The imperative VirtualizedList mounted no accessible rows.",
        imperativeMountedRows > 0,
    )
    assertTrue(
        "The imperative VirtualizedList exceeded its bounded row window: $imperativeMountedRows.",
        imperativeMountedRows <= VIRTUALIZED_MAXIMUM_MOUNTED_ROWS,
    )
    if (BuildConfig.SOLID_NATIVE_VIEW_RECYCLING) {
      val imperativeNativeRows = captureNativeRows(activity, VIRTUALIZED_ROW_PREFIX)
      val reuse =
          findNativeRowReuse(
              listOf(initialNativeRows, scrolledNativeRows, imperativeNativeRows)
          )
      assertTrue(
          "React Native enabled view recycling but no native row View represented two logical rows.",
          reuse != null,
      )
      Log.i(
          "SOLID_NATIVE",
          "SOLID_NATIVE_VIEW_RECYCLING_SUCCEEDED " +
              JSONObject()
                  .put("schemaVersion", 0)
                  .put("fromRow", reuse?.first)
                  .put("toRow", reuse?.second),
      )
    }
    val disposeButton = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == VIRTUALIZED_LIST_DISPOSE_LABEL
    }
    assertEquals("android.widget.Button", disposeButton.className?.toString())
    assertTrue("The VirtualizedList dispose control was not clickable.", disposeButton.isClickable)
    assertTrue("The VirtualizedList dispose control was not enabled.", disposeButton.isEnabled)
    tapCenter(disposeButton)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.viewIdResourceName == VIRTUALIZED_LIST_ID ||
          it.contentDescription?.toString() == VIRTUALIZED_LIST_DISPOSE_LABEL ||
          it.contentDescription?.toString()?.startsWith(VIRTUALIZED_ROW_PREFIX) == true ||
          it.text?.toString() == VIRTUALIZED_LIST_SUCCEEDED_TEXT ||
          it.text?.toString() == VIRTUALIZED_LIST_IMPERATIVE_SUCCEEDED_TEXT
    }
    assertProcessStillRunning(activity)
  }

  @Test
  fun testPhysicalInitialVirtualizedList() {
    assertEquals(LIST_APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == INITIAL_VIRTUALIZED_LIST_READY_TEXT
    }
    val list = waitForNode(READY_TIMEOUT_MS) {
      it.viewIdResourceName == INITIAL_VIRTUALIZED_LIST_ID
    }
    assertEquals("android.widget.ScrollView", list.className?.toString())
    assertTrue("The initially positioned VirtualizedList was not scrollable.", list.isScrollable)
    waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() ==
          "$INITIAL_VIRTUALIZED_ROW_PREFIX$INITIAL_VIRTUALIZED_LIST_INDEX"
    }
    assertTrue(
        "The initially positioned VirtualizedList first painted row zero.",
        findNode(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString() == "${INITIAL_VIRTUALIZED_ROW_PREFIX}0"
        } == null,
    )
    val mountedRows =
        countNodes(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString()?.startsWith(INITIAL_VIRTUALIZED_ROW_PREFIX) == true
        }
    assertEquals(
        "The initial native offset did not mount the exact bounded target window.",
        INITIAL_VIRTUALIZED_LIST_MOUNTED_ROWS,
        mountedRows,
    )
    var nativeScrollY = -1
    instrumentation.runOnMainSync {
      val nativeList =
          findAndroidView(activity.window.decorView) {
            it.contentDescription?.toString() == INITIAL_VIRTUALIZED_LIST_LABEL
          }
      assertTrue("The initial VirtualizedList had no live native ScrollView.", nativeList != null)
      nativeScrollY = checkNotNull(nativeList).scrollY
    }
    val expectedScrollY =
        Math.round(
            INITIAL_VIRTUALIZED_LIST_INDEX *
                INITIAL_VIRTUALIZED_LIST_ITEM_SIZE *
                activity.resources.displayMetrics.density
        )
    assertTrue(
        "The first native VirtualizedList offset was $nativeScrollY px, expected $expectedScrollY px.",
        kotlin.math.abs(nativeScrollY - expectedScrollY) <= 1,
    )
    Log.i(
        "SOLID_NATIVE",
        "SOLID_NATIVE_INITIAL_VIRTUALIZED_LIST_NATIVE_SUCCEEDED " +
            JSONObject()
                .put("schemaVersion", 0)
                .put("initialIndex", INITIAL_VIRTUALIZED_LIST_INDEX)
                .put("mountedRows", mountedRows)
                .put("nativeScrollY", nativeScrollY)
                .put("expectedScrollY", expectedScrollY),
    )
    val dispose = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == INITIAL_VIRTUALIZED_LIST_DISPOSE_LABEL
    }
    assertTrue("The initial VirtualizedList disposal control was not clickable.", dispose.isClickable)
    tapCenter(dispose)
    waitForNodeToDisappear(TEARDOWN_TIMEOUT_MS) {
      it.viewIdResourceName == INITIAL_VIRTUALIZED_LIST_ID ||
          it.contentDescription?.toString() == INITIAL_VIRTUALIZED_LIST_DISPOSE_LABEL ||
          it.contentDescription?.toString()?.startsWith(INITIAL_VIRTUALIZED_ROW_PREFIX) == true
    }
    assertProcessStillRunning(activity)
  }

  @Test
  fun testPhysicalMeasuredVirtualizedList() {
    assertEquals(LIST_APP_ID, instrumentation.targetContext.packageName)
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == MEASURED_VIRTUALIZED_LIST_READY_TEXT
    }
    val list = waitForNode(READY_TIMEOUT_MS) {
      it.viewIdResourceName == MEASURED_VIRTUALIZED_LIST_ID
    }
    assertEquals("android.widget.ScrollView", list.className?.toString())
    assertTrue("The measured VirtualizedList was not scrollable.", list.isScrollable)

    val first = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == "${MEASURED_VIRTUALIZED_ROW_PREFIX}0"
    }
    val second = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == "${MEASURED_VIRTUALIZED_ROW_PREFIX}1"
    }
    val third = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == "${MEASURED_VIRTUALIZED_ROW_PREFIX}2"
    }
    val firstBounds = Rect().also(first::getBoundsInScreen)
    val secondBounds = Rect().also(second::getBoundsInScreen)
    val thirdBounds = Rect().also(third::getBoundsInScreen)
    val density = instrumentation.targetContext.resources.displayMetrics.density
    val expectedShortHeight = kotlin.math.round(MEASURED_SHORT_ROW_DP * density).toInt()
    val expectedTallHeight = kotlin.math.round(MEASURED_TALL_ROW_DP * density).toInt()
    assertTrue(
        "The first intrinsic row height was not preserved: $firstBounds.",
        kotlin.math.abs(firstBounds.height() - expectedShortHeight) <=
            MEASURED_ROW_PIXEL_TOLERANCE,
    )
    assertTrue(
        "The second intrinsic row height was not preserved: $secondBounds.",
        kotlin.math.abs(secondBounds.height() - expectedTallHeight) <=
            MEASURED_ROW_PIXEL_TOLERANCE,
    )
    assertTrue(
        "Measured list rows retained an estimate-sized gap or overlap: " +
            "$firstBounds, $secondBounds, $thirdBounds.",
        kotlin.math.abs(firstBounds.bottom - secondBounds.top) <=
            MEASURED_ROW_PIXEL_TOLERANCE &&
            kotlin.math.abs(secondBounds.bottom - thirdBounds.top) <=
                MEASURED_ROW_PIXEL_TOLERANCE,
    )
    val initialRowWrappers =
        captureNativeRowWrappers(activity, MEASURED_VIRTUALIZED_ROW_PREFIX)

    swipeUp(list)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == MEASURED_VIRTUALIZED_LIST_SUCCEEDED_TEXT
    }
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The first measured row remained mounted after a physical window shift.",
    ) {
      it.contentDescription?.toString() == "${MEASURED_VIRTUALIZED_ROW_PREFIX}0"
    }
    val mountedRows =
        countNodes(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString()?.startsWith(MEASURED_VIRTUALIZED_ROW_PREFIX) == true
        }
    assertTrue("The physical measured list mounted no accessible rows.", mountedRows > 0)
    assertTrue(
        "The measured VirtualizedList exceeded its bounded row window: $mountedRows.",
        mountedRows <= MEASURED_VIRTUALIZED_MAXIMUM_MOUNTED_ROWS,
    )
    val scrolledRowWrappers =
        captureNativeRowWrappers(activity, MEASURED_VIRTUALIZED_ROW_PREFIX)
    val recycled = findNativeRowReuse(listOf(initialRowWrappers, scrolledRowWrappers))
    assertTrue(
        "The renderer-owned measured list did not reuse a native wrapper View across keys.",
        recycled != null,
    )
    Log.i(
        "SOLID_NATIVE",
        "SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_NATIVE_SUCCEEDED " +
            JSONObject()
                .put("schemaVersion", 0)
                .put("shortHeightPx", firstBounds.height())
                .put("tallHeightPx", secondBounds.height())
                .put("adjacent", true)
                .put("mountedRows", mountedRows),
    )
    Log.i(
        "SOLID_NATIVE",
        "SOLID_NATIVE_MEASURED_VIRTUALIZED_LIST_RECYCLING_SUCCEEDED " +
            JSONObject()
                .put("schemaVersion", 0)
                .put("fromRow", recycled?.first)
                .put("toRow", recycled?.second)
                .put("nativeWrapperRetained", true),
    )
    assertProcessStillRunning(activity)
  }

  private fun testReactVirtualizedList() {
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == REACT_LIST_READY_TEXT
    }
    val list = waitForNode(READY_TIMEOUT_MS) {
      it.viewIdResourceName == REACT_LIST_ID
    }
    assertTrue("The React Native FlatList control was not scrollable.", list.isScrollable)
    waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == "${REACT_LIST_ROW_PREFIX}0"
    }

    val frameProbe = FrameMetricsProbe(activity)
    lateinit var frameSummary: FrameMetricsSummary
    try {
      swipeUp(list)
      waitForNode(PROOF_TIMEOUT_MS) {
        it.text?.toString() == REACT_LIST_SUCCEEDED_TEXT
      }
    } finally {
      frameSummary = frameProbe.stop()
    }
    assertTrue(
        "The React Native FlatList produced too few measured frames: ${frameSummary.frameCount}.",
        frameSummary.frameCount >= VIRTUALIZED_MINIMUM_MEASURED_FRAMES,
    )
    assertEquals(
        "Android dropped React Native FlatList frame-metrics reports.",
        0,
        frameSummary.droppedReports,
    )
    assertEquals(
        "The React Native FlatList produced a frozen frame.",
        0,
        frameSummary.frozenFrameCount,
    )
    Log.i(
        "SOLID_NATIVE",
        "SOLID_NATIVE_REACT_LIST_FRAME_METRICS " + frameMetricsJson(frameSummary),
    )
    waitForNodeToDisappear(
        PROOF_TIMEOUT_MS,
        "The first React control row remained accessible after a physical window shift.",
    ) {
      it.contentDescription?.toString() == "${REACT_LIST_ROW_PREFIX}0"
    }
    val mountedRows =
        countNodes(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString()?.startsWith(REACT_LIST_ROW_PREFIX) == true
        }
    assertTrue("The React Native FlatList exposed no rows.", mountedRows > 0)
    assertTrue(
        "The React Native FlatList exposed an unbounded row window: $mountedRows.",
        mountedRows <= REACT_LIST_MAXIMUM_ACCESSIBLE_ROWS,
    )
    val anchorBefore = captureVisibleVirtualizedRow(list, REACT_LIST_ROW_PREFIX)
    val prependButton = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == REACT_LIST_PREPEND_LABEL
    }
    assertEquals("android.widget.Button", prependButton.className?.toString())
    assertTrue("The React list prepend control was not clickable.", prependButton.isClickable)
    assertTrue("The React list prepend control was not enabled.", prependButton.isEnabled)
    tapCenter(prependButton)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == REACT_LIST_PREPEND_SUCCEEDED_TEXT
    }
    val anchorAfter = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == anchorBefore.label
    }
    val anchorAfterBounds = Rect()
    anchorAfter.getBoundsInScreen(anchorAfterBounds)
    assertTrue(
        "The React Native FlatList keyed anchor moved after prepend: " +
            "${anchorBefore.bounds} -> $anchorAfterBounds.",
        kotlin.math.abs(anchorAfterBounds.top - anchorBefore.bounds.top) <=
            VIRTUALIZED_ANCHOR_PIXEL_TOLERANCE &&
            kotlin.math.abs(anchorAfterBounds.bottom - anchorBefore.bounds.bottom) <=
                VIRTUALIZED_ANCHOR_PIXEL_TOLERANCE,
    )
    val prependedRows =
        countNodes(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString()?.startsWith(REACT_LIST_ROW_PREFIX) == true
        }
    assertTrue("The prepended React Native FlatList exposed no original rows.", prependedRows > 0)
    assertTrue(
        "The prepended React Native FlatList exposed an unbounded row window: $prependedRows.",
        prependedRows <= REACT_LIST_MAXIMUM_ACCESSIBLE_ROWS,
    )
    val imperativeButton = waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() == REACT_LIST_IMPERATIVE_LABEL
    }
    assertEquals("android.widget.Button", imperativeButton.className?.toString())
    assertTrue("The React list imperative control was not clickable.", imperativeButton.isClickable)
    assertTrue("The React list imperative control was not enabled.", imperativeButton.isEnabled)
    tapCenter(imperativeButton)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == REACT_LIST_IMPERATIVE_SUCCEEDED_TEXT
    }
    waitForNode(PROOF_TIMEOUT_MS) {
      it.contentDescription?.toString() ==
          "$REACT_LIST_ROW_PREFIX$VIRTUALIZED_LIST_IMPERATIVE_INDEX"
    }
    val imperativeRows =
        countNodes(instrumentation.uiAutomation.rootInActiveWindow) {
          it.contentDescription?.toString()?.startsWith(REACT_LIST_ROW_PREFIX) == true
        }
    assertTrue("The imperative React Native FlatList exposed no rows.", imperativeRows > 0)
    assertTrue(
        "The imperative React Native FlatList exposed an unbounded row window: $imperativeRows.",
        imperativeRows <= REACT_LIST_MAXIMUM_ACCESSIBLE_ROWS,
    )
    assertProcessStillRunning(activity)
  }

  private fun frameMetricsJson(frameSummary: FrameMetricsSummary): JSONObject =
      JSONObject()
          .put("schemaVersion", 1)
          .put("manufacturer", Build.MANUFACTURER)
          .put("model", Build.MODEL)
          .put("sdk", Build.VERSION.SDK_INT)
          .put("osRelease", Build.VERSION.RELEASE)
          .put("frames", frameSummary.frameCount)
          .put("deadlineMisses", frameSummary.deadlineMissCount)
          .put("frozenFrames", frameSummary.frozenFrameCount)
          .put(
              "p50Milliseconds",
              frameSummary.p50Nanos / NANOS_PER_MILLISECOND.toDouble(),
          )
          .put(
              "p95Milliseconds",
              frameSummary.p95Nanos / NANOS_PER_MILLISECOND.toDouble(),
          )
          .put(
              "maxMilliseconds",
              frameSummary.maxNanos / NANOS_PER_MILLISECOND.toDouble(),
          )
          .put("droppedReports", frameSummary.droppedReports)

  private data class FrameSample(
      val totalNanos: Long,
      val deadlineNanos: Long,
  )

  private data class FrameMetricsSummary(
      val frameCount: Int,
      val deadlineMissCount: Int,
      val frozenFrameCount: Int,
      val p50Nanos: Long,
      val p95Nanos: Long,
      val maxNanos: Long,
      val droppedReports: Int,
  )

  private inner class FrameMetricsProbe(private val activity: Activity) {
    private val samples = ConcurrentLinkedQueue<FrameSample>()
    private val droppedReports = AtomicInteger()
    private val callbackThread = HandlerThread("solid-native-frame-metrics")
    private val callbackHandler: Handler
    private val listener =
        Window.OnFrameMetricsAvailableListener { _, frameMetrics, droppedSinceLastInvocation ->
          droppedReports.addAndGet(droppedSinceLastInvocation)
          val totalNanos = frameMetrics.getMetric(FrameMetrics.TOTAL_DURATION)
          if (totalNanos <= 0) return@OnFrameMetricsAvailableListener
          val deadlineNanos =
              if (Build.VERSION.SDK_INT >= 31) {
                frameMetrics.getMetric(FrameMetrics.DEADLINE)
              } else {
                DEFAULT_FRAME_DEADLINE_NANOS
              }
          samples.add(
              FrameSample(
                  totalNanos = totalNanos,
                  deadlineNanos =
                      if (deadlineNanos > 0) deadlineNanos else DEFAULT_FRAME_DEADLINE_NANOS,
              )
          )
        }
    private var stopped = false

    init {
      callbackThread.start()
      callbackHandler = Handler(callbackThread.looper)
      instrumentation.runOnMainSync {
        activity.window.addOnFrameMetricsAvailableListener(listener, callbackHandler)
      }
    }

    fun stop(): FrameMetricsSummary {
      check(!stopped) { "The frame-metrics probe was already stopped." }
      stopped = true
      instrumentation.runOnMainSync {
        activity.window.removeOnFrameMetricsAvailableListener(listener)
      }
      val drained = CountDownLatch(1)
      assertTrue(
          "The Android frame-metrics handler rejected its drain barrier.",
          callbackHandler.post { drained.countDown() },
      )
      assertTrue(
          "Android did not drain VirtualizedList frame metrics.",
          drained.await(FRAME_METRICS_DRAIN_TIMEOUT_MS, TimeUnit.MILLISECONDS),
      )
      callbackThread.quitSafely()
      callbackThread.join(FRAME_METRICS_DRAIN_TIMEOUT_MS)
      assertFalse(
          "The Android frame-metrics thread did not stop.",
          callbackThread.isAlive,
      )

      val orderedDurations = samples.map { it.totalNanos }.sorted()
      return FrameMetricsSummary(
          frameCount = orderedDurations.size,
          deadlineMissCount = samples.count { it.totalNanos >= it.deadlineNanos },
          frozenFrameCount = samples.count { it.totalNanos >= FROZEN_FRAME_NANOS },
          p50Nanos = percentile(orderedDurations, 0.50),
          p95Nanos = percentile(orderedDurations, 0.95),
          maxNanos = orderedDurations.lastOrNull() ?: 0,
          droppedReports = droppedReports.get(),
      )
    }
  }

  private fun percentile(orderedValues: List<Long>, percentile: Double): Long {
    if (orderedValues.isEmpty()) return 0
    val index =
        kotlin.math.ceil(percentile * orderedValues.size)
            .toInt()
            .coerceIn(1, orderedValues.size) - 1
    return orderedValues[index]
  }

  private fun grantRuntimePermissions() {
    instrumentation.uiAutomation
        .executeShellCommand("pm grant $SOLID_APP_ID ${Manifest.permission.CAMERA}")
        .close()
    if (Build.VERSION.SDK_INT < 33) return
    instrumentation.uiAutomation
        .executeShellCommand(
            "pm grant $SOLID_APP_ID ${Manifest.permission.POST_NOTIFICATIONS}"
        )
        .close()
  }

  private inner class CameraAvailabilityProbe {
    private val manager =
        checkNotNull(
            instrumentation.targetContext.getSystemService(CameraManager::class.java)
        )
    private val available = ConcurrentHashMap.newKeySet<String>()
    private val unavailable = ConcurrentHashMap.newKeySet<String>()
    private val callback =
        object : CameraManager.AvailabilityCallback() {
          override fun onCameraAvailable(cameraId: String) {
            unavailable.remove(cameraId)
            available.add(cameraId)
          }

          override fun onCameraUnavailable(cameraId: String) {
            available.remove(cameraId)
            unavailable.add(cameraId)
          }
        }

    init {
      manager.registerAvailabilityCallback(Executor { command -> command.run() }, callback)
    }

    fun waitForInitialAvailability(timeoutMilliseconds: Long): Set<String> {
      val cameraIds = manager.cameraIdList.toSet()
      assertTrue("The physical Android device did not expose a camera.", cameraIds.isNotEmpty())
      val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
      while (SystemClock.uptimeMillis() < deadline) {
        if (cameraIds.all { available.contains(it) || unavailable.contains(it) }) {
          val baseline = cameraIds.filterTo(mutableSetOf()) { available.contains(it) }
          assertTrue(
              "No Android camera was available before the Solid Native app launched.",
              baseline.isNotEmpty(),
          )
          return baseline
        }
        SystemClock.sleep(POLL_INTERVAL_MS)
      }
      fail("Android did not report its initial camera availability.")
      throw AssertionError("unreachable")
    }

    fun waitForCameraOpen(
        initiallyAvailable: Set<String>,
        timeoutMilliseconds: Long,
    ): String {
      val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
      while (SystemClock.uptimeMillis() < deadline) {
        val opened = initiallyAvailable.firstOrNull { unavailable.contains(it) }
        if (opened != null) return opened
        SystemClock.sleep(POLL_INTERVAL_MS)
      }
      fail("Android never observed VisionCamera acquire physical camera hardware.")
      throw AssertionError("unreachable")
    }

    fun waitForCameraRelease(cameraId: String, timeoutMilliseconds: Long) {
      val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
      while (SystemClock.uptimeMillis() < deadline) {
        if (available.contains(cameraId)) return
        SystemClock.sleep(POLL_INTERVAL_MS)
      }
      fail("The owner-bound VisionCamera session did not release camera $cameraId.")
    }

    fun close() {
      manager.unregisterAvailabilityCallback(callback)
    }
  }

  private fun waitForNotification(
      timeoutMilliseconds: Long,
  ): StatusBarNotification {
    val manager =
        checkNotNull(
            instrumentation.targetContext.getSystemService(NotificationManager::class.java)
        )
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      val found =
          manager.activeNotifications.firstOrNull {
            it.notification.extras
                .getCharSequence(Notification.EXTRA_TITLE)
                ?.toString() == NOTIFICATION_PROOF_TITLE
          }
      if (found != null) return found
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The OS-visible Solid Native notification did not appear.")
    throw AssertionError("unreachable")
  }

  private fun waitForNotificationToDisappear(timeoutMilliseconds: Long) {
    val manager =
        checkNotNull(
            instrumentation.targetContext.getSystemService(NotificationManager::class.java)
        )
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      val remains =
          manager.activeNotifications.any {
            it.notification.extras
                .getCharSequence(Notification.EXTRA_TITLE)
                ?.toString() == NOTIFICATION_PROOF_TITLE
          }
      if (!remains) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The canceled Solid Native notification remained visible to Android.")
  }

  private fun waitForStreamingCameraPreview(
      activity: Activity,
      timeoutMilliseconds: Long,
  ) {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      var isStreaming = false
      instrumentation.runOnMainSync {
        val preview = findAndroidView(activity.window.decorView) {
          it.javaClass.name == CAMERA_PREVIEW_CLASS_NAME
        }
        val previewStreamState =
            preview
                ?.javaClass
                ?.getMethod("getPreviewStreamState")
                ?.invoke(preview)
        val streamState =
            previewStreamState
                ?.javaClass
                ?.getMethod("getValue")
                ?.invoke(previewStreamState)
        isStreaming =
            preview != null &&
                preview.isShown &&
                preview.width > 0 &&
                preview.height > 0 &&
                streamState?.toString() == "STREAMING"
      }
      if (isStreaming) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The Solid-owned Android PreviewView did not mount with non-empty bounds and stream physical camera frames."
    )
  }

  private fun testReactControlUpdate() {
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == CONTROL_INITIAL_TEXT
    }
    waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == CONTROL_GENERATED_LABEL
    }
    val button = waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == CONTROL_BUTTON_LABEL
    }
    tapCenter(button)
    waitForNode(PROOF_TIMEOUT_MS) {
      it.text?.toString() == CONTROL_UPDATED_TEXT
    }
    assertProcessStillRunning(activity)
  }

  private fun testMatchedPropertyUpdates() {
    val appId = instrumentation.targetContext.packageName
    val variant =
        if (appId == SOLID_MEMORY_APP_ID) "solid-native" else "react-native"
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == "$MATCHED_UPDATE_STATUS_PREFIX$MATCHED_UPDATE_INITIAL_COUNT"
    }
    waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == MATCHED_UPDATE_GENERATED_LABEL
    }

    val completionNanos = mutableListOf<Long>()
    val frameProbe = FrameMetricsProbe(activity)
    lateinit var frameSummary: FrameMetricsSummary
    try {
      for (eventIndex in 1..MATCHED_UPDATE_COUNT) {
        val button = waitForNode(PROOF_TIMEOUT_MS) {
          it.contentDescription?.toString() == MATCHED_UPDATE_BUTTON_LABEL
        }
        assertTrue("The matched update control was not clickable.", button.isClickable)
        val startedAt = SystemClock.elapsedRealtimeNanos()
        tapCenter(button)
        val expectedCount = MATCHED_UPDATE_INITIAL_COUNT + eventIndex
        waitForNode(PROOF_TIMEOUT_MS) {
          it.text?.toString() == "$MATCHED_UPDATE_STATUS_PREFIX$expectedCount"
        }
        completionNanos.add(SystemClock.elapsedRealtimeNanos() - startedAt)
      }
      instrumentation.waitForIdleSync()
    } finally {
      frameSummary = frameProbe.stop()
    }

    assertEquals(MATCHED_UPDATE_COUNT, completionNanos.size)
    assertTrue(
        "The matched property updates produced too few measured frames: ${frameSummary.frameCount}.",
        frameSummary.frameCount >= MATCHED_UPDATE_MINIMUM_MEASURED_FRAMES,
    )
    assertEquals(
        "Android dropped matched property-update frame reports.",
        0,
        frameSummary.droppedReports,
    )
    assertEquals(
        "The matched property-update workload produced a frozen frame.",
        0,
        frameSummary.frozenFrameCount,
    )
    val orderedCompletionNanos = completionNanos.sorted()
    val completionMilliseconds =
        JSONArray(
            completionNanos.map { duration ->
              duration / NANOS_PER_MILLISECOND.toDouble()
            }
        )
    Log.i(
        "SOLID_NATIVE",
        "SOLID_NATIVE_MATCHED_UPDATE_RESULT " +
            JSONObject()
                .put("schemaVersion", 0)
                .put("variant", variant)
                .put("input", "androidx-touchscreen-injection")
                .put("initialCount", MATCHED_UPDATE_INITIAL_COUNT)
                .put(
                    "finalCount",
                    MATCHED_UPDATE_INITIAL_COUNT + MATCHED_UPDATE_COUNT,
                )
                .put("updateCount", MATCHED_UPDATE_COUNT)
                .put("completionMilliseconds", completionMilliseconds)
                .put(
                    "completionP50Milliseconds",
                    percentile(orderedCompletionNanos, 0.50) /
                        NANOS_PER_MILLISECOND.toDouble(),
                )
                .put(
                    "completionP95Milliseconds",
                    percentile(orderedCompletionNanos, 0.95) /
                        NANOS_PER_MILLISECOND.toDouble(),
                )
                .put(
                    "completionMaxMilliseconds",
                    (orderedCompletionNanos.lastOrNull() ?: 0L) /
                        NANOS_PER_MILLISECOND.toDouble(),
                )
                .put("frameMetrics", frameMetricsJson(frameSummary)),
    )
    assertProcessStillRunning(activity)
  }

  private fun testMatchedProductWorkload() {
    val appId = instrumentation.targetContext.packageName
    val variant =
        when (appId) {
          SOLID_MEMORY_APP_ID -> "solid-native"
          REACT_MEMORY_CONTROL_APP_ID -> "react-native"
          SOLID_TELEMETRY_BASELINE_APP_ID -> "baseline"
          SOLID_TELEMETRY_OBSERVED_APP_ID -> "observed"
          else -> fail("The matched product workload app was not recognized.")
        }
    val activity = launchApplication()
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == "$MATCHED_PRODUCT_STATUS_PREFIX$MATCHED_UPDATE_INITIAL_COUNT"
    }
    waitForNode(READY_TIMEOUT_MS) {
      it.text?.toString() == "${MATCHED_PRODUCT_ACTIVE_PREFIX}ORD-1001"
    }
    waitForNode(READY_TIMEOUT_MS) {
      it.contentDescription?.toString() == "Order ORD-1001 active"
    }

    val completionNanos = mutableListOf<Long>()
    var alertAppearances = 0
    var alertDisposals = 0
    val frameProbe = FrameMetricsProbe(activity)
    lateinit var frameSummary: FrameMetricsSummary
    try {
      for (eventIndex in 1..MATCHED_UPDATE_COUNT) {
        val button = waitForNode(PROOF_TIMEOUT_MS) {
          it.contentDescription?.toString() == MATCHED_PRODUCT_BUTTON_LABEL
        }
        assertTrue("The matched product-workload control was not clickable.", button.isClickable)
        val startedAt = SystemClock.elapsedRealtimeNanos()
        tapCenter(button)
        val expectedCount = MATCHED_UPDATE_INITIAL_COUNT + eventIndex
        val expectedOrderIndex = eventIndex % MATCHED_PRODUCT_ROW_COUNT
        val expectedOrder = "ORD-${1001 + expectedOrderIndex}"
        waitForNode(PROOF_TIMEOUT_MS) {
          it.text?.toString() == "$MATCHED_PRODUCT_STATUS_PREFIX$expectedCount"
        }
        waitForNode(PROOF_TIMEOUT_MS) {
          it.text?.toString() == "$MATCHED_PRODUCT_ACTIVE_PREFIX$expectedOrder"
        }
        waitForNode(PROOF_TIMEOUT_MS) {
          it.contentDescription?.toString() == "Order $expectedOrder active"
        }
        if (expectedCount % MATCHED_PRODUCT_ALERT_INTERVAL == 0) {
          waitForNode(PROOF_TIMEOUT_MS) {
            it.text?.toString() == MATCHED_PRODUCT_ALERT_TEXT
          }
          alertAppearances += 1
        } else {
          waitForNodeToDisappear(
              PROOF_TIMEOUT_MS,
              "The mixed product workload retained a stale priority alert.",
          ) {
            it.text?.toString() == MATCHED_PRODUCT_ALERT_TEXT
          }
          if ((expectedCount - 1) % MATCHED_PRODUCT_ALERT_INTERVAL == 0) {
            alertDisposals += 1
          }
        }
        completionNanos.add(SystemClock.elapsedRealtimeNanos() - startedAt)
      }
      instrumentation.waitForIdleSync()
    } finally {
      frameSummary = frameProbe.stop()
    }

    assertEquals(MATCHED_UPDATE_COUNT, completionNanos.size)
    assertEquals(MATCHED_PRODUCT_EXPECTED_ALERT_TRANSITIONS, alertAppearances)
    assertEquals(MATCHED_PRODUCT_EXPECTED_ALERT_TRANSITIONS, alertDisposals)
    assertTrue(
        "The matched product workload produced too few measured frames: ${frameSummary.frameCount}.",
        frameSummary.frameCount >= MATCHED_UPDATE_MINIMUM_MEASURED_FRAMES,
    )
    assertEquals(
        "Android dropped matched product-workload frame reports.",
        0,
        frameSummary.droppedReports,
    )
    assertEquals(
        "The matched product workload produced a frozen frame.",
        0,
        frameSummary.frozenFrameCount,
    )
    val orderedCompletionNanos = completionNanos.sorted()
    val completionMilliseconds =
        JSONArray(
            completionNanos.map { duration ->
              duration / NANOS_PER_MILLISECOND.toDouble()
            }
        )
    Log.i(
        "SOLID_NATIVE",
        "SOLID_NATIVE_MATCHED_PRODUCT_RESULT " +
            JSONObject()
                .put("schemaVersion", 0)
                .put("variant", variant)
                .put("workload", MATCHED_PRODUCT_WORKLOAD)
                .put("input", "androidx-touchscreen-injection")
                .put("initialCount", MATCHED_UPDATE_INITIAL_COUNT)
                .put(
                    "finalCount",
                    MATCHED_UPDATE_INITIAL_COUNT + MATCHED_UPDATE_COUNT,
                )
                .put("updateCount", MATCHED_UPDATE_COUNT)
                .put("rowCount", MATCHED_PRODUCT_ROW_COUNT)
                .put("finalActiveOrder", "ORD-1007")
                .put("activeOrderAssertions", MATCHED_UPDATE_COUNT)
                .put("alertAppearances", alertAppearances)
                .put("alertDisposals", alertDisposals)
                .put("completionMilliseconds", completionMilliseconds)
                .put(
                    "completionP50Milliseconds",
                    percentile(orderedCompletionNanos, 0.50) /
                        NANOS_PER_MILLISECOND.toDouble(),
                )
                .put(
                    "completionP95Milliseconds",
                    percentile(orderedCompletionNanos, 0.95) /
                        NANOS_PER_MILLISECOND.toDouble(),
                )
                .put(
                    "completionMaxMilliseconds",
                    (orderedCompletionNanos.lastOrNull() ?: 0L) /
                        NANOS_PER_MILLISECOND.toDouble(),
                )
                .put("frameMetrics", frameMetricsJson(frameSummary)),
    )
    assertProcessStillRunning(activity)
  }

  private fun launchApplication(initialURL: String? = null): Activity {
    val appId = instrumentation.targetContext.packageName
    val launchIntent =
        if (initialURL == null) {
          checkNotNull(
              instrumentation.targetContext.packageManager
                  .getLaunchIntentForPackage(appId)
          )
        } else {
          Intent(Intent.ACTION_VIEW, Uri.parse(initialURL)).setPackage(appId)
        }
    launchIntent.addFlags(
        Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK
    )
    val activity = instrumentation.startActivitySync(launchIntent)
    instrumentation.waitForIdleSync()
    return activity
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

  private fun tapCenter(node: AccessibilityNodeInfo) {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertFalse("The accessible renderer button had empty bounds.", bounds.isEmpty)
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

  private fun hasNonEmptyBounds(node: AccessibilityNodeInfo): Boolean {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    return !bounds.isEmpty
  }

  private fun dragBy(
      node: AccessibilityNodeInfo,
      deltaXPixels: Float,
      deltaYPixels: Float,
  ) {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertTrue("The physical drag target had no area.", !bounds.isEmpty)
    dragFrom(bounds.exactCenterX(), bounds.exactCenterY(), deltaXPixels, deltaYPixels)
  }

  private fun collapseNavigationSheet(activity: Activity) {
    val decor = activity.window.decorView
    assertTrue("The physical sheet window had no area.", decor.width > 0 && decor.height > 0)
    val startX = decor.width / 2f
    dragFrom(startX, decor.height * 0.16f, 0f, decor.height * 0.3f)
  }

  private fun dragFrom(
      startX: Float,
      startY: Float,
      deltaXPixels: Float,
      deltaYPixels: Float,
  ) {
    val downTime = SystemClock.uptimeMillis()
    val down =
        MotionEvent.obtain(
            downTime,
            downTime,
            MotionEvent.ACTION_DOWN,
            startX,
            startY,
            0,
        )
    down.source = InputDevice.SOURCE_TOUCHSCREEN
    try {
      assertTrue(
          "The Android test runner did not inject drag touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      for (step in 1..8) {
        val fraction = step / 8f
        val move =
            MotionEvent.obtain(
                downTime,
                downTime + step * SWIPE_STEP_MS,
                MotionEvent.ACTION_MOVE,
                startX + deltaXPixels * fraction,
                startY + deltaYPixels * fraction,
                0,
            )
        move.source = InputDevice.SOURCE_TOUCHSCREEN
        try {
          assertTrue(
              "The Android test runner did not inject drag movement.",
              instrumentation.uiAutomation.injectInputEvent(move, true),
          )
        } finally {
          move.recycle()
        }
        SystemClock.sleep(SWIPE_STEP_MS)
      }
      val up =
          MotionEvent.obtain(
              downTime,
              downTime + 9 * SWIPE_STEP_MS,
              MotionEvent.ACTION_UP,
              startX + deltaXPixels,
              startY + deltaYPixels,
              0,
          )
      up.source = InputDevice.SOURCE_TOUCHSCREEN
      try {
        assertTrue(
            "The Android test runner did not inject drag touch-up.",
            instrumentation.uiAutomation.injectInputEvent(up, true),
        )
      } finally {
        up.recycle()
      }
    } finally {
      down.recycle()
    }
  }

  private fun swipeUp(node: AccessibilityNodeInfo) {
    val bounds = Rect()
    node.getBoundsInScreen(bounds)
    assertTrue(
        "The physical VirtualizedList was too short for a swipe.",
        bounds.height() >= 200,
    )
    val x = bounds.exactCenterX()
    val startY = bounds.bottom - 24f
    val endY = bounds.top + 24f
    val downTime = SystemClock.uptimeMillis()
    val down =
        MotionEvent.obtain(
            downTime,
            downTime,
            MotionEvent.ACTION_DOWN,
            x,
            startY,
            0,
        )
    down.source = InputDevice.SOURCE_TOUCHSCREEN
    try {
      assertTrue(
          "The Android test runner did not inject list touch-down.",
          instrumentation.uiAutomation.injectInputEvent(down, true),
      )
      for (step in 1..12) {
        val fraction = step / 12f
        val move =
            MotionEvent.obtain(
                downTime,
                downTime + step * SWIPE_STEP_MS,
                MotionEvent.ACTION_MOVE,
                x,
                startY + (endY - startY) * fraction,
                0,
            )
        move.source = InputDevice.SOURCE_TOUCHSCREEN
        try {
          assertTrue(
              "The Android test runner did not inject list movement.",
              instrumentation.uiAutomation.injectInputEvent(move, true),
          )
        } finally {
          move.recycle()
        }
        SystemClock.sleep(SWIPE_STEP_MS)
      }
      val upTime = downTime + 13 * SWIPE_STEP_MS
      val up =
          MotionEvent.obtain(
              downTime,
              upTime,
              MotionEvent.ACTION_UP,
              x,
              endY,
              0,
          )
      up.source = InputDevice.SOURCE_TOUCHSCREEN
      try {
        assertTrue(
            "The Android test runner did not inject list touch-up.",
            instrumentation.uiAutomation.injectInputEvent(up, true),
        )
      } finally {
        up.recycle()
      }
    } finally {
      down.recycle()
    }
  }

  private fun waitForNodeToDisappear(
      timeoutMilliseconds: Long,
      failureMessage: String =
          "The Solid Native surface did not disappear after deterministic teardown.",
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ) {
    val deadline = SystemClock.uptimeMillis() + timeoutMilliseconds
    while (SystemClock.uptimeMillis() < deadline) {
      if (findNode(instrumentation.uiAutomation.rootInActiveWindow, predicate) == null) return
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(failureMessage)
  }

  private fun findNode(
      node: AccessibilityNodeInfo?,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ): AccessibilityNodeInfo? {
    if (node == null) return null
    if (predicate(node)) return node
    for (index in 0 until node.childCount) {
      val found = findNode(node.getChild(index), predicate)
      if (found != null) return found
    }
    return null
  }

  private fun countNodes(
      node: AccessibilityNodeInfo?,
      predicate: (AccessibilityNodeInfo) -> Boolean,
  ): Int {
    if (node == null) return 0
    var count = if (predicate(node)) 1 else 0
    for (index in 0 until node.childCount) {
      count += countNodes(node.getChild(index), predicate)
    }
    return count
  }

  private fun findAndroidView(
      view: View,
      predicate: (View) -> Boolean,
  ): View? {
    if (predicate(view)) return view
    if (view !is ViewGroup) return null
    for (index in 0 until view.childCount) {
      val found = findAndroidView(view.getChildAt(index), predicate)
      if (found != null) return found
    }
    return null
  }

  private fun waitForNativeTabsScreenStack(activity: Activity): ScreenStack {
    val deadline = SystemClock.uptimeMillis() + PROOF_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var stack: ScreenStack? = null
      instrumentation.runOnMainSync {
        stack =
            findAndroidView(activity.window.decorView) { it is ScreenStack }
                as? ScreenStack
      }
      if (stack != null) return checkNotNull(stack)
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail("The native Settings tab did not retain its ScreenStack.")
    throw AssertionError("unreachable")
  }

  private fun waitForLoadedNativeTabsBottomNavigation(activity: Activity): View {
    val deadline = SystemClock.uptimeMillis() + READY_TIMEOUT_MS
    while (SystemClock.uptimeMillis() < deadline) {
      var loaded: View? = null
      instrumentation.runOnMainSync {
        val candidate =
            findAndroidView(activity.window.decorView) {
              it.javaClass.name == NATIVE_TABS_BOTTOM_NAVIGATION_CLASS
            }
        val menu =
            candidate?.javaClass?.getMethod("getMenu")?.invoke(candidate)
                as? android.view.Menu
        if (
            candidate != null &&
                candidate.width > 0 &&
                candidate.height > 0 &&
                menu?.size() == 2 &&
                menu.getItem(0).icon != null &&
                menu.getItem(1).icon != null
        ) {
          loaded = candidate
        }
      }
      if (loaded != null) return checkNotNull(loaded)
      SystemClock.sleep(POLL_INTERVAL_MS)
    }
    fail(
        "The Material BottomNavigationView and both sync/async native tab icons did not load " +
            "within ${READY_TIMEOUT_MS}ms."
    )
    throw AssertionError("unreachable")
  }

  private fun captureNativeRows(
      activity: Activity,
      rowPrefix: String,
  ): IdentityHashMap<View, String> {
    val rows = IdentityHashMap<View, String>()
    instrumentation.runOnMainSync {
      collectNativeRows(activity.window.decorView, rowPrefix, rows)
    }
    assertTrue("The Android hierarchy exposed no native row Views.", rows.isNotEmpty())
    return rows
  }

  private data class VirtualizedRowAnchor(
      val label: String,
      val bounds: Rect,
  )

  private fun captureVisibleVirtualizedRow(
      list: AccessibilityNodeInfo,
      rowPrefix: String,
  ): VirtualizedRowAnchor {
    val viewport = Rect()
    list.getBoundsInScreen(viewport)
    val candidates = mutableListOf<VirtualizedRowAnchor>()
    collectVisibleVirtualizedRows(
        instrumentation.uiAutomation.rootInActiveWindow,
        rowPrefix,
        viewport,
        candidates,
    )
    val fullyVisible =
        candidates.filter {
          it.bounds.top >= viewport.top && it.bounds.bottom <= viewport.bottom
        }
    val anchor =
        (if (fullyVisible.isNotEmpty()) fullyVisible else candidates)
            .minWithOrNull(compareBy<VirtualizedRowAnchor> { it.bounds.top }.thenBy { it.label })
    assertTrue("The physical VirtualizedList exposed no visible keyed row.", anchor != null)
    return checkNotNull(anchor)
  }

  private fun collectVisibleVirtualizedRows(
      node: AccessibilityNodeInfo?,
      rowPrefix: String,
      viewport: Rect,
      rows: MutableList<VirtualizedRowAnchor>,
  ) {
    if (node == null) return
    val label = node.contentDescription?.toString()
    if (label?.startsWith(rowPrefix) == true) {
      val bounds = Rect()
      node.getBoundsInScreen(bounds)
      if (!bounds.isEmpty && Rect.intersects(bounds, viewport)) {
        rows.add(VirtualizedRowAnchor(label, bounds))
      }
    }
    for (index in 0 until node.childCount) {
      collectVisibleVirtualizedRows(node.getChild(index), rowPrefix, viewport, rows)
    }
  }

  private fun collectNativeRows(
      view: View,
      rowPrefix: String,
      rows: IdentityHashMap<View, String>,
  ) {
    val label = view.contentDescription?.toString()
    if (label?.startsWith(rowPrefix) == true) rows[view] = label
    if (view !is ViewGroup) return
    for (index in 0 until view.childCount) {
      collectNativeRows(view.getChildAt(index), rowPrefix, rows)
    }
  }

  private fun captureNativeRowWrappers(
      activity: Activity,
      rowPrefix: String,
  ): IdentityHashMap<View, String> {
    val rows = IdentityHashMap<View, String>()
    instrumentation.runOnMainSync {
      collectNativeRowWrappers(activity.window.decorView, rowPrefix, rows)
    }
    assertTrue("The Android hierarchy exposed no native row wrapper Views.", rows.isNotEmpty())
    return rows
  }

  private fun collectNativeRowWrappers(
      view: View,
      rowPrefix: String,
      rows: IdentityHashMap<View, String>,
  ) {
    if (view !is ViewGroup) return
    for (index in 0 until view.childCount) {
      val child = view.getChildAt(index)
      val label = child.contentDescription?.toString()
      if (label?.startsWith(rowPrefix) == true) rows[view] = label
      collectNativeRowWrappers(child, rowPrefix, rows)
    }
  }

  private fun findNativeRowReuse(
      snapshots: List<IdentityHashMap<View, String>>,
  ): Pair<String, String>? {
    for (earlierIndex in 0 until snapshots.lastIndex) {
      val earlier = snapshots[earlierIndex]
      for (laterIndex in earlierIndex + 1 until snapshots.size) {
        val later = snapshots[laterIndex]
        for ((view, earlierLabel) in earlier) {
          val laterLabel = later[view] ?: continue
          if (earlierLabel != laterLabel) return earlierLabel to laterLabel
        }
      }
    }
    return null
  }

  private fun assertProcessStillRunning(activity: Activity) {
    instrumentation.runOnMainSync {
      assertFalse("The app activity finished during teardown.", activity.isFinishing)
      assertFalse("The app activity was destroyed during teardown.", activity.isDestroyed)
    }
  }

  companion object {
    private const val SOLID_MEMORY_APP_ID = "dev.solidnative.memory"
    private const val REACT_MEMORY_CONTROL_APP_ID =
        "dev.solidnative.memory.control"
    private const val SOLID_TELEMETRY_BASELINE_APP_ID =
        "dev.solidnative.telemetry.baseline"
    private const val SOLID_TELEMETRY_OBSERVED_APP_ID =
        "dev.solidnative.telemetry.observed"
    private const val MATCHED_UPDATE_STATUS_PREFIX = "Memory control count "
    private const val MATCHED_UPDATE_GENERATED_LABEL =
        "Memory generated Fabric component"
    private const val MATCHED_UPDATE_BUTTON_LABEL = "Run memory update"
    private const val MATCHED_UPDATE_INITIAL_COUNT = 1
    private const val MATCHED_UPDATE_COUNT = 30
    private const val MATCHED_UPDATE_MINIMUM_MEASURED_FRAMES = 25
    private const val MATCHED_UPDATE_SCENARIO_ARGUMENT =
        "solidNativeMatchedUpdateScenario"
    private const val MATCHED_UPDATE_SCENARIO_STEADY = "steady-properties"
    private const val MATCHED_UPDATE_SCENARIO_PRODUCT = "mixed-product"
    private const val MATCHED_PRODUCT_WORKLOAD = "order-dashboard"
    private const val MATCHED_PRODUCT_STATUS_PREFIX = "Orders processed "
    private const val MATCHED_PRODUCT_ACTIVE_PREFIX = "Active order "
    private const val MATCHED_PRODUCT_BUTTON_LABEL =
        "Advance fulfillment workload"
    private const val MATCHED_PRODUCT_ALERT_TEXT =
        "Priority reconciliation required"
    private const val MATCHED_PRODUCT_ROW_COUNT = 12
    private const val MATCHED_PRODUCT_ALERT_INTERVAL = 5
    private const val MATCHED_PRODUCT_EXPECTED_ALERT_TRANSITIONS = 6
    private const val WORKLET_APP_ID = "dev.solidnative.worklet"
    private const val WORKLET_READY_TEXT = "Native UI worklet ready for installation"
    private const val WORKLET_INITIAL_TEXT = "Native UI worklet initial frame applied"
    private const val WORKLET_UPDATED_TEXT = "Native UI worklet update frame applied"
    private const val WORKLET_TIMING_TEXT = "Native UI worklet timing completed"
    private const val WORKLET_STABILITY_TEXT = "Native UI worklet stability completed"
    private const val WORKLET_KEYFRAMES_TEXT = "Native UI worklet keyframes completed"
    private const val WORKLET_SPRING_TEXT = "Native UI worklet spring completed"
    private const val WORKLET_DECAY_TEXT = "Native UI worklet decay completed"
    private const val WORKLET_GESTURE_READY_TEXT = "Native UI worklet pan ready"
    private const val WORKLET_GESTURE_TEXT = "Native UI worklet pan completed"
    private const val WORKLET_TARGET_LABEL = "Solid Native UI worklet target"
    private const val WORKLET_INSTALL_LABEL = "Install native UI worklet"
    private const val WORKLET_UPDATE_LABEL = "Update native UI worklet"
    private const val WORKLET_TIMING_LABEL = "Animate native UI worklet"
    private const val WORKLET_STABILITY_LABEL = "Measure native UI worklet stability"
    private const val WORKLET_KEYFRAMES_LABEL = "Keyframe native UI worklet"
    private const val WORKLET_SPRING_LABEL = "Spring native UI worklet"
    private const val WORKLET_DECAY_LABEL = "Decay native UI worklet"
    private const val WORKLET_GESTURE_LABEL = "Bind native UI worklet pan"
    private const val WORKLET_DISPOSE_LABEL = "Dispose native UI worklet proof"
    private const val WORKLET_FAILURE_MARKER = "SOLID_NATIVE_UI_WORKLET_FAILED"
    private const val WORKLET_TEARDOWN_MARKER =
        "SOLID_NATIVE_UI_WORKLET_TEARDOWN_SUCCEEDED"
    private const val WORKLET_FLOAT_TOLERANCE = 0.02f
    private const val WORKLET_MINIMUM_STABILITY_FRAMES = 270
    private const val WORKLET_MINIMUM_KEYFRAME_FRAMES = 50
    private const val WORKLET_MINIMUM_SPRING_FRAMES = 20
    private const val WORKLET_MINIMUM_DECAY_FRAMES = 20
    private const val WORKLET_SPRING_POLL_INTERVAL_MS = 10L
    private const val WORKLET_KEYFRAMES_POLL_INTERVAL_MS = 10L
    private const val WORKLET_DECAY_POLL_INTERVAL_MS = 10L
    private const val SOLID_APP_ID = "dev.solidnative.e2e"
    private const val CONTROL_APP_ID = "dev.solidnative.control"
    private const val LIST_APP_ID = "dev.solidnative.list"
    private const val LIST_RECYCLING_APP_ID = "dev.solidnative.list.recycling"
    private const val NAVIGATION_PROCESS_APP_ID = "dev.solidnative.navigation"
    private const val NAVIGATION_PROCESS_ROOT_CONTENT =
        "Solid Native process-restored navigation root"
    private const val NAVIGATION_PROCESS_DETAIL_CONTENT =
        "Solid Native process-restored navigation detail"
    private const val NAVIGATION_PROCESS_LINKED_CONTENT =
        "Solid Native process-safe cold navigation link"
    private const val NAVIGATION_PROCESS_PRODUCT_LOGIN_CONTENT =
        "Solid Native authenticated navigation sign in"
    private const val NAVIGATION_PROCESS_PRODUCT_HOME_CONTENT =
        "Solid Native authenticated navigation home"
    private const val NAVIGATION_PROCESS_ROOT_LOADER_STATE =
        "Navigation process loader root"
    private const val NAVIGATION_PROCESS_DETAIL_LOADER_STATE =
        "Navigation process loader detail"
    private const val NAVIGATION_PROCESS_LINKED_LOADER_STATE =
        "Navigation process loader linked"
    private const val NAVIGATION_PROCESS_PRODUCT_HOME_LOADER_STATE =
        "Navigation product loader home"
    private const val NAVIGATION_PROCESS_ROUTED_DETAIL_STATE =
        "Native navigation routed detail; back true"
    private const val NAVIGATION_PROCESS_RESTORATION_STATE =
        "Native navigation process restoration; back true"
    private const val NAVIGATION_PROCESS_BLOCKED_BACK_STATE =
        "Native navigation platform Back blocked"
    private const val NAVIGATION_PROCESS_COLD_LINK_STATE =
        "Native navigation cold launch; back false"
    private const val NAVIGATION_PROCESS_PRODUCT_AUTH_REDIRECT_STATE =
        "Authentication redirect replaced protected native history"
    private const val NAVIGATION_PROCESS_PRODUCT_START_LABEL =
        "Authenticate and start protected data"
    private const val NAVIGATION_PROCESS_PRODUCT_SLOW_PENDING_STATE =
        "Protected data loading; interruption available"
    private const val NAVIGATION_PROCESS_PRODUCT_INTERRUPT_LABEL =
        "Interrupt protected data with home"
    private const val NAVIGATION_PROCESS_PRODUCT_HOME_STATE =
        "Authenticated home won interrupted navigation"
    private const val NAVIGATION_PROCESS_PRODUCT_DENIED_CONTENT =
        "Denied protected route mounted"
    private const val NAVIGATION_PROCESS_PRODUCT_STALE_CONTENT =
        "Stale protected data mounted after interruption"
    private const val NAVIGATION_PROCESS_PUSH_LABEL =
        "Open process-restored navigation detail"
    private const val NAVIGATION_PROCESS_SEED_LABEL =
        "Persist navigation for process relaunch"
    private const val NAVIGATION_PROCESS_DISPOSE_LABEL =
        "Dispose navigation process proof"
    private const val NAVIGATION_PROCESS_SEED_URL =
        "dev.solidnative.navigation://navigation/process-restoration-seed"
    private const val NAVIGATION_PROCESS_COLD_LINK_URL =
        "dev.solidnative.navigation://navigation/cold-link?source=device-test"
    private const val NAVIGATION_PROCESS_CHURN_URL =
        "dev.solidnative.navigation://navigation/sustained-churn"
    private const val NAVIGATION_PROCESS_PRESSURE_URL =
        "dev.solidnative.navigation://navigation/memory-pressure"
    private const val NAVIGATION_PROCESS_PRODUCT_URL =
        "dev.solidnative.navigation://navigation/authenticated-interruption"
    private const val NAVIGATION_PROCESS_ROOT_HEADER = "Restored root"
    private const val NAVIGATION_PROCESS_DETAIL_HEADER = "Restored detail"
    private const val NAVIGATION_PROCESS_LINKED_HEADER = "Cold link"
    private const val NAVIGATION_PROCESS_PRODUCT_LOGIN_HEADER = "Sign in"
    private const val NAVIGATION_PROCESS_PRODUCT_SLOW_HEADER = "Protected data"
    private const val NAVIGATION_PROCESS_PRODUCT_HOME_HEADER = "Authenticated home"
    private const val NAVIGATION_PROCESS_DETAIL_HEADER_ACTION_LABEL =
        "Run detail native header action"
    private const val NAVIGATION_PROCESS_DETAIL_HEADER_ACTION_DONE =
        "Detail header action complete"
    private const val NAVIGATION_PROCESS_SHEET_COLLAPSED_STATE =
        "Native sheet detent 0 stable"
    private const val NAVIGATION_PROCESS_SCREEN_STACK_CLASS =
        "com.swmansion.rnscreens.ScreenStack"
    private const val NAVIGATION_PROCESS_MEMORY_READY_STATE =
        "Native navigation memory policy ready"
    private const val NAVIGATION_PROCESS_MEMORY_PRESSURE_STATE =
        "Native navigation memory policy reclaimed inactive route"
    private const val NAVIGATION_PROCESS_MEMORY_RECOVERED_STATE =
        "Native navigation memory policy recovery acknowledged"
    private const val NAVIGATION_PROCESS_MEMORY_READY_COUNT =
        "Navigation memory warnings 0; route budget 2"
    private const val NAVIGATION_PROCESS_MEMORY_PRESSURE_COUNT =
        "Navigation memory warnings 1; route budget 1"
    private const val NAVIGATION_PROCESS_MEMORY_RECOVERED_COUNT =
        "Navigation memory warnings 1; route budget 2"
    private const val NAVIGATION_PROCESS_MEMORY_RECOVER_LABEL =
        "Acknowledge navigation memory recovery"
    private const val NAVIGATION_PROCESS_SCROLL_TARGET_DP = 320f
    private const val NAVIGATION_PROCESS_PHASE_ARGUMENT =
        "solidNativeNavigationProcessPhase"
    private const val NAVIGATION_PROCESS_PHASE_SEED = "seed"
    private const val NAVIGATION_PROCESS_PHASE_RESTORE = "restore"
    private const val NAVIGATION_PROCESS_PHASE_PRESSURE = "pressure"
    private const val NAVIGATION_PROCESS_PHASE_CHURN = "churn"
    private const val NAVIGATION_PROCESS_PHASE_PRODUCT = "product"
    private const val NAVIGATION_PROCESS_PHASE_COLD = "cold"
    private const val NAVIGATION_PROCESS_CHURN_CYCLES = 30
    private const val NAVIGATION_PROCESS_FAILURE_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_FAILED"
    private const val NAVIGATION_PROCESS_MEMORY_PRESSURE_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_MEMORY_PRESSURE_SUCCEEDED"
    private const val NAVIGATION_PROCESS_MEMORY_RECOVERY_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_MEMORY_RECOVERY_SUCCEEDED"
    private const val NAVIGATION_PROCESS_SCROLL_CAPTURE_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_CAPTURE_SUCCEEDED"
    private const val NAVIGATION_PROCESS_SCROLL_RESTORATION_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_SCROLL_RESTORATION_SUCCEEDED"
    private const val NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_CAPTURE_SUCCEEDED"
    private const val NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_DURABLE_SCROLL_RESTORATION_SUCCEEDED"
    private const val NAVIGATION_PROCESS_PLATFORM_BACK_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_PLATFORM_BACK_SUCCEEDED"
    private const val NAVIGATION_PROCESS_PRODUCT_AUTH_REDIRECT_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_AUTH_REDIRECT_SUCCEEDED"
    private const val NAVIGATION_PROCESS_PRODUCT_SLOW_LOADER_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_SLOW_LOADER_STARTED"
    private const val NAVIGATION_PROCESS_PRODUCT_INTERRUPTION_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_PRODUCT_INTERRUPTION_SUCCEEDED"
    private const val NAVIGATION_PROCESS_TEARDOWN_MARKER =
        "SOLID_NATIVE_NAVIGATION_PROCESS_TEARDOWN_SUCCEEDED"
    private const val NAVIGATION_PROCESS_MEMORY_SETTLE_MS = 750L
    private const val NAVIGATION_PROCESS_UI_HIDDEN = 20
    private const val NAVIGATION_PROCESS_RUNNING_CRITICAL = 15
    private const val TABS_APP_ID = "dev.solidnative.tabs"
    private const val REACT_LIST_CONTROL_APP_ID = "dev.solidnative.list.control"
    private const val NATIVE_TABS_HOME_CONTENT = "Solid Native home tab content"
    private const val NATIVE_TABS_SETTINGS_CONTENT =
        "Solid Native settings tab content"
    private const val NATIVE_TABS_HOME_LABEL = "Home tab"
    private const val NATIVE_TABS_SETTINGS_LABEL = "Settings tab"
    private const val NATIVE_TABS_SETTINGS_STATE_PREFIX =
        "Settings retained state"
    private const val NATIVE_TABS_INCREMENT_LABEL =
        "Increment settings tab state"
    private const val NATIVE_TABS_NESTED_DETAIL_CONTENT =
        "Solid Native nested settings detail"
    private const val NATIVE_TABS_NESTED_STATE_PREFIX =
        "Nested detail retained state"
    private const val NATIVE_TABS_LOADER_PREFIX = "Settings TanStack loader"
    private const val NATIVE_TABS_NESTED_PUSH_LABEL =
        "Open nested settings detail"
    private const val NATIVE_TABS_NESTED_SHEET_CONTENT =
        "Solid Native nested settings sheet"
    private const val NATIVE_TABS_NESTED_SHEET_STATE =
        "Native tabs nested sheet active"
    private const val NATIVE_TABS_NESTED_SHEET_OPEN_LABEL =
        "Start nested settings sheet load"
    private const val NATIVE_TABS_NESTED_SHEET_PENDING_STATE =
        "Nested settings sheet loading"
    private const val NATIVE_TABS_NESTED_SHEET_INTERRUPT_LABEL =
        "Interrupt nested settings load with sheet"
    private const val NATIVE_TABS_PRODUCT_LOGIN_CONTENT =
        "Solid Native product authentication"
    private const val NATIVE_TABS_PRODUCT_LOGIN_LABEL =
        "Authenticate composed native flow"
    private const val NATIVE_TABS_PRODUCT_SESSION_RESTORED_CONTENT =
        "Solid Native restored protected session"
    private const val NATIVE_TABS_PRODUCT_SESSION_CLEAR_LABEL =
        "Clear restored session and dispose"
    private const val NATIVE_TABS_NESTED_RESET_LABEL =
        "Reset cold-linked settings root"
    private const val NATIVE_TABS_PROCESS_SEED_LABEL =
        "Persist native tabs for process relaunch"
    private const val NATIVE_TABS_DEEP_LINK_URL =
        "dev.solidnative.tabs://navigation/settings/detail?source=device-test"
    private const val NATIVE_TABS_PROCESS_SEED_URL =
        "dev.solidnative.tabs://navigation/process-restoration-seed"
    private const val NATIVE_TABS_PRODUCT_COMPOSITION_URL =
        "dev.solidnative.tabs://navigation/product-composition"
    private const val NATIVE_TABS_PRODUCT_SESSION_RESTORE_URL =
        "dev.solidnative.tabs://navigation/product-session-restore"
    private const val NATIVE_TABS_COLD_LINK_STATE =
        "Native tabs cold launch deep-link; back false"
    private const val NATIVE_TABS_PROCESS_RESTORATION_STATE =
        "Native tabs process restoration; back true"
    private const val NATIVE_TABS_ROUTED_DETAIL_STATE =
        "Native tabs routed detail; back true"
    private const val NATIVE_TABS_PHASE_ARGUMENT = "solidNativeTabsPhase"
    private const val NATIVE_TABS_PHASE_SEED = "seed"
    private const val NATIVE_TABS_PHASE_RESTORE = "restore"
    private const val NATIVE_TABS_PHASE_PRODUCT = "product"
    private const val NATIVE_TABS_PHASE_PRODUCT_RESTORE = "product-restore"
    private const val NATIVE_TABS_PHASE_COLD = "cold"
    private const val NATIVE_TABS_NESTED_HEADER = "Nested settings detail"
    private const val NATIVE_TABS_DISPOSE_LABEL = "Dispose native tabs proof"
    private const val NATIVE_TABS_FAILURE_MARKER = "SOLID_NATIVE_TABS_FAILED"
    private const val NATIVE_TABS_PRODUCT_AUTH_REDIRECT_MARKER =
        "SOLID_NATIVE_TABS_PRODUCT_AUTH_REDIRECT_SUCCEEDED"
    private const val NATIVE_TABS_PRODUCT_INTERRUPTION_MARKER =
        "SOLID_NATIVE_TABS_PRODUCT_INTERRUPTION_SUCCEEDED"
    private const val NATIVE_TABS_PRODUCT_SESSION_RESTORE_MARKER =
        "SOLID_NATIVE_TABS_PRODUCT_SESSION_RESTORE_SUCCEEDED"
    private const val NATIVE_TABS_PRODUCT_SESSION_CLEARED_MARKER =
        "SOLID_NATIVE_TABS_PRODUCT_SESSION_CLEARED"
    private const val NATIVE_TABS_TEARDOWN_MARKER =
        "SOLID_NATIVE_TABS_TEARDOWN_SUCCEEDED"
    private const val NATIVE_TABS_BOTTOM_NAVIGATION_CLASS =
        "com.swmansion.rnscreens.gamma.tabs.container.CustomBottomNavigationView"
    private const val NATIVE_TABS_SCREEN_STACK_CLASS =
        "com.swmansion.rnscreens.ScreenStack"
    private const val SOLID_TITLE = "Solid Native physical integration"
    private const val RESOURCE_PROOF_START_LABEL = "Start intensive device proof"
    private const val SOLID_BUTTON_LABEL = "Run Solid signal update"
    private const val SOLID_IMAGE_LABEL = "Solid Native decoded image"
    private const val SOLID_ACTIVITY_INDICATOR_LABEL =
        "Solid Native activity indicator"
    private const val SOLID_SCROLL_VIEW_ID = "solid-native-scroll-view"
    private const val VIRTUALIZED_LIST_ID = "solid-native-virtualized-list"
    private const val VIRTUALIZED_ROW_PREFIX = "Virtualized row "
    private const val VIRTUALIZED_LIST_READY_TEXT =
        "Solid Native VirtualizedList ready"
    private const val VIRTUALIZED_LIST_SUCCEEDED_TEXT =
        "Solid Native VirtualizedList physical scroll mounted"
    private const val VIRTUALIZED_LIST_PREPEND_LABEL =
        "Prepend 50 virtualized rows"
    private const val VIRTUALIZED_LIST_PREPEND_SUCCEEDED_TEXT =
        "Solid Native VirtualizedList prepend anchor retained"
    private const val VIRTUALIZED_LIST_IMPERATIVE_INDEX = 900
    private const val VIRTUALIZED_LIST_IMPERATIVE_LABEL =
        "Jump to virtualized row $VIRTUALIZED_LIST_IMPERATIVE_INDEX"
    private const val VIRTUALIZED_LIST_IMPERATIVE_SUCCEEDED_TEXT =
        "Solid Native VirtualizedList imperative index mounted"
    private const val VIRTUALIZED_LIST_DISPOSE_LABEL =
        "Dispose virtualized list proof"
    private const val VIRTUALIZED_MAXIMUM_MOUNTED_ROWS = 12
    private const val VIRTUALIZED_MINIMUM_MEASURED_FRAMES = 5
    private const val VIRTUALIZED_ANCHOR_PIXEL_TOLERANCE = 1
    private const val INITIAL_VIRTUALIZED_LIST_ID =
        "solid-native-initial-virtualized-list"
    private const val INITIAL_VIRTUALIZED_LIST_LABEL =
        "Solid Native initial virtualized list"
    private const val INITIAL_VIRTUALIZED_ROW_PREFIX =
        "Initial virtualized row "
    private const val INITIAL_VIRTUALIZED_LIST_READY_TEXT =
        "Solid Native initial VirtualizedList ready"
    private const val INITIAL_VIRTUALIZED_LIST_DISPOSE_LABEL =
        "Dispose initial VirtualizedList proof"
    private const val INITIAL_VIRTUALIZED_LIST_INDEX = 100
    private const val INITIAL_VIRTUALIZED_LIST_ITEM_SIZE = 50
    private const val INITIAL_VIRTUALIZED_LIST_MOUNTED_ROWS = 7
    private const val MEASURED_VIRTUALIZED_LIST_ID =
        "solid-native-measured-virtualized-list"
    private const val MEASURED_VIRTUALIZED_ROW_PREFIX =
        "Measured virtualized row "
    private const val MEASURED_VIRTUALIZED_LIST_READY_TEXT =
        "Solid Native measured VirtualizedList ready"
    private const val MEASURED_VIRTUALIZED_LIST_SUCCEEDED_TEXT =
        "Solid Native measured VirtualizedList physical scroll mounted"
    private const val MEASURED_SHORT_ROW_DP = 40
    private const val MEASURED_TALL_ROW_DP = 80
    private const val MEASURED_VIRTUALIZED_MAXIMUM_MOUNTED_ROWS = 15
    private const val MEASURED_ROW_PIXEL_TOLERANCE = 2
    private const val REACT_LIST_ID = "react-native-list-control"
    private const val REACT_LIST_ROW_PREFIX = "React control virtualized row "
    private const val REACT_LIST_READY_TEXT = "React Native FlatList ready"
    private const val REACT_LIST_SUCCEEDED_TEXT =
        "React Native FlatList physical scroll mounted"
    private const val REACT_LIST_PREPEND_LABEL =
        "Prepend 50 React virtualized rows"
    private const val REACT_LIST_PREPEND_SUCCEEDED_TEXT =
        "React Native FlatList prepend anchor retained"
    private const val REACT_LIST_IMPERATIVE_LABEL =
        "Jump to React virtualized row $VIRTUALIZED_LIST_IMPERATIVE_INDEX"
    private const val REACT_LIST_IMPERATIVE_SUCCEEDED_TEXT =
        "React Native FlatList imperative index mounted"
    private const val REACT_LIST_MAXIMUM_ACCESSIBLE_ROWS = 50
    private const val NANOS_PER_MILLISECOND = 1_000_000L
    private const val DEFAULT_FRAME_DEADLINE_NANOS = 16_666_667L
    private const val FROZEN_FRAME_NANOS = 700L * NANOS_PER_MILLISECOND
    private const val FRAME_METRICS_DRAIN_TIMEOUT_MS = 5_000L
    private const val CAMERA_PREVIEW_CLASS_NAME =
        "androidx.camera.view.PreviewView"
    private const val CONTROL_BUTTON_LABEL = "Run React control update"
    private const val CONTROL_GENERATED_LABEL =
        "React control generated Fabric component"
    private const val CONTROL_INITIAL_TEXT = "React control count 0"
    private const val CONTROL_UPDATED_TEXT = "React control count 1"
    private const val LIFECYCLE_READY_TEXT =
        "Native lifecycle event observed; ready for a physical press"
    private const val SIGNAL_TEXT = "Native press delivered through a Solid signal"
    private const val ASYNC_LOADING_TEXT = "Solid async profile loading"
    private const val ASYNC_READY_TEXT = "Solid async profile ready"
    private const val IMAGE_READY_TEXT = "Native Image load event observed"
    private const val SCROLL_READY_TEXT =
        "Native ScrollView command and event observed"
    private const val CAMERA_CAPTURE_TEXT =
        "Native camera photo capture observed"
    private const val CAMERA_SESSION_STARTED_TEXT =
        "Native camera session start observed"
    private const val NAVIGATION_DETAIL_TEXT =
        "Solid-owned native navigation detail"
    private const val NAVIGATION_DETAIL_HEADER_TEXT = "Solid Native detail"
    private const val DEEP_LINK_URL =
        "dev.solidnative.e2e://navigation/physical?source=device-test"
    private const val DEEP_LINK_TEXT =
        "Native deep link delivered into Solid history"
    private const val SCREEN_FOCUSED_TEXT = "Native screen focus observed"
    private const val TEXT_INPUT_LABEL = "Solid Native text input"
    private const val MULTILINE_TEXT_INPUT_LABEL =
        "Solid Native multiline text input"
    private const val TEXT_INPUT_VALUE = "SolidNative42"
    private const val TEXT_INPUT_CONTROLLED_VALUE = "Solid controls Native"
    private const val TEXT_INPUT_SELECTION_INSERTION = "X"
    private const val TEXT_INPUT_SELECTION_READY_TEXT =
        "Native TextInput controlled selection ready"
    private const val TEXT_INPUT_SUBMIT_READY_TEXT =
        "Native TextInput ready for submit"
    private const val TEXT_INPUT_SUBMITTED_TEXT =
        "Native TextInput submit and blur observed"
    private const val MULTILINE_TEXT_INPUT_VALUE = "Solid\nNative"
    private const val MULTILINE_TEXT_INPUT_READY_TEXT =
        "Native multiline TextInput ready for newline"
    private const val MULTILINE_TEXT_INPUT_SUCCEEDED_TEXT =
        "Native multiline TextInput newline observed"
    private const val SWITCH_LABEL = "Solid Native controlled switch"
    private const val SWITCH_SUCCEEDED_TEXT =
        "Native controlled Switch rollback observed"
    private const val MODAL_TITLE_TEXT = "Solid Native modal is presented"
    private const val MODAL_CLOSE_LABEL = "Close Solid Native modal"
    private const val MODAL_PRESENT_LABEL = "Present Solid Native modal"
    private const val NOTIFICATION_PROOF_TITLE =
        "Solid Native notification proof"
    private const val NOTIFICATION_PROOF_BODY =
        "Delivered by a React-free New Architecture module"
    private const val NOTIFICATION_DELIVERED_TEXT =
        "Native notification delivery observed"
    private const val NOTIFICATION_PRESSED_TEXT =
        "Native notification press observed"
    private const val READY_TIMEOUT_MS = 10_000L
    private const val PROOF_TIMEOUT_MS = 10_000L
    private const val TEARDOWN_TIMEOUT_MS = 20_000L
    private const val LIFECYCLE_SETTLE_MS = 500L
    private const val NAVIGATION_SETTLE_MS = 1_000L
    private const val POLL_INTERVAL_MS = 50L
    private const val TAP_DURATION_MS = 50L
    private const val SWIPE_STEP_MS = 16L
  }
}
