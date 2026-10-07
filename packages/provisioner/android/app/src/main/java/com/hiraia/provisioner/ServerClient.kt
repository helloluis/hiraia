package com.hiraia.provisioner

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Talks to the provisioning server on the laptop. The server's certificate is self-signed, and
 * the QR code carries the SHA-256 of its public key: that pin, not any certificate authority, is
 * what makes the connection trustworthy, so a stranger on the same Wi-Fi can neither read a
 * phone's inventory nor pose as the server.
 */
class ServerClient(private val context: Context, val server: String, pin: ByteArray) {
    private val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(PinnedTrust(pin)), null) }

    /** How a request proves who sent it. */
    class Auth private constructor(val headers: Map<String, String>) {
        companion object {
            fun token(token: String) = Auth(mapOf("Authorization" to "Bearer $token"))
            fun device(hiraiaId: String, secret: String) =
                Auth(mapOf("Authorization" to "Bearer $secret", "X-Hiraia-Id" to hiraiaId))
        }
    }

    /** A reply the server gave on purpose; asking again will not change it. */
    class Refused(val code: Int, message: String) : IOException(message)

    fun post(path: String, body: JSONObject, auth: Auth): JSONObject {
        val connection = open(path, auth)
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            val bytes = body.toString().toByteArray()
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            return JSONObject(read(connection, path))
        } finally {
            connection.disconnect()
        }
    }

    /** Downloads [path] to [destination], keeping it only if it is exactly the file expected. */
    fun download(path: String, auth: Auth, destination: File, sha256: String, size: Long) {
        val connection = open(path, auth)
        try {
            if (connection.responseCode != 200) read(connection, path)
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            connection.inputStream.use { input ->
                destination.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > size) throw IOException("$path is larger than the server said")
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (total != size || actual != sha256) {
                destination.delete()
                throw IOException("$path arrived damaged (sha256 $actual, $total bytes)")
            }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Brings [partial] up to [size] bytes of [path], continuing from whatever it already holds:
     * a 437 MB APK must survive a dropped Wi-Fi, a stopped job or a reboot without starting over.
     * It only moves bytes; the caller checks the finished file before trusting it.
     */
    fun resume(path: String, auth: Auth, partial: File, size: Long, stopped: () -> Boolean, progress: (Long) -> Unit) {
        if (partial.length() > size) partial.delete()
        if (partial.length() == size) return
        val connection = open(path, auth)
        try {
            val offset = partial.length()
            if (offset > 0) connection.setRequestProperty("Range", "bytes=$offset-")
            connection.readTimeout = 60_000
            val code = connection.responseCode
            val append = when {
                code == 206 && connection.getHeaderField("Content-Range")?.startsWith("bytes $offset-") == true -> true
                code == 200 -> false // a whole body: start the file again rather than append to it
                else -> { read(connection, path); throw IOException("$path answered $code to a resume") }
            }
            var written = if (append) offset else 0L
            connection.inputStream.use { input ->
                java.io.FileOutputStream(partial, append).use { output ->
                    val buffer = ByteArray(256 * 1024)
                    while (true) {
                        if (stopped()) throw java.io.InterruptedIOException("stopped while downloading $path")
                        val count = input.read(buffer)
                        if (count < 0) break
                        written += count
                        if (written > size) throw IOException("$path is larger than the server said")
                        output.write(buffer, 0, count)
                        progress(written)
                    }
                }
            }
            if (written != size) throw IOException("$path ended early at $written of $size bytes")
        } finally {
            connection.disconnect()
        }
    }

    private fun open(path: String, auth: Auth): HttpsURLConnection {
        // The server is on the Wi-Fi's LAN. A phone that also has mobile data may route through
        // that by default when the Wi-Fi has no internet, so requests go out over the Wi-Fi itself.
        val network = wifi() ?: throw IOException("Not connected to Wi-Fi")
        val connection = network.openConnection(URL(server + path)) as HttpsURLConnection
        connection.sslSocketFactory = tls.socketFactory
        // The server is reached by a LAN address its certificate does not name. Its public key has
        // already matched the pin exactly, which is a stronger check than any hostname comparison.
        connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
        connection.connectTimeout = 10_000
        connection.readTimeout = 30_000
        for ((name, value) in auth.headers) connection.setRequestProperty(name, value)
        return connection
    }

    private fun read(connection: HttpsURLConnection, path: String): String {
        val code = connection.responseCode
        val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
            ?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code in 400..499) {
            val reason = runCatching { JSONObject(text).getString("error") }.getOrDefault(text.take(200))
            throw Refused(code, "The server refused $path: $reason ($code)")
        }
        // Busy (every download slot taken): not a failure, just a later retry.
        if (code == 503) throw IOException("The provisioning server is busy; trying again shortly")
        if (code !in 200..299) throw IOException("The server failed on $path ($code)")
        return text
    }

    private fun wifi(): Network? = wifi(context)

    companion object {
        /** The connected Wi-Fi, validated or not: a closed warehouse network never validates. */
        fun wifi(context: Context): Network? {
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
            @Suppress("DEPRECATION")
            return connectivity.allNetworks.firstOrNull {
                connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            }
        }

        fun onWifi(context: Context) = wifi(context) != null
    }

    /** Trusts exactly one public key, the pinned one, and nothing else: no CA, no fallback. */
    @SuppressLint("CustomX509TrustManager")
    private class PinnedTrust(private val pin: ByteArray) : X509TrustManager {
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
            val leaf = chain.firstOrNull() ?: throw CertificateException("The server sent no certificate")
            val digest = MessageDigest.getInstance("SHA-256").digest(leaf.publicKey.encoded)
            if (!MessageDigest.isEqual(digest, pin)) {
                throw CertificateException("The server's key is not the one in the QR code")
            }
        }

        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
            throw CertificateException("Client certificates are not accepted")

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}
