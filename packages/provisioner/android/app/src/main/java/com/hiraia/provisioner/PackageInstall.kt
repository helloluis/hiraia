package com.hiraia.provisioner

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import java.io.File

/**
 * Installs an APK without asking anyone, which a device owner may do: this DPC's own updates,
 * and Hiraia. Android still insists an update is signed with the same key as what it replaces;
 * a first install of Hiraia is checked against Hiraia's key by [HiraiaInstall] before it gets here.
 */
object PackageInstall {
    fun install(context: Context, apk: File, packageName: String) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(packageName)
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            setInstallReason(PackageManager.INSTALL_REASON_POLICY)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("package.apk", 0, apk.length()).use { output ->
                apk.inputStream().use { it.copyTo(output, 256 * 1024) }
                session.fsync(output)
            }
            // Mutable: the installer fills in the result. Explicit, so nothing else can receive it.
            val result = PendingIntent.getBroadcast(context, id,
                Intent(context, InstallResultReceiver::class.java).putExtra(EXTRA_TARGET, packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            session.commit(result.intentSender)
        }
    }

    /** Removes [packageName] without asking anyone, which a device owner may do. */
    fun uninstall(context: Context, packageName: String) {
        val result = PendingIntent.getBroadcast(context, packageName.hashCode(),
            Intent(context, InstallResultReceiver::class.java).putExtra(EXTRA_TARGET, packageName).putExtra(EXTRA_UNINSTALL, true),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        context.packageManager.packageInstaller.uninstall(packageName, result.intentSender)
    }

    const val EXTRA_TARGET = "com.hiraia.provisioner.TARGET"
    const val EXTRA_UNINSTALL = "com.hiraia.provisioner.UNINSTALL"
}

/**
 * Hears how an install went. When this DPC replaces itself the process dies before it can hear
 * anything, and the new build carries on from MY_PACKAGE_REPLACED; so for this DPC it only ever
 * records a failure. For Hiraia it records the failure where the waiting install step sees it.
 */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        // Uninstalls are checked by what is left afterwards: an app that stays is hidden instead.
        if (status == PackageInstaller.STATUS_SUCCESS || intent.getBooleanExtra(PackageInstall.EXTRA_UNINSTALL, false)) return
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $status"
        val target = intent.getStringExtra(PackageInstall.EXTRA_TARGET) ?: context.packageName
        val state = ProvisioningState(context)
        if (target == context.packageName) {
            state.note("Updating Hiraia Setup failed: $message")
        } else {
            state.installFailed(target, message)
        }
    }
}
