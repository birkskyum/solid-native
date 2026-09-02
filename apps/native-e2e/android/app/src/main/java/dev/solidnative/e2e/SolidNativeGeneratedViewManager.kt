package dev.solidnative.e2e

import android.graphics.Color
import android.view.Gravity
import android.widget.TextView
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.SolidNativeGeneratedViewManagerDelegate
import com.facebook.react.viewmanagers.SolidNativeGeneratedViewManagerInterface

@ReactModule(name = SolidNativeGeneratedViewManager.REACT_CLASS)
class SolidNativeGeneratedViewManager :
    SimpleViewManager<TextView>(),
    SolidNativeGeneratedViewManagerInterface<TextView> {
  private val delegate =
      SolidNativeGeneratedViewManagerDelegate<TextView, SolidNativeGeneratedViewManager>(this)

  override fun getDelegate(): ViewManagerDelegate<TextView> = delegate

  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): TextView =
      TextView(context).apply {
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        textSize = 15f
      }

  @ReactProp(name = "label")
  override fun setLabel(view: TextView, value: String?) {
    view.text = value.orEmpty()
  }

  companion object {
    const val REACT_CLASS = "SolidNativeGeneratedView"
  }
}
