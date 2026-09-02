package dev.solidnative.runtime

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import java.lang.ref.WeakReference

/** Package-owned Android lifecycle events that React Native does not expose. */
@ReactModule(name = SolidNativePlatformModule.NAME)
class SolidNativePlatformModule(
    private val context: ReactApplicationContext,
) : NativeSolidNativePlatformAndroidSpec(context) {
  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    SolidNativeMemoryWarning.attach(this)
  }

  override fun invalidate() {
    SolidNativeMemoryWarning.detach(this)
    super.invalidate()
  }

  internal fun emitMemoryWarning(level: Int) {
    if (!context.hasActiveReactInstance()) return
    val event = Arguments.createMap().apply { putInt("level", level) }
    try {
      emitOnMemoryWarning(event)
    } catch (_: RuntimeException) {
      // A lifecycle callback must not crash Application while memory is scarce.
      // A future warning can retry after the React instance becomes healthy.
    }
  }

  companion object {
    const val NAME = "SolidNativePlatformAndroid"
  }
}

/**
 * Application lifecycle seam for Android memory pressure.
 *
 * `TRIM_MEMORY_UI_HIDDEN` is deliberately not a warning: backgrounding is an
 * application-visibility transition, not evidence that the OS needs memory.
 * Running-low/critical and background-or-worse levels request cache reduction.
 */
object SolidNativeMemoryWarning {
  private const val RUNNING_LOW = 10
  private const val RUNNING_CRITICAL = 15
  private const val BACKGROUND = 40
  private const val LOW_MEMORY_LEVEL = 80
  private var activeModule: WeakReference<SolidNativePlatformModule>? = null

  @Synchronized
  internal fun attach(module: SolidNativePlatformModule) {
    activeModule = WeakReference(module)
  }

  @Synchronized
  internal fun detach(module: SolidNativePlatformModule) {
    if (activeModule?.get() === module) activeModule = null
  }

  @JvmStatic
  fun handleTrimMemory(level: Int) {
    if (!isMemoryPressure(level)) return
    currentModule()?.emitMemoryWarning(level)
  }

  @JvmStatic
  fun handleLowMemory() {
    currentModule()?.emitMemoryWarning(LOW_MEMORY_LEVEL)
  }

  @Synchronized
  private fun currentModule(): SolidNativePlatformModule? = activeModule?.get()

  private fun isMemoryPressure(level: Int): Boolean =
      level in RUNNING_LOW..RUNNING_CRITICAL || level >= BACKGROUND
}
