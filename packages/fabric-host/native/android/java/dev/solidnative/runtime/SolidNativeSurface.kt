package dev.solidnative.runtime

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.VelocityTracker
import androidx.core.os.ConfigurationCompat
import androidx.core.text.TextUtilsCompat
import com.facebook.react.ReactHost
import com.facebook.react.interfaces.TaskInterface
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.modules.i18nmanager.I18nUtil
import java.util.Locale

fun interface SolidNativeSurfaceStatusHandler {
  fun onStatus(status: String, error: Throwable?)
}

/**
 * Owns the package-supported, full-screen Android Fabric surface and its native UI worklet hooks.
 * Start and stop this object on the Android main thread.
 */
class SolidNativeSurface private constructor(
    private val activity: Activity,
    private val bindingsInstaller: SolidNativeBindingsInstaller,
    private val surface: ReactSurface,
    private val statusHandler: SolidNativeSurfaceStatusHandler?,
) {
  private val rootView = checkNotNull(surface.view) { "React Native did not create a surface view." }
  private val uiWorkletPans = mutableMapOf<Long, UIWorkletPanAttachment>()
  private var stopping = false
  private var stopped = false
  private var terminalFailureRequested = false

  val view: View
    get() = rootView

  val surfaceId: Int
    get() = surface.surfaceID

  fun stop() {
    requireMainThread("stop")
    beginStop()
  }

  private fun start() {
    bindingsInstaller.setSurfaceStopHandler(::stopFromHost)
    bindingsInstaller.setFatalErrorHandler(::showFatalFromHost)
    bindingsInstaller.setUIWorkletOutputHandler(::applyUIWorkletFrame)
    bindingsInstaller.setUIWorkletPanGestureHandlers(
        ::attachUIWorkletPanGesture,
        ::detachUIWorkletPanGesture,
    )
    activity.setContentView(rootView)
    val startTask =
        try {
          surface.start()
        } catch (error: Throwable) {
          reportStatus("surface-start-failed", error)
          beginStop()
          return
        }
    waitForStart(startTask, 0)
  }

  private fun waitForStart(task: TaskInterface<Void>, attempt: Int) {
    if (stopping) return
    if (task.isCompleted()) {
      val error = task.getError()
      if (task.isCancelled() || task.isFaulted() || error != null) {
        val failure =
            error
                ?: IllegalStateException(
                    if (task.isCancelled()) {
                      "React Native cancelled the Solid Native Fabric surface start."
                    } else {
                      "React Native failed the Solid Native Fabric surface start."
                    },
                )
        reportStatus("surface-start-failed", failure)
        beginStop()
        return
      }
      reportStatus("surface-started", null)
      publishSurfaceWhenReady(0)
      return
    }
    if (attempt >= MAX_TASK_ATTEMPTS) {
      val error =
          IllegalStateException(
              "React Native did not start the Solid Native Fabric surface within ten seconds.",
          )
      reportStatus("surface-start-failed", error)
      beginStop()
      return
    }
    rootView.postDelayed(
        { waitForStart(task, attempt + 1) },
        TASK_RETRY_MILLISECONDS,
    )
  }

  private fun publishSurfaceWhenReady(attempt: Int) {
    if (stopping) return
    val currentSurfaceId = surface.surfaceID
    if (currentSurfaceId > 0) {
      try {
        bindingsInstaller.publishSurface(currentSurfaceId)
        reportStatus("surface-ready", null)
      } catch (error: Throwable) {
        reportStatus("surface-publish-failed", error)
        beginStop()
      }
      return
    }
    if (attempt >= MAX_TASK_ATTEMPTS) {
      val error =
          IllegalStateException(
              "Fabric did not allocate a Solid Native surface within ten seconds.",
          )
      reportStatus("surface-publish-failed", error)
      beginStop()
      return
    }
    rootView.postDelayed(
        { publishSurfaceWhenReady(attempt + 1) },
        TASK_RETRY_MILLISECONDS,
    )
  }

  private fun stopFromHost(requestedSurfaceId: Int) {
    if (requestedSurfaceId != surface.surfaceID) return
    beginStop()
  }

  private fun showFatalFromHost(
      requestedSurfaceId: Int,
      name: String,
      message: String,
  ) {
    if (
        requestedSurfaceId != surface.surfaceID ||
            stopping ||
            stopped ||
            terminalFailureRequested
    ) {
      return
    }
    terminalFailureRequested = true
    val failure = IllegalStateException("$name: $message")
    reportStatus("runtime-failed", failure)
    beginStop()
    SolidNativeStartupFailureView.show(activity, name, message)
  }

  private fun beginStop() {
    if (stopping || stopped) return
    stopping = true
    bindingsInstaller.setSurfaceStopHandler(null)
    bindingsInstaller.setFatalErrorHandler(null)
    bindingsInstaller.setUIWorkletOutputHandler(null)
    bindingsInstaller.setUIWorkletPanGestureHandlers(null, null)
    clearUIWorkletPanGestures()

    val currentSurfaceId = surface.surfaceID
    var initialFailure: Throwable? = null
    if (currentSurfaceId > 0) {
      try {
        bindingsInstaller.deactivateSurface(currentSurfaceId)
      } catch (error: Throwable) {
        initialFailure = error
        Log.e(TAG, "Failed to deactivate Solid Native surface work.", error)
      }
    }

    val stopTask =
        try {
          surface.stop()
        } catch (error: Throwable) {
          finishStop(mergeFailure(initialFailure, error))
          return
        }
    waitForStop(stopTask, 0, initialFailure)
  }

  private fun waitForStop(
      task: TaskInterface<Void>,
      attempt: Int,
      initialFailure: Throwable?,
  ) {
    if (task.isCompleted()) {
      val taskFailure =
          task.getError()
              ?: if (task.isCancelled()) {
                IllegalStateException("React Native cancelled the Fabric surface stop.")
              } else if (task.isFaulted()) {
                IllegalStateException("React Native failed the Fabric surface stop.")
              } else {
                null
              }
      finishStop(mergeFailure(initialFailure, taskFailure))
      return
    }
    if (attempt >= MAX_TASK_ATTEMPTS) {
      finishStop(
          mergeFailure(
              initialFailure,
              IllegalStateException(
                  "React Native did not stop the Solid Native Fabric surface within ten seconds.",
              ),
          ),
      )
      return
    }
    rootView.postDelayed(
        { waitForStop(task, attempt + 1, initialFailure) },
        TASK_RETRY_MILLISECONDS,
    )
  }

  private fun finishStop(initialFailure: Throwable?) {
    var failure = initialFailure
    try {
      surface.clear()
    } catch (error: Throwable) {
      failure = mergeFailure(failure, error)
    }
    try {
      surface.detach()
    } catch (error: Throwable) {
      failure = mergeFailure(failure, error)
    }
    val currentSurfaceId = surface.surfaceID
    if (currentSurfaceId > 0) {
      try {
        bindingsInstaller.clearSurface(currentSurfaceId)
      } catch (error: Throwable) {
        failure = mergeFailure(failure, error)
      }
    }
    stopped = true
    reportStatus(if (failure == null) "surface-stopped" else "surface-stop-failed", failure)
  }

  private fun applyUIWorkletFrame(frame: UIWorkletFrame): Boolean {
    if (stopping || stopped) return false
    val target = activity.window.decorView.findViewById<View>(frame.targetTag) ?: return false
    if (!target.isAttachedToWindow) return false
    val values =
        doubleArrayOf(
            frame.opacity,
            frame.translateX,
            frame.translateY,
            frame.scaleX,
            frame.scaleY,
            frame.rotation,
        )
    if (values.any { !it.isNaN() && !it.isFinite() }) return false
    if (!frame.opacity.isNaN() && frame.opacity !in 0.0..1.0) return false

    val density = activity.resources.displayMetrics.density
    if (!frame.opacity.isNaN()) target.alpha = frame.opacity.toFloat()
    if (!frame.translateX.isNaN()) target.translationX = frame.translateX.toFloat() * density
    if (!frame.translateY.isNaN()) target.translationY = frame.translateY.toFloat() * density
    if (!frame.scaleX.isNaN()) target.scaleX = frame.scaleX.toFloat()
    if (!frame.scaleY.isNaN()) target.scaleY = frame.scaleY.toFloat()
    if (!frame.rotation.isNaN()) target.rotation = frame.rotation.toFloat()
    return true
  }

  private fun attachUIWorkletPanGesture(token: Long, targetTag: Int): Boolean {
    if (stopping || stopped || uiWorkletPans.containsKey(token)) return false
    val target = activity.window.decorView.findViewById<View>(targetTag) ?: return false
    if (!target.isAttachedToWindow) return false
    val density = activity.resources.displayMetrics.density.toDouble()
    var startRawX = 0.0
    var startRawY = 0.0
    var velocityTracker: VelocityTracker? = null
    val listener =
        View.OnTouchListener { _, event ->
          val action = event.actionMasked
          if (action == MotionEvent.ACTION_DOWN) {
            velocityTracker?.recycle()
            velocityTracker = VelocityTracker.obtain()
          }
          velocityTracker?.addMovement(event)
          val phase =
              when (action) {
                MotionEvent.ACTION_DOWN -> {
                  startRawX = event.rawX.toDouble()
                  startRawY = event.rawY.toDouble()
                  0
                }
                MotionEvent.ACTION_MOVE -> 1
                MotionEvent.ACTION_UP -> 2
                MotionEvent.ACTION_CANCEL -> 3
                else -> return@OnTouchListener true
              }
          if (action == MotionEvent.ACTION_UP) {
            velocityTracker?.computeCurrentVelocity(1_000)
          }
          val velocityX =
              if (action == MotionEvent.ACTION_UP) {
                (velocityTracker?.xVelocity?.toDouble() ?: 0.0) / density
              } else {
                0.0
              }
          val velocityY =
              if (action == MotionEvent.ACTION_UP) {
                (velocityTracker?.yVelocity?.toDouble() ?: 0.0) / density
              } else {
                0.0
              }
          SolidNativeBindingsInstaller.dispatchUIWorkletPanGesture(
              token = token,
              phase = phase,
              translationX = (event.rawX.toDouble() - startRawX) / density,
              translationY = (event.rawY.toDouble() - startRawY) / density,
              timestamp = event.eventTime.toDouble(),
              velocityX = velocityX,
              velocityY = velocityY,
          )
          if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            velocityTracker?.recycle()
            velocityTracker = null
          }
          true
        }
    target.setOnTouchListener(listener)
    uiWorkletPans[token] =
        UIWorkletPanAttachment(target) {
          velocityTracker?.recycle()
          velocityTracker = null
        }
    return true
  }

  private fun detachUIWorkletPanGesture(token: Long) {
    val attachment = uiWorkletPans.remove(token) ?: return
    attachment.target.setOnTouchListener(null)
    attachment.release()
  }

  private fun clearUIWorkletPanGestures() {
    for (attachment in uiWorkletPans.values) {
      attachment.target.setOnTouchListener(null)
      attachment.release()
    }
    uiWorkletPans.clear()
  }

  private fun reportStatus(status: String, error: Throwable?) {
    try {
      statusHandler?.onStatus(status, error)
    } catch (handlerError: Throwable) {
      Log.e(TAG, "The Solid Native surface status handler failed.", handlerError)
    }
  }

  companion object {
    @JvmStatic
    @JvmOverloads
    fun start(
        activity: Activity,
        reactHost: ReactHost,
        bindingsInstaller: SolidNativeBindingsInstaller,
        statusHandler: SolidNativeSurfaceStatusHandler? = null,
    ): SolidNativeSurface {
      requireMainThread("start")
      synchronizeLayoutDirection(activity)
      val surface = reactHost.createSurface(activity, "", null)
      return SolidNativeSurface(activity, bindingsInstaller, surface, statusHandler).also {
        it.start()
      }
    }

    private fun requireMainThread(operation: String) {
      check(Looper.myLooper() === Looper.getMainLooper()) {
        "SolidNativeSurface.$operation must run on the Android main thread."
      }
    }

    /**
     * React Native 0.87 resolves natural RTL against an arbitrary available locale instead of the
     * Activity's effective application locale. Synchronize its package-scoped Fabric preferences
     * before surface creation so scoped Android locale changes drive both the native view tree and
     * Yoga without evaluating or exposing the JavaScript I18nManager mutation facade. Updating both
     * flags is necessary because forceRTL(false) otherwise falls through to the defective natural
     * locale lookup.
     */
    private fun synchronizeLayoutDirection(activity: Activity) {
      val locale =
          ConfigurationCompat.getLocales(activity.resources.configuration)[0]
              ?: Locale.getDefault()
      val supportsRTL =
          activity.applicationInfo.flags and ApplicationInfo.FLAG_SUPPORTS_RTL != 0
      val isRTL =
          supportsRTL &&
              TextUtilsCompat.getLayoutDirectionFromLocale(locale) == View.LAYOUT_DIRECTION_RTL
      I18nUtil.instance.allowRTL(activity, isRTL)
      I18nUtil.instance.forceRTL(activity, isRTL)
    }

    private fun mergeFailure(current: Throwable?, next: Throwable?): Throwable? {
      if (next == null) return current
      if (current == null) return next
      if (current !== next) current.addSuppressed(next)
      return current
    }

    private const val TAG = "SolidNativeSurface"
    private const val MAX_TASK_ATTEMPTS = 1_000
    private const val TASK_RETRY_MILLISECONDS = 10L
  }
}

private data class UIWorkletPanAttachment(
    val target: View,
    val release: () -> Unit,
)
