package dev.solidnative.runtime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileOutputStream

/**
 * Debuggable-build-only, app-private mailbox for bounded one-shot debug operations.
 * The request receiver is not exported and responses never leave app storage.
 */
@ReactModule(name = SolidNativeDebugModule.NAME)
class SolidNativeDebugModule(
    private val context: ReactApplicationContext,
) : NativeSolidNativeDebugSpec(context) {
  private val lock = Any()
  private val pendingRequestIds = linkedSetOf<String>()
  private var listenerReady = false
  private var receiverRegistered = false

  private val requestReceiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          if (intent?.action != requestAction()) return
          val requestId = intent.getStringExtra(REQUEST_ID_EXTRA) ?: return
          if (!REQUEST_ID_PATTERN.matches(requestId)) return
          val operation = intent.getStringExtra(OPERATION_EXTRA) ?: OPERATION_CAUSAL_SNAPSHOT
          if (operation !in ALLOWED_OPERATIONS) return
          val sessionId = intent.getStringExtra(SESSION_ID_EXTRA)
          if (operation == OPERATION_SOLID_DIAGNOSTICS_END) {
            if (sessionId == null || !REQUEST_ID_PATTERN.matches(sessionId)) return
          } else if (sessionId != null) {
            return
          }
          val accepted = synchronized(lock) {
            if (!listenerReady) return
            while (pendingRequestIds.size >= MAX_PENDING_REQUESTS) {
              pendingRequestIds.remove(pendingRequestIds.first())
            }
            pendingRequestIds.add(requestId)
          }
          if (!accepted) return
          responseFile(requestId).delete()
          val event =
              Arguments.createMap().apply {
                putString("requestId", requestId)
                putString("operation", operation)
                if (sessionId != null) putString("sessionId", sessionId)
              }
          try {
            if (!this@SolidNativeDebugModule.context.hasActiveReactInstance()) {
              synchronized(lock) { pendingRequestIds.remove(requestId) }
              return
            }
            emitOnSnapshotRequest(event)
          } catch (error: Throwable) {
            synchronized(lock) { pendingRequestIds.remove(requestId) }
          }
        }
      }

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    if (!isDebuggable() || receiverRegistered) return
    val filter = IntentFilter(requestAction())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(requestReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION") context.registerReceiver(requestReceiver, filter)
    }
    receiverRegistered = true
  }

  override fun invalidate() {
    synchronized(lock) {
      listenerReady = false
      pendingRequestIds.clear()
    }
    if (receiverRegistered) {
      try {
        context.unregisterReceiver(requestReceiver)
      } catch (_: IllegalArgumentException) {
      }
      receiverRegistered = false
    }
    super.invalidate()
  }

  @ReactMethod
  override fun setSnapshotListenerReady(ready: Boolean) {
    synchronized(lock) {
      listenerReady = ready
      if (!ready) pendingRequestIds.clear()
    }
  }

  @ReactMethod
  override fun publishSnapshot(requestId: String, payload: String, promise: Promise) {
    if (!isDebuggable()) {
      promise.reject(ERROR_UNAVAILABLE, "Native debug transport requires a debuggable build.")
      return
    }
    if (!REQUEST_ID_PATTERN.matches(requestId)) {
      promise.reject(ERROR_REQUEST, "Native debug request ID is invalid.")
      return
    }
    val accepted = synchronized(lock) { pendingRequestIds.remove(requestId) }
    if (!accepted) {
      promise.reject(ERROR_REQUEST, "Native debug request is unknown or already settled.")
      return
    }
    val bytes = payload.toByteArray(Charsets.UTF_8)
    if (bytes.isEmpty() || bytes.size > MAX_SNAPSHOT_BYTES) {
      promise.reject(
          ERROR_PAYLOAD,
          "Native debug response must contain 1-$MAX_SNAPSHOT_BYTES UTF-8 bytes.",
      )
      return
    }
    try {
      val directory = responseDirectory()
      check(directory.isDirectory || directory.mkdirs()) {
        "Could not create the native debug response directory."
      }
      val temporary = File(directory, ".$requestId.tmp")
      temporary.delete()
      FileOutputStream(temporary).use { output ->
        output.write(bytes)
        output.fd.sync()
      }
      val response = responseFile(requestId)
      response.delete()
      check(temporary.renameTo(response)) {
        "Could not publish the native debug response atomically."
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      File(responseDirectory(), ".$requestId.tmp").delete()
      promise.reject(ERROR_WRITE, "Could not publish the native debug response.", error)
    }
  }

  private fun isDebuggable(): Boolean =
      context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

  private fun requestAction(): String =
      "${context.packageName}.$REQUEST_ACTION_SUFFIX"

  private fun responseDirectory(): File = File(context.cacheDir, RESPONSE_DIRECTORY)

  private fun responseFile(requestId: String): File =
      File(responseDirectory(), "$requestId.json")

  companion object {
    const val NAME = "SolidNativeDebug"
    const val REQUEST_ACTION_SUFFIX = "solidnative.DEBUG_SNAPSHOT_REQUEST"
    const val REQUEST_ID_EXTRA = "requestId"
    const val OPERATION_EXTRA = "operation"
    const val SESSION_ID_EXTRA = "sessionId"
    const val OPERATION_CAUSAL_SNAPSHOT = "causal-snapshot"
    const val OPERATION_SOLID_DIAGNOSTICS_BEGIN = "solid-diagnostics-begin"
    const val OPERATION_SOLID_DIAGNOSTICS_END = "solid-diagnostics-end"
    const val RESPONSE_DIRECTORY = "solid-native-debug"
    const val MAX_SNAPSHOT_BYTES = 16_777_216
    private const val MAX_PENDING_REQUESTS = 8
    private const val ERROR_UNAVAILABLE = "E_SOLID_NATIVE_DEBUG_UNAVAILABLE"
    private const val ERROR_REQUEST = "E_SOLID_NATIVE_DEBUG_REQUEST"
    private const val ERROR_PAYLOAD = "E_SOLID_NATIVE_DEBUG_PAYLOAD"
    private const val ERROR_WRITE = "E_SOLID_NATIVE_DEBUG_WRITE"
    private val REQUEST_ID_PATTERN = Regex("^[a-f0-9]{32}$")
    private val ALLOWED_OPERATIONS =
        setOf(
            OPERATION_CAUSAL_SNAPSHOT,
            OPERATION_SOLID_DIAGNOSTICS_BEGIN,
            OPERATION_SOLID_DIAGNOSTICS_END,
        )
  }
}
