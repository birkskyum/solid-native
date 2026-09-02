package dev.solidnative.runtime

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import com.facebook.jni.HybridData
import com.facebook.jni.annotations.DoNotStrip
import com.facebook.react.runtime.BindingsInstaller
import com.facebook.soloader.SoLoader

/** Installs the Solid Native host object before the application bundle runs. */
@DoNotStrip
class SolidNativeBindingsInstaller private constructor(hybridData: HybridData) :
    BindingsInstaller(hybridData) {

  constructor() : this(initHybrid())

  external fun publishSurface(surfaceId: Int)

  external fun clearSurface(surfaceId: Int)

  external fun deactivateSurface(surfaceId: Int)

  fun setSurfaceStopHandler(handler: ((Int) -> Unit)?) {
    surfaceStopHandler = handler
  }

  fun setFatalErrorHandler(handler: ((Int, String, String) -> Unit)?) {
    fatalErrorHandler = handler
  }

  fun setUIWorkletOutputHandler(handler: ((UIWorkletFrame) -> Boolean)?) {
    uiWorkletOutputHandler = handler
  }

  fun setUIWorkletPanGestureHandlers(
      attach: ((Long, Int) -> Boolean)?,
      detach: ((Long) -> Unit)?,
  ) {
    uiWorkletPanAttachHandler = attach
    uiWorkletPanDetachHandler = detach
  }

  companion object {
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var surfaceStopHandler: ((Int) -> Unit)? = null

    @Volatile private var fatalErrorHandler: ((Int, String, String) -> Unit)? = null

    @Volatile private var uiWorkletOutputHandler: ((UIWorkletFrame) -> Boolean)? = null

    @Volatile private var uiWorkletPanAttachHandler: ((Long, Int) -> Boolean)? = null

    @Volatile private var uiWorkletPanDetachHandler: ((Long) -> Unit)? = null

    @Volatile private var lastUIWorkletFrame: UIWorkletFrame? = null

    init {
      SoLoader.loadLibrary("appmodules")
    }

    @JvmStatic @DoNotStrip private external fun initHybrid(): HybridData

    @JvmStatic
    @DoNotStrip
    fun requestSurfaceStop(surfaceId: Int) {
      mainHandler.post { surfaceStopHandler?.invoke(surfaceId) }
    }

    @JvmStatic
    @DoNotStrip
    fun requestFatalError(surfaceId: Int, name: String, message: String) {
      mainHandler.post { fatalErrorHandler?.invoke(surfaceId, name, message) }
    }

    @JvmStatic
    @DoNotStrip
    fun requestCommitFrame(token: Long) {
      mainHandler.post {
        Choreographer.getInstance().postFrameCallback {
          onCommitFrame(token)
        }
      }
    }

    @JvmStatic
    @DoNotStrip
    fun requestUIWorkletFrame(token: Long) {
      mainHandler.post {
        Choreographer.getInstance().postFrameCallback { frameTimeNanoseconds ->
          onUIWorkletFrame(token, frameTimeNanoseconds)
        }
      }
    }

    @JvmStatic
    @DoNotStrip
    private fun attachUIWorkletPanGesture(token: Long, targetTag: Int): Boolean {
      val handler = uiWorkletPanAttachHandler ?: return false
      if (Looper.myLooper() === Looper.getMainLooper()) {
        return handler(token, targetTag)
      }
      val completed = CountDownLatch(1)
      var attached = false
      mainHandler.post {
        try {
          attached = uiWorkletPanAttachHandler?.invoke(token, targetTag) == true
        } catch (error: Throwable) {
          Log.e(TAG, "Failed to attach a native UI worklet pan.", error)
        } finally {
          completed.countDown()
        }
      }
      return try {
        completed.await(PAN_ATTACHMENT_TIMEOUT_SECONDS, TimeUnit.SECONDS) && attached
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        false
      }
    }

    @JvmStatic
    @DoNotStrip
    private fun detachUIWorkletPanGesture(token: Long) {
      if (Looper.myLooper() === Looper.getMainLooper()) {
        uiWorkletPanDetachHandler?.invoke(token)
      } else {
        mainHandler.post { uiWorkletPanDetachHandler?.invoke(token) }
      }
    }

    @JvmStatic
    fun dispatchUIWorkletPanGesture(
        token: Long,
        phase: Int,
        translationX: Double,
        translationY: Double,
        timestamp: Double,
        velocityX: Double,
        velocityY: Double,
    ) {
      onUIWorkletPan(
          token,
          phase,
          translationX,
          translationY,
          timestamp,
          velocityX,
          velocityY,
      )
    }

    @JvmStatic
    @DoNotStrip
    private fun applyUIWorkletFrame(
        handle: Long,
        targetTag: Int,
        sequence: Long,
        frameTimeNanoseconds: Long,
        opacity: Double,
        translateX: Double,
        translateY: Double,
        scaleX: Double,
        scaleY: Double,
        rotation: Double,
    ): Boolean {
      val onMainThread = Looper.myLooper() === Looper.getMainLooper()
      val frame =
          UIWorkletFrame(
              handle = handle,
              targetTag = targetTag,
              sequence = sequence,
              frameTimeNanoseconds = frameTimeNanoseconds,
              opacity = opacity,
              translateX = translateX,
              translateY = translateY,
              scaleX = scaleX,
              scaleY = scaleY,
              rotation = rotation,
              onMainThread = onMainThread,
          )
      if (!onMainThread) {
        lastUIWorkletFrame = frame.copy(applied = false)
        return false
      }
      val applied =
          try {
            uiWorkletOutputHandler?.invoke(frame) == true
          } catch (error: Throwable) {
            Log.e(TAG, "Failed to apply a native UI worklet frame.", error)
            false
          }
      lastUIWorkletFrame = frame.copy(applied = applied)
      return applied
    }

    @JvmStatic fun getLastUIWorkletFrame(): UIWorkletFrame? = lastUIWorkletFrame

    @JvmStatic @DoNotStrip private external fun onCommitFrame(token: Long)

    @JvmStatic
    @DoNotStrip
    private external fun onUIWorkletFrame(token: Long, frameTimeNanoseconds: Long)

    @JvmStatic
    @DoNotStrip
    private external fun onUIWorkletPan(
        token: Long,
        phase: Int,
        translationX: Double,
        translationY: Double,
        timestamp: Double,
        velocityX: Double,
        velocityY: Double,
    )

    private const val TAG = "SOLID_NATIVE"
    private const val PAN_ATTACHMENT_TIMEOUT_SECONDS = 5L
  }
}

data class UIWorkletFrame(
    val handle: Long,
    val targetTag: Int,
    val sequence: Long,
    val frameTimeNanoseconds: Long,
    val opacity: Double,
    val translateX: Double,
    val translateY: Double,
    val scaleX: Double,
    val scaleY: Double,
    val rotation: Double,
    val onMainThread: Boolean,
    val applied: Boolean = false,
)
