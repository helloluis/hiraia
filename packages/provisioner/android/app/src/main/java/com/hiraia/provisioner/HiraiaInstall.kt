package com.hiraia.provisioner

import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import android.os.Bundle
import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.security.MessageDigest

/**
 * Puts Hiraia on the phone from the provisioning server, and sets it up for the classroom.
 *
 * The server only delivers bytes; it is not what makes them trustworthy. Before installing, the
 * APK must be exactly the file offered (size and SHA-256), must be Hiraia's package at the offered
 * version, and must be signed with Hiraia's release key, which is fixed here and nowhere else.
 * A laptop that was tampered with, or anything posing as it, can hand over a file, but not one
 * that passes. After the first install Android itself refuses any update not signed the same way.
 */
class HiraiaInstall(
    private val context: Context,
    private val state: ProvisioningState,
    private val stopped: () -> Boolean,
) {
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = AdminReceiver.component(context)
    private val packages = context.packageManager

    /** Refused for good: asking the same server again will not change the answer. */
    class Refused(message: String) : Exception(message)

    fun installedVersion(): Long? = try {
        packages.getPackageInfo(PACKAGE, 0).longVersionCode
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }

    /**
     * Brings Hiraia up to the version in [offer]. Throws IOException when it should simply be
     * tried again later (the download stopped, the install is still running), [Refused] when the
     * offered file can never be installed.
     */
    fun ensure(offer: JSONObject, download: (File, Long, (Long) -> Unit) -> Unit, progress: (String) -> Unit) {
        if (offer.getString("package") != PACKAGE) throw Refused("The server offered ${offer.getString("package")}, not Hiraia")
        val versionCode = offer.getLong("version_code")
        val sha256 = offer.getString("sha256").lowercase()
        val size = offer.getLong("size")
        if (!sha256.matches(Regex("[0-9a-f]{64}")) || size <= 0) throw Refused("The server's Hiraia offer is malformed")
        if ((installedVersion() ?: 0) >= versionCode) return

        val folder = File(context.filesDir, "hiraia").apply { mkdirs() }
        // Only the offered file is kept; an older offer's partial download is dead weight.
        folder.listFiles()?.filter { !it.name.startsWith(sha256) }?.forEach { it.delete() }
        val apk = File(folder, "$sha256.apk")
        if (!apk.exists()) {
            val partial = File(folder, "$sha256.part")
            var reported = -1
            download(partial, size) { written ->
                val percent = (written * 100 / size).toInt()
                if (percent / 10 != reported / 10) {
                    reported = percent
                    progress("Downloading Hiraia $percent%")
                }
            }
            if (digest(partial) != sha256) {
                partial.delete()
                throw IOException("Hiraia arrived damaged; downloading it again")
            }
            if (!partial.renameTo(apk)) throw IOException("Could not keep the downloaded Hiraia")
        }
        verify(apk, versionCode)

        if (stopped()) throw InterruptedIOException("stopped before installing Hiraia")
        progress("Installing Hiraia")
        state.clearInstallFailure(PACKAGE)
        PackageInstall.install(context, apk, PACKAGE)
        val deadline = SystemClock.elapsedRealtime() + INSTALL_WAIT_MILLIS
        while (installedVersion() != versionCode) {
            state.installFailure(PACKAGE)?.let { throw Refused("Android would not install Hiraia: $it") }
            if (stopped()) throw InterruptedIOException("stopped while Hiraia was installing")
            if (SystemClock.elapsedRealtime() > deadline) throw IOException("Hiraia is still installing")
            Thread.sleep(2_000)
        }
        apk.delete()
    }

    /**
     * Grants Hiraia every runtime permission it asks for, so no camera, Nearby or location prompt
     * interrupts a student joining a class, and hands it the mirror to download its content from.
     * Returns the permissions Android would not grant, for the operator to see.
     */
    fun configure(mirror: String?): List<String> {
        @Suppress("DEPRECATION")
        val requested = packages.getPackageInfo(PACKAGE, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
        val refused = mutableListOf<String>()
        for (permission in requested) {
            val info = runCatching { packages.getPermissionInfo(permission, 0) }.getOrNull() ?: continue
            if (info.protection != PermissionInfo.PROTECTION_DANGEROUS) continue
            val granted = try {
                dpm.setPermissionGrantState(admin, PACKAGE, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
            } catch (failure: RuntimeException) {
                if (failure.cause is InterruptedException) throw InterruptedIOException("stopped while granting")
                false
            }
            if (!granted) refused += permission.substringAfterLast('.')
        }

        // Hiraia reads "assetMirror" from its managed configuration, which only a device owner can
        // set; it checks the address itself and verifies every file against fingerprints in its APK.
        val wanted = Bundle().apply { if (mirror != null && mirror.length <= 200) putString(MIRROR_KEY, mirror) }
        val current = dpm.getApplicationRestrictions(admin, PACKAGE)
        if (current.getString(MIRROR_KEY) != wanted.getString(MIRROR_KEY) || current.size() != wanted.size()) {
            dpm.setApplicationRestrictions(admin, PACKAGE, wanted)
        }
        return refused
    }

    /** The finished file must be Hiraia, at the offered version, signed with Hiraia's release key. */
    @SuppressLint("PackageManagerGetSignatures") // the signer is read from signingInfo, never from signatures
    private fun verify(apk: File, versionCode: Long) {
        // Two independent readings of the signer, and both must name Hiraia's key:
        //  - Android's own verifier, the one the installer runs. Android 13's getPackageArchiveInfo
        //    only collects (and verifies) certificates when GET_SIGNATURES is among the flags
        //    (android13-release PackageManager.getPackageArchiveInfo); GET_SIGNING_CERTIFICATES
        //    alone returns no signing info there, which is what the JP1 showed. If it still yields
        //    nothing, the installer's identical check will refuse the file anyway.
        //  - ApkSigners, which requires every scheme present to name Hiraia, whichever Android picks.
        @Suppress("DEPRECATION")
        val verified = packages.getPackageArchiveInfo(apk.path,
            PackageManager.GET_SIGNATURES or PackageManager.GET_SIGNING_CERTIFICATES)
        @Suppress("DEPRECATION")
        val info = verified ?: packages.getPackageArchiveInfo(apk.path, 0)
        if (info == null) {
            apk.delete()
            throw IOException("The downloaded Hiraia is not a readable APK; downloading it again")
        }
        val androidSigners = verified?.signingInfo?.apkContentsSigners.orEmpty().map { sha256Hex(it.toByteArray()) }
        val signers = runCatching { ApkSigners.certificates(apk).map(::sha256Hex) }
            .getOrElse { return refuse(apk, "its signature block is unreadable (${it.message})") }
        val problem = when {
            info.packageName != PACKAGE -> "it is ${info.packageName}, not Hiraia"
            info.longVersionCode != versionCode -> "it is version ${info.longVersionCode}, not the offered $versionCode"
            signers.isEmpty() -> "it carries no v2 or v3 signature"
            (signers + androidSigners).any { it != SIGNER } ->
                "it is not signed with Hiraia's release key (signed by ${(signers + androidSigners).distinct().joinToString { it.take(8) }})"
            else -> null
        }
        if (problem != null) refuse(apk, problem)
    }

    private fun refuse(apk: File, problem: String): Nothing {
        apk.delete()
        throw Refused("Refused to install the offered Hiraia: $problem")
    }

    private fun digest(file: File): String {
        val sha = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(256 * 1024)
            while (true) {
                if (stopped()) throw InterruptedIOException("stopped while checking Hiraia")
                val count = input.read(buffer)
                if (count < 0) break
                sha.update(buffer, 0, count)
            }
        }
        return toHex(sha.digest())
    }

    private fun sha256Hex(bytes: ByteArray) = toHex(MessageDigest.getInstance("SHA-256").digest(bytes))

    private fun toHex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    companion object {
        const val PACKAGE = "com.hiraia.app"
        const val MIRROR_KEY = "assetMirror"
        /** SHA-256 of Hiraia's release signing certificate (docs/RELEASE-0.4.24-TALA-0.4.4.md). */
        const val SIGNER = "40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35"
        private const val INSTALL_WAIT_MILLIS = 5 * 60_000L
    }
}
