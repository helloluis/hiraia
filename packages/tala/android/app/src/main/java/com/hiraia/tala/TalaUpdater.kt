package com.hiraia.tala

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Sideload updates: a small foreground check, explicit download, verified system installer. */
class TalaUpdater(private val activity: Activity, private val changed: () -> Unit) {
    data class Release(val version: Long, val name: String, val url: String, val bytes: Long, val sha256: String)
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences("tala-updates", 0)
    private val installed = activity.packageManager.getPackageInfo(activity.packageName, 0).longVersionCode
    private var release: Release? = null
    private var checking = false
    private var downloading = false
    private var foreground = false
    @Volatile private var closed = false
    private var percent = 0
    private var failed = false
    init {
        try {
            release = prefs.getString("release", null)?.let { parse(JSONObject(it)) }?.takeIf { it.version > installed }
        } catch (_: Exception) { /* A damaged cached notice never blocks launch. */ }
    }
    private val tick = object : Runnable {
        override fun run() { check(); if (!closed) handler.postDelayed(this, 15 * 60 * 1000L) }
    }
    val banner: String?
        get() {
            val r = release ?: return null
            if (!downloading && prefs.getLong("snoozeVersion", 0) == r.version && prefs.getLong("snoozeUntil", 0) > System.currentTimeMillis()) return null
            return if (downloading) "Downloading Tala update · $percent%" else if (failed) "Tala update paused · Tap to retry" else "Tala ${r.name} available · Tap to update"
        }
    fun resume() { foreground = true; handler.removeCallbacks(tick); handler.postDelayed(tick, 2500) }
    fun pause() { foreground = false; handler.removeCallbacks(tick) }
    fun close() { closed = true; pause(); worker.shutdownNow() }
    private fun ui(action: () -> Unit) { handler.post { if (!closed && !activity.isFinishing) action() } }
    private fun connection(url: String): HttpURLConnection {
        require(url.startsWith("https://"))
        return (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000; readTimeout = 15000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json, application/octet-stream")
        }
    }
    fun check(manual: Boolean = false) {
        if (closed || checking || downloading) return
        if (!manual && System.currentTimeMillis() < prefs.getLong("nextCheck", 0)) return
        checking = true
        worker.execute {
            try {
                val conn = connection("https://hiraia.org/api/app/manifest?app=tala")
                val body = try {
                    require(conn.responseCode == 200)
                    conn.inputStream.use { input ->
                        val out = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            val n = input.read(buffer); if (n < 0) break
                            require(out.size() + n <= 1_000_000)
                            out.write(buffer, 0, n)
                        }
                        JSONObject(out.toString("UTF-8"))
                    }
                } finally { conn.disconnect() }
                require(body.getInt("schema") == 1 && body.getString("applicationId") == activity.packageName && body.has("app"))
                val app = if (body.isNull("app")) null else body.getJSONObject("app")
                val found = app?.let { parse(it) }?.takeIf { it.version > installed }
                prefs.edit().putLong("nextCheck", System.currentTimeMillis() + 6*60*60*1000L)
                    .putString("release", if (found != null) app.toString() else null).apply()
                ui {
                    release = found; checking = false
                    if (manual) prefs.edit().remove("snoozeVersion").remove("snoozeUntil").apply()
                    changed()
                    if (manual) { if (found != null) show() else toast("Tala is up to date.") }
                }
            } catch (_: Exception) {
                prefs.edit().putLong("nextCheck", System.currentTimeMillis() + 15*60*1000L).apply()
                ui { checking = false; if (manual) toast("Could not check for updates. Connect to the internet and try again.") }
            }
        }
    }
    fun show() {
        if (!foreground) return
        val r = release ?: return check(true)
        if (downloading) return
        AlertDialog.Builder(activity).setTitle("Update Tala to ${r.name}")
            .setMessage("Download ${(r.bytes + 1048575) / 1048576} MB. Your classes and student activity stay on this phone. Android will ask you to confirm installation.")
            .setPositiveButton("Download / Install") { _, _ -> download(r) }
            .setNegativeButton("Later") { _, _ ->
                prefs.edit().putLong("snoozeVersion", r.version).putLong("snoozeUntil", System.currentTimeMillis()+7*86400000L).apply(); changed()
            }.show()
    }
    private fun hash(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream -> val buffer = ByteArray(65536); while (true) { val n = stream.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
    private fun download(r: Release) {
        if (downloading || closed) return
        downloading = true; failed = false; percent = 0; changed()
        worker.execute {
            val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
            val file = File(dir, "tala-${r.version}.apk")
            val partial = File(dir, "tala-${r.version}.part")
            try {
                if (file.length() != r.bytes || hash(file) != r.sha256) {
                    require(dir.usableSpace > r.bytes + 20_000_000) { "Not enough storage" }
                    file.delete()
                    val conn = connection(r.url)
                    try {
                        require(conn.responseCode == 200)
                        conn.inputStream.use { input -> partial.outputStream().use { output ->
                            val buffer = ByteArray(65536); var total = 0L; var last = -1
                            while (true) {
                                kotlin.check(!closed && !Thread.currentThread().isInterrupted)
                                val n = input.read(buffer); if (n < 0) break
                                total += n; require(total <= r.bytes); output.write(buffer, 0, n)
                                val pct = (total*100/r.bytes).toInt()
                                if (pct != last) { last = pct; ui { percent = pct; changed() } }
                            }
                            require(total == r.bytes)
                        } }
                    } finally { conn.disconnect() }
                    require(hash(partial) == r.sha256) { "Checksum mismatch" }
                    require(partial.renameTo(file))
                }
                // Refuse wrong app, downgrade, or another signing identity before opening installer.
                val pm = activity.packageManager
                val archive = pm.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: error("Invalid APK")
                val current = pm.getPackageInfo(activity.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                require(archive.packageName == activity.packageName && archive.longVersionCode == r.version && r.version > installed)
                val signer = archive.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
                require(!signer.isNullOrEmpty() && signer == current.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet())
                ui {
                    downloading = false; changed()
                    // A download may finish after the teacher leaves Tala. Keep the
                    // verified file and offer installation when they return and tap.
                    if (!foreground) return@ui
                    try {
                        if (!pm.canRequestPackageInstalls()) {
                            toast("Allow Tala to install updates, then tap the update banner again.")
                            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                        } else {
                            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
                            activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                        }
                    } catch (_: Exception) { failed = true; changed(); toast("Could not open the Android installer. Try again from the update banner.") }
                }
            } catch (_: Exception) {
                ui { downloading = false; failed = true; changed(); toast("Update paused. Check internet and free storage, then retry. Your current Tala still works.") }
            } finally { partial.delete() }
        }
    }
    private fun toast(message: String) = Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
    companion object {
        fun parse(app: JSONObject): Release {
            val url = app.getString("url"); val sha = app.getString("sha256")
            val version = app.getLong("versionCode"); val bytes = app.getLong("bytes")
            require(app.get("versionCode") is Number && app.getDouble("versionCode") == version.toDouble())
            require(app.get("bytes") is Number && app.getDouble("bytes") == bytes.toDouble())
            require(version > 0 && bytes in 1..200_000_000 && sha.matches(Regex("[a-f0-9]{64}")))
            require(url.matches(Regex("https://assets\\.hiraia\\.org/models/[A-Za-z0-9._-]+\\.apk")))
            return Release(version, app.getString("versionName").take(60), url, bytes, sha)
        }
    }
}
