package com.hiraia.provisioner

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle

/** Setup asks what this DPC wants to be. It only ever manages the whole device. */
class ProvisioningModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val state = ProvisioningState(this)
        state.adopt(ProvisioningState.extras(intent))
        // Setup hands over the serial number here, before any permission could be granted.
        state.rememberSetupIdentity(intent.getStringExtra(DevicePolicyManager.EXTRA_PROVISIONING_SERIAL_NUMBER),
            intent.getStringExtra(DevicePolicyManager.EXTRA_PROVISIONING_IMEI))
        val mode = DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
        val allowed = intent.getIntegerArrayListExtra(DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES)
        if (allowed != null && mode !in allowed) {
            // A personally owned or work-profile setup: not something this DPC does.
            setResult(RESULT_CANCELED)
        } else {
            // Setup ignores "skip education screens" when it comes from a QR code and only takes it
            // from this reply. Without it every phone stops at a Next button before this DPC runs.
            // Keep-screen-on: read from this reply on Android 13, deprecated from 14, and an unknown
            // extra that older setups ignore.
            @Suppress("DEPRECATION")
            @android.annotation.SuppressLint("InlinedApi")
            setResult(RESULT_OK, Intent()
                .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, mode)
                .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_SKIP_EDUCATION_SCREENS, true)
                .putExtra(DevicePolicyManager.EXTRA_PROVISIONING_KEEP_SCREEN_ON, true))
        }
        finish()
    }
}
