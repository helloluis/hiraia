package com.hiraia.androidprobe

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Debug
import android.net.Uri
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

class ProbePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ProbeModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class ProbeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  override fun getName() = "AndroidProbe"

  @ReactMethod fun deviceInfo(promise: Promise) {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo()
    am.getMemoryInfo(info)
    promise.resolve(Arguments.createMap().apply {
      putInt("api", Build.VERSION.SDK_INT)
      putString("android", Build.VERSION.RELEASE)
      putString("manufacturer", Build.MANUFACTURER)
      putString("model", Build.MODEL)
      putString("hardware", Build.HARDWARE)
      putString("fingerprint", Build.FINGERPRINT)
      putString("abis", Build.SUPPORTED_ABIS.joinToString(","))
      putBoolean("lowRamDevice", am.isLowRamDevice)
      putDouble("totalRamBytes", info.totalMem.toDouble())
      putDouble("availableRamBytes", info.availMem.toDouble())
      putInt("memoryClassMB", am.memoryClass)
      putInt("processPssKB", Debug.getPss().toInt())
      putDouble("freeStorageBytes", context.filesDir.usableSpace.toDouble())
    })
  }

  // Stream on a background executor: hashing 1.27 GB must not allocate a giant
  // JS string/buffer or freeze either the UI or the RN native-module queue.
  @ReactMethod fun sha256(path: String, promise: Promise) {
    executor.execute {
      try {
        val uri = Uri.parse(path)
        require(uri.scheme == null || uri.scheme == "file") { "Expected a local file URI: $path" }
        val file = File(if (uri.scheme == "file") requireNotNull(uri.path) else path).canonicalFile
        require(file.toPath().startsWith(context.filesDir.canonicalFile.toPath())) {
          "Model file is outside app files: ${file.path}; expected ${context.filesDir.canonicalPath}"
        }
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
          val buffer = ByteArray(128 * 1024)
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            digest.update(buffer, 0, n)
          }
        }
        promise.resolve(digest.digest().joinToString("") { "%02x".format(it) })
      } catch (e: Exception) { promise.reject("HASH_FAILED", e) }
    }
  }

  override fun invalidate() { executor.shutdownNow(); super.invalidate() }
}
