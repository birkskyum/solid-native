package dev.solidnative.e2e

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import dev.solidnative.runtime.SolidNativeBindingsInstaller
import dev.solidnative.runtime.SolidNativeMemoryWarning
import dev.solidnative.runtime.SolidNativePackage

class MainApplication : Application(), ReactApplication {
  val solidNativeBindingsInstaller: SolidNativeBindingsInstaller by lazy {
    SolidNativeBindingsInstaller()
  }

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
        context = applicationContext,
        packageList =
            PackageList(this).packages +
                SolidNativePackage() +
                SolidNativeGeneratedViewPackage(),
        jsMainModulePath =
            if (BuildConfig.DEBUG && BuildConfig.SOLID_NATIVE_DEVTOOLS) {
                "devtools"
            } else if (BuildConfig.DEBUG && BuildConfig.SOLID_NATIVE_DEV_RELOAD) {
                "dev-entry"
            } else if (BuildConfig.DEBUG && BuildConfig.SOLID_NATIVE_DIAGNOSTICS) {
                "diagnostics"
            } else if (BuildConfig.SOLID_NATIVE_WORKLET) {
                "worklet"
            } else if (BuildConfig.SOLID_NATIVE_LIST) {
                if (BuildConfig.SOLID_NATIVE_CONTROL) "list-control" else "list"
            } else if (BuildConfig.SOLID_NATIVE_TELEMETRY_BENCHMARK) {
                if (BuildConfig.SOLID_NATIVE_TELEMETRY_ENABLED) {
                    "telemetry-observed"
                } else {
                    "telemetry-baseline"
                }
            } else if (BuildConfig.SOLID_NATIVE_MEMORY) {
                if (BuildConfig.SOLID_NATIVE_CONTROL) "memory-control" else "memory"
            } else if (BuildConfig.SOLID_NATIVE_CONTROL) {
                "control"
            } else {
                "index"
            },
        jsBundleAssetPath = "index.android.bundle",
        useDevSupport = BuildConfig.DEBUG,
        bindingsInstaller =
            if (BuildConfig.SOLID_NATIVE_CONTROL) null else solidNativeBindingsInstaller,
    )
  }

  override fun onCreate() {
    super.onCreate()
    if (BuildConfig.SOLID_NATIVE_VIEW_RECYCLING) {
      SolidNativeReactNativeLoader.loadWithViewRecycling(this)
    } else {
      loadReactNative(this)
    }
  }

  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    SolidNativeMemoryWarning.handleTrimMemory(level)
  }

  override fun onLowMemory() {
    super.onLowMemory()
    SolidNativeMemoryWarning.handleLowMemory()
  }
}
