package com.hiraia.provisioner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle

/**
 * Debug builds only: hands the DPC the server settings a QR code would, so a phone made device
 * owner over adb can run provisioning without a factory reset. The server's /qr page prints the
 * exact command.
 */
class DebugConfigReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val extras = PersistableBundle()
        for (key in listOf("server", "pin", "token")) extras.putString(key, intent.getStringExtra(key))
        if (!ProvisioningState(context).adopt(extras)) {
            resultData = "Refused: server must be https://, pin a 43-character base64url SHA-256, token non-empty"
            return
        }
        Jobs.provision(context)
        resultData = "Provisioning scheduled"
    }
}
