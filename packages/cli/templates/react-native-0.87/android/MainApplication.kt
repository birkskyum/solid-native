package __ANDROID_PACKAGE__

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
        packageList = PackageList(this).packages + SolidNativePackage(),
        jsMainModulePath = "index",
        jsBundleAssetPath = "index.android.bundle",
        useDevSupport = BuildConfig.DEBUG,
        bindingsInstaller = solidNativeBindingsInstaller,
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
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
