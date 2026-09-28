package expo.modules.hiraiamanagedconfig

import android.content.Context
import android.content.RestrictionsManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Sent when the phone's internet may have just come back. src/net/connectivity.ts listens. */
private const val INTERNET_RESTORED = "onInternetRestored"

/**
 * How long a returning network must hold before JS hears about it. Joining Wi-Fi can bounce
 * for a few seconds, and every event makes the app retry its downloads, so let it settle.
 */
private const val SETTLE_MS = 3_000L

/**
 * Reads Hiraia's Android managed configuration: the app restrictions a device owner sets with
 * DevicePolicyManager.setApplicationRestrictions. On donated phones that owner is Hiraia Setup
 * (packages/provisioner), and the one key it sets is the provisioning laptop's download mirror.
 *
 * It also tells JS when the internet comes back, because those same phones leave the
 * warehouse and must finish their downloads from hiraia.org on whatever Wi-Fi a school has,
 * whenever it has it.
 */
class HiraiaManagedConfigModule : Module() {
    // The network watch. Every field below is touched only on the main looper: the
    // ConnectivityManager callbacks are delivered through `handler`, and the JS-driven start
    // and stop are posted to it, so none of this needs a lock.
    private val handler = Handler(Looper.getMainLooper())
    private var manager: ConnectivityManager? = null
    private var watch: ConnectivityManager.NetworkCallback? = null
    /** The app's default network, or null while the phone has none it can use. */
    private var current: Network? = null
    private var validated = false
    private var blocked = false
    private val announce = Runnable {
        // runCatching: a JS reload can tear the module down with this still queued.
        if (watch != null && current != null && !blocked) runCatching { sendEvent(INTERNET_RESTORED) }
    }

    override fun definition() = ModuleDefinition {
        Name("HiraiaManagedConfig")
        Events(INTERNET_RESTORED)

        /**
         * The "assetMirror" string exactly as the device owner set it, or null. A phone that no
         * DPC manages has an empty restrictions bundle, so this is null on every ordinary phone.
         *
         * Deliberately NOT validated here: src/config/assetMirror.ts owns the rules, and it
         * treats the value as a hint anyway, because every byte fetched from a mirror is checked
         * against the size and MD5 baked into the APK. Read on every call rather than cached, so
         * a DPC that moves the mirror (the laptop got a new address) is honoured at the next
         * download.
         */
        AsyncFunction("assetMirror") {
            runCatching {
                val manager = appContext.reactContext
                    ?.getSystemService(Context.RESTRICTIONS_SERVICE) as? RestrictionsManager
                manager?.applicationRestrictions?.getString("assetMirror")
            }.getOrNull()
        }

        // Watch the network only while JS listens: the first listener starts it and removing
        // the last one stops it.
        OnStartObserving(INTERNET_RESTORED) { handler.post { startWatching() } }
        OnStopObserving(INTERNET_RESTORED) { handler.post { stopWatching() } }
        OnDestroy { handler.post { stopWatching() } }
    }

    /**
     * Follows the app's DEFAULT network: the one its downloads actually use. "The internet may
     * be back" means any of:
     *  - a network arrives when there was none (Wi-Fi joined, or replaced a lost one);
     *  - the network passes Android's internet check (a captive portal was signed in to, or
     *    the router's uplink came up after the Wi-Fi did);
     *  - Android stops blocking this app's traffic (Doze, Data Saver).
     * Validation is NOT required for the first: a warehouse LAN that only reaches the mirror
     * never validates, and the mirror is the whole point there. Every default network carries
     * NET_CAPABILITY_INTERNET, because the system's default request asks for it.
     */
    private fun startWatching() {
        if (watch != null) return
        runCatching {
            val manager = appContext.reactContext?.getSystemService(ConnectivityManager::class.java)
                ?: return
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    if (watch === this) joined(network)
                }

                override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                    if (watch === this) {
                        checked(network, networkCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
                    }
                }

                override fun onBlockedStatusChanged(network: Network, blocked: Boolean) {
                    if (watch === this) blockedChanged(network, blocked)
                }

                override fun onLost(network: Network) {
                    if (watch === this) lost(network)
                }
            }
            manager.registerDefaultNetworkCallback(callback, handler)
            this.manager = manager
            watch = callback
            // Read the starting state only now. The callback's first reports (the network as
            // registration found it) are queued on this looper behind the running message, so
            // they confirm what is read here instead of looking like a network that just
            // arrived, and whatever changes in between still arrives as a change. Blocked is
            // not readable up front; its first report corrects this guess.
            val network = manager.activeNetwork
            current = network
            validated = network != null && manager.getNetworkCapabilities(network)
                ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
            blocked = false
        }.onFailure { stopWatching() }
    }

    private fun stopWatching() {
        val callback = watch
        watch = null
        current = null
        handler.removeCallbacks(announce)
        if (callback != null) runCatching { manager?.unregisterNetworkCallback(callback) }
    }

    private fun joined(network: Network) {
        if (network == current) return
        val wasOffline = current == null
        current = network
        validated = false
        if (wasOffline) settle()
    }

    private fun checked(network: Network, nowValidated: Boolean) {
        if (network != current) return
        if (nowValidated && !validated) settle()
        validated = nowValidated
    }

    private fun blockedChanged(network: Network, nowBlocked: Boolean) {
        if (network != current) return
        if (!nowBlocked && blocked) settle()
        if (nowBlocked) handler.removeCallbacks(announce)
        blocked = nowBlocked
    }

    private fun lost(network: Network) {
        if (network != current) return
        current = null
        validated = false
        handler.removeCallbacks(announce)
    }

    /** (Re)starts the settling delay, so a burst of changes becomes one event. */
    private fun settle() {
        handler.removeCallbacks(announce)
        handler.postDelayed(announce, SETTLE_MS)
    }
}
