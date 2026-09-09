package com.hiraia.app

import android.app.ActivityManager
import android.os.StatFs
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

class HiraiaMemoryPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(HiraiaMemoryModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class HiraiaMemoryModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "HiraiaMemory"

  @ReactMethod
  fun snapshot(promise: Promise) {
    try {
      val manager = context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as ActivityManager
      val info = ActivityManager.MemoryInfo()
      manager.getMemoryInfo(info)
      promise.resolve(Arguments.createMap().apply {
        putDouble("totalBytes", info.totalMem.toDouble())
        putDouble("availableBytes", info.availMem.toDouble())
        putDouble("thresholdBytes", info.threshold.toDouble())
        putDouble("freeStorageBytes", StatFs(context.filesDir.absolutePath).availableBytes.toDouble())
        putBoolean("lowMemory", info.lowMemory)
        putBoolean("lowRamDevice", manager.isLowRamDevice)
      })
    } catch (e: Exception) {
      promise.reject("MEMORY_CHECK_FAILED", e)
    }
  }
}
