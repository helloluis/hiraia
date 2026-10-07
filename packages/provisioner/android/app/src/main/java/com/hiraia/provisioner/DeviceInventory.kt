package com.hiraia.provisioner

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * The record the provisioning server keeps for a phone. Serial number, IMEIs and the Wi-Fi MAC
 * are readable only because this app is the device owner; each is left out, not faked, when
 * the phone will not give it up.
 *
 * Lint wants READ_PRIVILEGED_PHONE_STATE for the serial and IMEIs; a device owner needs only the
 * READ_PHONE_STATE it grants itself, and every read is guarded in case even that is refused.
 */
@SuppressLint("MissingPermission", "HardwareIds")
object DeviceInventory {
    /**
     * How the server tells this phone apart, chosen on the first run and kept. The serial number
     * survives a factory reset, so a phone provisioned twice keeps its Hiraia ID; setup hands it
     * over directly, and reading it needs no permission. Without one, the enrollment id at least
     * keeps retries from minting new IDs, and the server's dashboard flags the phone.
     */
    fun deviceKey(state: ProvisioningState): String = state.deviceKey {
        val serial = state.setupSerial?.takeIf(::isRealSerial) ?: readSerial()
        serial?.let { "serial:$it" } ?: "enrollment:${state.enrollment}"
    }

    fun collect(context: Context, state: ProvisioningState): JSONObject {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = AdminReceiver.component(context)
        val activity = context.getSystemService(ActivityManager::class.java)
        val memory = ActivityManager.MemoryInfo().also(activity::getMemoryInfo)
        val data = StatFs(Environment.getDataDirectory().path)
        val telephony = context.getSystemService(TelephonyManager::class.java)
        val imeis = runCatching {
            (0 until telephony.supportedModemCount).mapNotNull { slot -> telephony.getImei(slot)?.takeIf { it.isNotBlank() } }
        }.getOrDefault(emptyList()).ifEmpty { listOfNotNull(state.setupImei) }
        val dpc = context.packageManager.getPackageInfo(context.packageName, 0)

        return JSONObject()
            .put("device_key", deviceKey(state))
            // The ID this phone already wears, if any, so a server that lost it gives it back.
            .put("hiraia_id", state.hiraiaId)
            .put("id_receipt", state.receipt)
            .put("enrollment", state.enrollment)
            .put("device_owner", dpm.isDeviceOwnerApp(context.packageName))
            .put("device_name", Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME))
            .put("manufacturer", Build.MANUFACTURER)
            .put("brand", Build.BRAND)
            .put("model", Build.MODEL)
            .put("product", Build.PRODUCT)
            .put("device", Build.DEVICE)
            .put("android_version", Build.VERSION.RELEASE)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("security_patch", Build.VERSION.SECURITY_PATCH)
            .put("build_number", Build.DISPLAY)
            .put("fingerprint", Build.FINGERPRINT)
            .put("serial", state.setupSerial?.takeIf(::isRealSerial) ?: readSerial())
            .put("imei", JSONArray(imeis))
            .put("wifi_mac", runCatching { dpm.getWifiMacAddress(admin) }.getOrNull())
            // What Hiraia's memory policy reads to decide which features the phone can run.
            .put("ram_total_bytes", memory.totalMem)
            .put("ram_available_bytes", memory.availMem)
            .put("ram_threshold_bytes", memory.threshold)
            .put("low_ram_device", activity.isLowRamDevice)
            .put("storage_total_bytes", data.totalBytes)
            .put("storage_free_bytes", data.availableBytes)
            .put("dpc_version", dpc.versionName)
            .put("dpc_version_code", dpc.longVersionCode)
    }

    private fun readSerial(): String? = runCatching { Build.getSerial() }.getOrNull()?.takeIf(::isRealSerial)

    private fun isRealSerial(serial: String) =
        serial.isNotBlank() && serial != Build.UNKNOWN && serial != "0123456789ABCDEF"
}
