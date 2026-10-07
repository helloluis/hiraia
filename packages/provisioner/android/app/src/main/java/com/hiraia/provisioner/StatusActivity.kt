package com.hiraia.provisioner

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.SharedPreferences
import android.graphics.Typeface
import android.os.Bundle
import android.text.format.DateUtils
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** What the operator sees on the phone: its Hiraia ID, and whether setup finished. */
class StatusActivity : Activity() {
    private lateinit var state: ProvisioningState
    private lateinit var hiraiaId: TextView
    private lateinit var status: TextView
    private lateinit var details: TextView
    private lateinit var retry: Button
    private lateinit var checkIn: Button
    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        state = ProvisioningState(this)
        val padding = (24 * resources.displayMetrics.density).toInt()
        hiraiaId = TextView(this).apply { textSize = 40f; typeface = Typeface.DEFAULT_BOLD }
        status = TextView(this).apply { textSize = 20f }
        details = TextView(this).apply { textSize = 14f; setPadding(0, padding / 2, 0, padding / 2) }
        retry = Button(this).apply {
            text = "Try again"
            setOnClickListener { Jobs.provisionNow(this@StatusActivity) }
        }
        checkIn = Button(this).apply {
            text = "Check for an update"
            setOnClickListener { Jobs.checkInNow(this@StatusActivity) }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(padding, padding * 3, padding, padding)
            addView(TextView(context).apply { text = getString(R.string.app_name); textSize = 16f })
            addView(hiraiaId)
            addView(status)
            addView(details)
            addView(retry)
            addView(checkIn)
        })
    }

    override fun onResume() {
        super.onResume()
        state.listen(listener)
        render()
    }

    override fun onPause() {
        state.unlisten(listener)
        super.onPause()
    }

    private fun render() {
        val owner = getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(packageName)
        hiraiaId.text = state.hiraiaId ?: "No ID yet"
        status.text = when (state.status) {
            ProvisioningState.Status.PENDING -> "Not started"
            ProvisioningState.Status.WAITING_FOR_SERVER -> "Waiting for the provisioning server"
            ProvisioningState.Status.REGISTERED -> "Registered, finishing"
            ProvisioningState.Status.INSTALLING -> "Installing Hiraia"
            ProvisioningState.Status.COMPLETE -> "Set up"
            ProvisioningState.Status.ERROR -> "Stopped"
        }
        val version = packageManager.getPackageInfo(packageName, 0)
        val checked = state.lastCheckIn.takeIf { it > 0 }?.let {
            "Last reached the server ${DateUtils.getRelativeTimeSpanString(it)}"
        }
        details.text = listOfNotNull(
            state.detail.ifEmpty { null },
            "Device owner: ${if (owner) "yes" else "no"}",
            "Server: ${state.server ?: "none"}",
            checked,
            "Hiraia Setup ${version.versionName} (${version.longVersionCode})"
        ).joinToString("\n")
        retry.visibility = if (owner && state.status != ProvisioningState.Status.COMPLETE) View.VISIBLE else View.GONE
        checkIn.visibility = if (owner && state.status == ProvisioningState.Status.COMPLETE) View.VISIBLE else View.GONE
    }
}
