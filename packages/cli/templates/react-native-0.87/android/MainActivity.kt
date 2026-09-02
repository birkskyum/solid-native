package __ANDROID_PACKAGE__

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import dev.solidnative.runtime.SolidNativeSurface
import dev.solidnative.runtime.SolidNativeStartupFailureView

class MainActivity :
    AppCompatActivity(),
    DefaultHardwareBackBtnHandler,
    PermissionAwareActivity {
  private lateinit var nativeApplication: MainApplication
  private var solidNativeSurface: SolidNativeSurface? = null
  private var permissionListener: PermissionListener? = null
  private val backPressedCallback =
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (!nativeApplication.reactHost.onBackPressed()) {
            invokeDefaultOnBackPressed()
          }
        }
      }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    nativeApplication = application as MainApplication
    try {
      solidNativeSurface =
          SolidNativeSurface.start(
              activity = this,
              reactHost = nativeApplication.reactHost,
              bindingsInstaller = nativeApplication.solidNativeBindingsInstaller,
              statusHandler = { status, error ->
                if (
                    error != null &&
                        (status == "surface-start-failed" ||
                            status == "surface-publish-failed")
                ) {
                  Log.e(TAG, "Solid Native startup failed at $status.", error)
                  SolidNativeStartupFailureView.show(this, error)
                }
              },
          )
    } catch (error: Throwable) {
      Log.e(TAG, "Solid Native startup failed before surface creation.", error)
      SolidNativeStartupFailureView.show(this, error)
    }
    onBackPressedDispatcher.addCallback(this, backPressedCallback)
  }

  override fun onResume() {
    super.onResume()
    nativeApplication.reactHost.onHostResume(this, this)
  }

  override fun onPause() {
    nativeApplication.reactHost.onHostPause(this)
    super.onPause()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    nativeApplication.reactHost.onNewIntent(intent)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    if (::nativeApplication.isInitialized) {
      nativeApplication.reactHost.onConfigurationChanged(this)
    }
  }

  override fun requestPermissions(
      permissions: Array<String>,
      requestCode: Int,
      listener: PermissionListener?,
  ) {
    permissionListener = listener
    super.requestPermissions(permissions, requestCode)
  }

  override fun onRequestPermissionsResult(
      requestCode: Int,
      permissions: Array<String>,
      grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    val listener = permissionListener ?: return
    if (listener.onRequestPermissionsResult(requestCode, permissions, grantResults)) {
      permissionListener = null
    }
  }

  override fun onDestroy() {
    solidNativeSurface?.stop()
    solidNativeSurface = null
    if (::nativeApplication.isInitialized) {
      nativeApplication.reactHost.onHostDestroy(this)
    }
    super.onDestroy()
  }

  override fun invokeDefaultOnBackPressed() {
    backPressedCallback.isEnabled = false
    try {
      onBackPressedDispatcher.onBackPressed()
    } finally {
      backPressedCallback.isEnabled = true
    }
  }

  companion object {
    private const val TAG = "SolidNativeMainActivity"
  }
}
