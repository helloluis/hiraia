package com.hiraia.localai

import android.app.ActivityManager
import android.os.Debug
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.Executors

class TalaAiSupportPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(TalaAiSupport(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
class TalaAiSupport(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  private var peakPss = 0L
  override fun getName() = "TalaAiSupport"
  @ReactMethod fun sha256(uri: String, promise: Promise) {
    executor.execute {
      try {
        val file = File(URI(uri)).canonicalFile
        require(file.path.startsWith(context.filesDir.canonicalPath + File.separator))
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { stream ->
          val buffer = ByteArray(65536)
          while (true) { val count = stream.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        }
        promise.resolve(digest.digest().joinToString("") { "%02x".format(it) })
      } catch (_: Exception) { promise.reject("HASH_FAILED", "Model verification failed") }
    }
  }
  @ReactMethod fun memory(promise: Promise) {
    try {
      val manager = context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as ActivityManager
      val info = ActivityManager.MemoryInfo(); manager.getMemoryInfo(info)
      val pss = Debug.getPss() * 1024L; peakPss = maxOf(peakPss, pss)
      promise.resolve(Arguments.createMap().apply {
        putDouble("totalBytes", info.totalMem.toDouble()); putDouble("availableBytes", info.availMem.toDouble())
        putDouble("pssBytes", pss.toDouble()); putDouble("peakPssBytes", peakPss.toDouble())
        putBoolean("lowMemory", info.lowMemory); putBoolean("lowRam", manager.isLowRamDevice)
      })
    } catch (_: Exception) { promise.reject("MEMORY_FAILED", "Memory information unavailable") }
  }
  override fun invalidate() { executor.shutdown(); super.invalidate() }
}
