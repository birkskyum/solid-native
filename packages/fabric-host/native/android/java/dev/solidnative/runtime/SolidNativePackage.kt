package dev.solidnative.runtime

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers the package-owned runtime modules with the selected React Native Fabric backend. */
class SolidNativePackage : BaseReactPackage() {
  override fun getModule(
      name: String,
      reactContext: ReactApplicationContext,
  ): NativeModule? =
      when (name) {
        SolidNativeDebugModule.NAME -> SolidNativeDebugModule(reactContext)
        SolidNativePlatformModule.NAME -> SolidNativePlatformModule(reactContext)
        else -> null
      }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        SolidNativeDebugModule.NAME to
            ReactModuleInfo(
                SolidNativeDebugModule.NAME,
                SolidNativeDebugModule::class.java.name,
                false,
                false,
                false,
                true,
            ),
        SolidNativePlatformModule.NAME to
            ReactModuleInfo(
                SolidNativePlatformModule.NAME,
                SolidNativePlatformModule::class.java.name,
                false,
                false,
                false,
                true,
            ),
    )
  }
}
