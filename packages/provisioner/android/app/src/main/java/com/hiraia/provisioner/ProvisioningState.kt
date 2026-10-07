package com.hiraia.provisioner

import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.PersistableBundle
import android.util.Base64
import java.util.UUID

/**
 * What this phone knows about its own provisioning: the server the QR code named, who it is to
 * that server, and how far it has got. Kept in plain preferences: the work resumes across reboots.
 *
 * Every write commits synchronously: a step must be on disk before the job that took it can
 * finish, or a process killed in between would lose the secret the server just issued.
 */
@SuppressLint("ApplySharedPref")
class ProvisioningState(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("provisioning", Context.MODE_PRIVATE)

    /** Where the provisioning server's API was last reached, e.g. https://192.168.68.62:8443. */
    val server: String? get() = prefs.getString(SERVER, null)

    /** SHA-256 of the server's public key. The QR code is the only trust anchor. */
    val pin: ByteArray? get() = prefs.getString(PIN, null)?.let(::decodePin)

    /** The QR code's registration token. It only lets this phone register. */
    val token: String? get() = prefs.getString(TOKEN, null)

    /** This phone's own secret, issued at registration; everything after that uses it. */
    val secret: String? get() = prefs.getString(SECRET, null)

    /** The server's signed proof that it gave this phone [hiraiaId], shown if it must register again. */
    val receipt: String? get() = prefs.getString(RECEIPT, null)

    val hiraiaId: String? get() = prefs.getString(HIRAIA_ID, null)
    val status: Status get() = prefs.getString(STATUS, null)?.let(Status::valueOf) ?: Status.PENDING
    val detail: String get() = prefs.getString(DETAIL, "") ?: ""
    val lastCheckIn: Long get() = prefs.getLong(LAST_CHECK_IN, 0)

    /** A boot/manual check or an authenticated update offer gets bounded transient retries. */
    fun beginCheckInRetryWindow(now: Long = System.currentTimeMillis()) {
        prefs.edit().putLong(CHECK_IN_RETRY_UNTIL, now + CHECK_IN_RETRY_WINDOW_MS).commit()
    }

    fun retryCheckIn(now: Long = System.currentTimeMillis()): Boolean =
        withinCheckInRetryWindow(prefs.getLong(CHECK_IN_RETRY_UNTIL, 0), now)

    fun clearCheckInRetryWindow() {
        prefs.edit().remove(CHECK_IN_RETRY_UNTIL).commit()
    }

    /** The serial number setup handed over, which needs no permission to read. */
    val setupSerial: String? get() = prefs.getString(SETUP_SERIAL, null)
    val setupImei: String? get() = prefs.getString(SETUP_IMEI, null)

    /** How the server tells this phone apart; chosen once so it never changes under the phone. */
    val deviceKey: String? get() = prefs.getString(DEVICE_KEY, null)

    /** Identifies this enrollment when the serial number cannot be read. */
    val enrollment: String
        get() = prefs.getString(ENROLLMENT, null) ?: synchronized(ProvisioningState::class.java) {
            prefs.getString(ENROLLMENT, null)
                ?: UUID.randomUUID().toString().also { prefs.edit().putString(ENROLLMENT, it).commit() }
        }

    val configured: Boolean get() = server != null && pin != null && token != null

    /**
     * Takes the server settings out of the QR code's admin extras, whichever step delivers them
     * first. Settings that could never work (a pin that is not a SHA-256, say) are not taken.
     */
    fun adopt(extras: PersistableBundle?): Boolean {
        val server = extras?.getString(SERVER)?.trimEnd('/') ?: return false
        val pin = extras.getString(PIN) ?: return false
        val token = extras.getString(TOKEN) ?: return false
        if (!server.startsWith("https://") || decodePin(pin) == null || token.isBlank()) return false
        return prefs.edit().putString(SERVER, server).putString(PIN, pin).putString(TOKEN, token).commit()
    }

    fun rememberSetupIdentity(serial: String?, imei: String?) {
        prefs.edit().apply {
            if (!serial.isNullOrBlank()) putString(SETUP_SERIAL, serial)
            if (!imei.isNullOrBlank()) putString(SETUP_IMEI, imei)
        }.commit()
    }

    fun deviceKey(choose: () -> String): String = deviceKey ?: synchronized(ProvisioningState::class.java) {
        deviceKey ?: choose().also { prefs.edit().putString(DEVICE_KEY, it).commit() }
    }

    /** The server answered from a new address; the pin already proved it is the same server. */
    fun moveServer(server: String) {
        prefs.edit().putString(SERVER, server).commit()
    }

    fun registered(hiraiaId: String, secret: String, receipt: String) {
        prefs.edit().putString(HIRAIA_ID, hiraiaId).putString(SECRET, secret).putString(RECEIPT, receipt).commit()
    }

    /** The server no longer knows this phone's secret. The ID is kept: the phone claims it again. */
    fun forgetSecret() {
        prefs.edit().remove(SECRET).commit()
    }

    fun record(status: Status, detail: String = "") {
        prefs.edit().putString(STATUS, status.name).putString(DETAIL, detail).commit()
    }

    fun note(detail: String) {
        prefs.edit().putString(DETAIL, detail).commit()
    }

    /** The value a set-once setting was last given by this DPC, or null if it never set it. */
    fun applied(setting: String): String? = prefs.getString(APPLIED + setting, null)

    fun markApplied(setting: String, value: String) {
        prefs.edit().putString(APPLIED + setting, value).commit()
    }

    /** The wallpaper version this DPC last set, so it is set once and a student's own choice stays. */
    val wallpaper: String? get() = prefs.getString(WALLPAPER, null)

    fun wallpaperSet(version: String) {
        prefs.edit().putString(WALLPAPER, version).commit()
    }

    /** Why the last install of [target] failed, as the installer said; null when it has not failed. */
    fun installFailure(target: String): String? = prefs.getString(INSTALL_FAILURE + target, null)

    fun installFailed(target: String, message: String) {
        prefs.edit().putString(INSTALL_FAILURE + target, message).commit()
    }

    fun clearInstallFailure(target: String) {
        prefs.edit().remove(INSTALL_FAILURE + target).commit()
    }

    /**
     * How many times this DPC's own update to [version] has been handed to Android, so an update
     * Android keeps rejecting is not downloaded forever (see Provisioner.wantsDpcUpdate).
     */
    fun dpcUpdateTries(version: Long): Int = prefs.getInt(DPC_UPDATE_TRIES + version, 0)

    fun dpcUpdateTried(version: Long) {
        prefs.edit().putInt(DPC_UPDATE_TRIES + version, dpcUpdateTries(version) + 1).commit()
    }

    /** A check-in went through: whatever went wrong before is over, so its note goes too. */
    fun checkedIn(at: Long) {
        prefs.edit().putLong(LAST_CHECK_IN, at).putString(DETAIL, "").commit()
    }

    /** Preferences hold listeners weakly: the caller keeps [listener] referenced while it listens. */
    fun listen(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        prefs.registerOnSharedPreferenceChangeListener(listener)

    fun unlisten(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        prefs.unregisterOnSharedPreferenceChangeListener(listener)

    enum class Status { PENDING, WAITING_FOR_SERVER, REGISTERED, INSTALLING, COMPLETE, ERROR }

    companion object {
        private const val SERVER = "server"
        private const val PIN = "pin"
        private const val TOKEN = "token"
        private const val SECRET = "secret"
        private const val RECEIPT = "receipt"
        private const val HIRAIA_ID = "hiraia_id"
        private const val STATUS = "status"
        private const val DETAIL = "detail"
        private const val LAST_CHECK_IN = "last_check_in"
        private const val CHECK_IN_RETRY_UNTIL = "check_in_retry_until"
        private const val SETUP_SERIAL = "setup_serial"
        private const val SETUP_IMEI = "setup_imei"
        private const val DEVICE_KEY = "device_key"
        private const val ENROLLMENT = "enrollment"
        private const val INSTALL_FAILURE = "install_failure:"
        private const val DPC_UPDATE_TRIES = "dpc_update_tries:"
        private const val WALLPAPER = "wallpaper"
        private const val APPLIED = "applied:"

        /** The admin extras setup passes along with every provisioning intent. */
        @Suppress("DEPRECATION")
        fun extras(intent: Intent?): PersistableBundle? =
            intent?.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)

        /** A pin is exactly 32 bytes of base64url. Anything else is refused, never half-decoded. */
        fun decodePin(pin: String): ByteArray? {
            if (!pin.matches(Regex("[A-Za-z0-9_-]{43}"))) return null
            return runCatching { Base64.decode(pin, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) }
                .getOrNull()?.takeIf { it.size == 32 }
        }
    }
}
