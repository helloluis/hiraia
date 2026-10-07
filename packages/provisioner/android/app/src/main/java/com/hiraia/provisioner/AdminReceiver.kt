package com.hiraia.provisioner

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent

class AdminReceiver : DeviceAdminReceiver() {
    /** Sent once the device is ours; also covers a setup that skipped policy compliance. */
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        ProvisioningState(context).adopt(ProvisioningState.extras(intent))
        Jobs.provision(context)
    }

    companion object {
        fun component(context: Context) = ComponentName(context, AdminReceiver::class.java)
    }
}
