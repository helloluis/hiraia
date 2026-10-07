package com.hiraia.provisioner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/**
 * Debug builds only: applies the device setup (package policy, home screen, wallpaper, radios) on a
 * phone made device owner over adb, without a provisioning server.
 *
 *   adb shell am broadcast -n com.hiraia.provisioner/.DebugSetupReceiver [--es mirror http://<lan-ip>:8080/mirror/models]
 */
class DebugSetupReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val result = goAsync()
        // --es mirror <url>: also hand Hiraia a content mirror, as the server's offer would.
        val mirror = intent.getStringExtra("mirror")
        thread(name = "debug-setup") {
            try {
                if (mirror != null) {
                    HiraiaInstall(context.applicationContext, ProvisioningState(context), stopped = { false }).configure(mirror)
                }
                val notes = DeviceSetup(context.applicationContext, ProvisioningState(context), stopped = { false }).apply()
                result.resultData = if (notes.isEmpty()) "Applied" else notes.joinToString("; ")
            } finally {
                result.finish()
            }
        }
    }
}
