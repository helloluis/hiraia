package com.hiraia.provisioner

import android.Manifest
import android.app.WallpaperManager
import android.app.admin.DevicePolicyManager
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.IntentFilter
import android.content.Intent
import android.content.ComponentName
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.SystemClock
import android.provider.Settings
import java.io.InterruptedIOException

/**
 * Makes the phone a student's phone: removes or hides the apps [PackagePolicy] names, sets the
 * Hiraia wallpaper once, and turns on Bluetooth and location for Hiraia's Nearby classes. Every
 * step is safe to repeat, and runs at setup and again at every check-in that reaches the server, so
 * a change to the policy reaches phones already out of the box. The package policy alone also runs
 * at check-ins that cannot reach it.
 */
class DeviceSetup(
    private val context: Context,
    private val state: ProvisioningState,
    private val stopped: () -> Boolean,
) {
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = AdminReceiver.component(context)
    private val packages = context.packageManager

    /** Returns notes for the operator: only what did not go to plan. */
    fun apply(): List<String> {
        val notes = mutableListOf<String>()
        notes += applyPackagePolicy()
        setWallpaperOnce()?.let(notes::add)
        setScreenTimeoutOnce()?.let(notes::add)
        enableRadios()?.let(notes::add)
        return notes
    }

    /**
     * Removes or hides what [PackagePolicy] names. Needs no server, so check-ins run it away from the
     * warehouse too. Whether the JP1's vendor code restores an uninstalled /system/preloadapp app at
     * a reboot is untested; if it does, the app returns as a fresh, visible install, and only running
     * this again removes it. Hiding it in advance cannot work: Android keeps no hidden flag for a
     * package that is gone (PackageManagerService.setApplicationHiddenSettingAsUser).
     */
    fun applyPackagePolicy(): List<String> {
        claimHome()
        val keep = PackagePolicy.KEEP.toSet()
        for (name in PackagePolicy.KEEP) {
            if (present(name) && dpm.isApplicationHidden(admin, name)) dpm.setApplicationHidden(admin, name, false)
        }

        // One already hidden is one that would not uninstall before; hidden, it is out of the way,
        // and trying again would cost every check-in the wait below.
        val removing = PackagePolicy.UNINSTALL.filter { it !in keep && present(it) && !dpm.isApplicationHidden(admin, it) }
        for (name in removing) runCatching { PackageInstall.uninstall(context, name) }
        // Uninstalls finish in the background; give them a moment before falling back to hiding.
        val deadline = SystemClock.elapsedRealtime() + UNINSTALL_WAIT_MILLIS
        while (removing.any(::present) && SystemClock.elapsedRealtime() < deadline) {
            if (stopped()) throw InterruptedIOException("stopped while removing apps")
            Thread.sleep(1_000)
        }

        // Whatever would not uninstall is hidden, like the system apps that cannot be.
        val hiding = (PackagePolicy.UNINSTALL + PackagePolicy.HIDE).filter { it !in keep && present(it) }
        val failed = hiding.filter { !dpm.isApplicationHidden(admin, it) && !dpm.setApplicationHidden(admin, it, true) }
        return if (failed.isEmpty()) emptyList() else listOf("Could not hide ${failed.joinToString()}")
    }

    /**
     * Makes [HomeActivity] the home screen, so the Home button always lands on the tidy grid rather
     * than the stock launcher's gap-ridden pages. Persistent: no chooser, and it survives reboots.
     */
    private fun claimHome() {
        val home = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        runCatching { dpm.addPersistentPreferredActivity(admin, home, ComponentName(context, HomeActivity::class.java)) }
    }

    /**
     * Ten minutes before the screen turns off, not the stock one: at one minute, Hiraia's content
     * downloads stalled whenever the phone was set down. Set once, like the wallpaper, so a student
     * or teacher who changes it keeps their choice.
     */
    private fun setScreenTimeoutOnce(): String? {
        if (state.applied(SCREEN_TIMEOUT_SETTING) == SCREEN_TIMEOUT_MILLIS.toString()) return null
        return try {
            dpm.setSystemSetting(admin, Settings.System.SCREEN_OFF_TIMEOUT, SCREEN_TIMEOUT_MILLIS.toString())
            state.markApplied(SCREEN_TIMEOUT_SETTING, SCREEN_TIMEOUT_MILLIS.toString())
            null
        } catch (failure: RuntimeException) {
            "Could not set the screen timeout: ${failure.message}"
        }
    }

    /** Set once per wallpaper version: a student who picks another wallpaper keeps it. */
    private fun setWallpaperOnce(): String? {
        if (state.wallpaper == WALLPAPER_VERSION) return null
        return try {
            // One image for both screens. Zero means Android declined without an exception, e.g. a
            // build without wallpaper support; it is not recorded, so the next check-in tries again.
            val id = context.assets.open(WALLPAPER_ASSET).use { image ->
                WallpaperManager.getInstance(context).setStream(image, null, true,
                    WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK)
            }
            if (id == 0) return "Android would not take the wallpaper"
            state.wallpaperSet(WALLPAPER_VERSION)
            null
        } catch (failure: Exception) {
            "Could not set the wallpaper: ${failure.message}"
        }
    }

    /**
     * Hiraia's classes run over Nearby, which needs Bluetooth on; a fresh JP1 has it off, and
     * granting Hiraia the permission does not switch the radio. Location services go on too:
     * Nearby discovery on some phones will not scan without them. A device owner may do both.
     */
    private fun enableRadios(): String? {
        val problems = mutableListOf<String>()
        runCatching { dpm.setLocationEnabled(admin, true) }
        if (context.getSystemService(LocationManager::class.java)?.isLocationEnabled != true) {
            problems += "location is off"
        }
        runCatching {
            dpm.setPermissionGrantState(admin, context.packageName, Manifest.permission.BLUETOOTH_CONNECT,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
        }
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
        @Suppress("DEPRECATION", "MissingPermission") // a device owner may still switch it; we check the result
        val on = adapter != null && (adapter.isEnabled || runCatching { adapter.enable() }.getOrDefault(false))
        if (!on) problems += "Bluetooth is off"
        return if (problems.isEmpty()) null else "Turn on by hand: ${problems.joinToString(" and ")}"
    }

    /** Installed for this user, hidden or not. */
    private fun present(name: String): Boolean = try {
        packages.getApplicationInfo(name, PackageManager.MATCH_UNINSTALLED_PACKAGES).flags and
            ApplicationInfo.FLAG_INSTALLED != 0
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    companion object {
        const val WALLPAPER_ASSET = "hiraia-wallpaper.png"
        private const val SCREEN_TIMEOUT_SETTING = "screen_off_timeout"
        private const val SCREEN_TIMEOUT_MILLIS = 10 * 60_000
        /** Raise when the image changes, so phones set up with the old one take the new one. */
        const val WALLPAPER_VERSION = "2026-09-26"
        private const val UNINSTALL_WAIT_MILLIS = 30_000L
    }
}
