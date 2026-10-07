package com.hiraia.provisioner

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import java.io.IOException
import java.io.InterruptedIOException
import java.net.Inet4Address
import java.net.SocketTimeoutException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Reaches the provisioning server wherever it is now. The address in the QR code is only where
 * the laptop was at the time: a new DHCP lease, or a switch from Ethernet to Wi-Fi, moves it.
 * The server's identity is its pinned key, so when the stored address stops answering the phone
 * looks the server up over mDNS, tries every address it finds, and keeps the one that proves it
 * holds that key. Anything can answer the mDNS query; only the real server passes the pin.
 */
class ServerLocator(
    private val context: Context,
    private val state: ProvisioningState,
    private val stopped: () -> Boolean = { false }
) {
    fun <T> call(request: (ServerClient) -> T): T {
        val pin = state.pin ?: throw IOException("No server pin")
        val stored = state.server ?: throw IOException("No server address")
        try {
            return request(ServerClient(context, stored, pin))
        } catch (refused: ServerClient.Refused) {
            throw refused
        } catch (unreachable: IOException) {
            // A stopped job is not an unreachable server: do not go looking for it.
            if (stopped() || (unreachable is InterruptedIOException && unreachable !is SocketTimeoutException)) {
                throw unreachable
            }
            for (candidate in discover() - stored) {
                if (stopped()) break
                val client = ServerClient(context, candidate, pin)
                try {
                    return request(client).also { state.moveServer(candidate) }
                } catch (refused: ServerClient.Refused) {
                    state.moveServer(candidate) // it answered through the pin: this is the server
                    throw refused
                } catch (_: IOException) {
                    // not the server, or not reachable from here either
                }
            }
            throw unreachable
        }
    }

    /** Addresses announcing the provisioning service, as https:// base URLs. */
    private fun discover(): List<String> {
        val nsd = context.getSystemService(NsdManager::class.java)
        // Without a multicast lock, Wi-Fi power saving may drop the multicast answers.
        val multicast = context.getSystemService(WifiManager::class.java)
            .createMulticastLock("hiraia-provisioning").apply { setReferenceCounted(false) }
        val found = LinkedBlockingQueue<NsdServiceInfo>()
        val listener = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(service: NsdServiceInfo) {
                found.add(service)
            }

            override fun onServiceLost(service: NsdServiceInfo) = Unit
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
        }
        multicast.acquire()
        val addresses = LinkedHashSet<String>()
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            try {
                var deadline = SystemClock.elapsedRealtime() + SEARCH_MILLIS
                while (!stopped()) {
                    val left = deadline - SystemClock.elapsedRealtime()
                    if (left <= 0) break
                    val service = found.poll(left, TimeUnit.MILLISECONDS) ?: break
                    resolve(nsd, service)?.let {
                        addresses.add(it)
                        // One server is the normal case; wait a moment longer only for a second one.
                        deadline = minOf(deadline, SystemClock.elapsedRealtime() + 1_000)
                    }
                }
            } finally {
                runCatching { nsd.stopServiceDiscovery(listener) }
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            multicast.release()
        }
        return addresses.toList()
    }

    private fun resolve(nsd: NsdManager, service: NsdServiceInfo): String? {
        val result = ArrayBlockingQueue<String>(1)
        val listener = object : NsdManager.ResolveListener {
            override fun onServiceResolved(resolved: NsdServiceInfo) {
                @Suppress("DEPRECATION") // hostAddresses needs API 34
                val host = resolved.host
                result.offer(if (host is Inet4Address) "https://${host.hostAddress}:${resolved.port}" else "")
            }

            override fun onResolveFailed(service: NsdServiceInfo, errorCode: Int) {
                result.offer("")
            }
        }
        @Suppress("DEPRECATION") // its replacement needs API 34; this one still works there
        nsd.resolveService(service, listener)
        val address = result.poll(RESOLVE_SECONDS, TimeUnit.SECONDS)
        // An unanswered resolve stays active and blocks every later one. Android 14 can cancel it;
        // Android 13 cannot, which is why the server announces one stable name that always answers.
        if (address == null && Build.VERSION.SDK_INT >= 34) runCatching { nsd.stopServiceResolution(listener) }
        return address?.ifEmpty { null }
    }

    companion object {
        /** Matches the server's MDNS_TYPE. */
        const val SERVICE_TYPE = "_hiraia-prov._tcp"
        private const val SEARCH_MILLIS = 8_000L
        private const val RESOLVE_SECONDS = 5L
    }
}
