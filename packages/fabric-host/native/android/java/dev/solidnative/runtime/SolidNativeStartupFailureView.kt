package dev.solidnative.runtime

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Looper
import android.view.Gravity
import android.widget.TextView

/** Renders a dependency-free terminal startup fallback after Fabric cannot own the screen. */
object SolidNativeStartupFailureView {
  @JvmStatic
  @JvmOverloads
  fun show(activity: Activity, error: Throwable? = null) {
    render(
        activity,
        error?.javaClass?.simpleName?.ifEmpty { "Error" },
        error?.message,
    )
  }

  internal fun show(activity: Activity, name: String, message: String) {
    render(activity, name, message)
  }

  private fun render(activity: Activity, name: String?, message: String?) {
    check(Looper.myLooper() === Looper.getMainLooper()) {
      "SolidNativeStartupFailureView.show must run on the Android main thread."
    }
    val debuggable =
        activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    val message =
        if (debuggable && name != null && message != null) {
          "$GENERIC_MESSAGE\n\n${boundedDiagnostic(name, message)}"
        } else {
          GENERIC_MESSAGE
        }
    val density = activity.resources.displayMetrics.density
    val padding = (32 * density).toInt()
    val view =
        TextView(activity).apply {
          text = message
          contentDescription = message
          gravity = Gravity.CENTER
          setPadding(padding, padding, padding, padding)
          setTextColor(Color.rgb(17, 24, 39))
          setBackgroundColor(Color.rgb(247, 248, 250))
          textSize = 18f
          isFocusable = true
        }
    activity.setContentView(view)
    view.requestFocus()
  }

  private fun boundedDiagnostic(rawName: String, rawMessage: String): String {
    val name = sanitize(rawName.ifEmpty { "Error" }, MAX_NAME_LENGTH)
    val maximumMessageLength =
        MAX_DIAGNOSTIC_LENGTH - name.length - DIAGNOSTIC_SEPARATOR.length
    val message =
        sanitize(
            rawMessage.ifEmpty { "No diagnostic message was provided." },
            maximumMessageLength,
        )
    return "$name$DIAGNOSTIC_SEPARATOR$message"
  }

  private fun sanitize(value: String, maximumLength: Int): String {
    val truncated = value.length > maximumLength
    val contentLength = if (truncated) maximumLength - 1 else maximumLength
    val normalized =
        buildString(minOf(value.length, maximumLength)) {
          for (character in value) {
            if (length >= contentLength) break
            append(
                if (character == '\n' || character == '\t' || !character.isISOControl()) {
                  character
                } else {
                  ' '
                },
            )
          }
        }
    if (!truncated) return normalized
    val safePrefix =
        if (normalized.lastOrNull()?.isHighSurrogate() == true) normalized.dropLast(1) else normalized
    return "$safePrefix…"
  }

  private const val GENERIC_MESSAGE = "Solid Native could not start."
  private const val DIAGNOSTIC_SEPARATOR = ": "
  private const val MAX_NAME_LENGTH = 128
  private const val MAX_DIAGNOSTIC_LENGTH = 2_048
}
