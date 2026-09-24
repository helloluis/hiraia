package expo.modules.hiraiatala

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HiraiaTalaModule : Module() {
    private val activity
        get() = appContext.currentActivity ?: throw Exceptions.MissingActivity()

    private var nearby: TalaNearby? = null

    private fun client(): TalaNearby {
        val existing = nearby
        if (existing != null) return existing
        val created = TalaNearby(activity) { name, body -> sendEvent(name, body) }
        nearby = created
        return created
    }

    override fun definition() = ModuleDefinition {
        Name("HiraiaTala")
        Events("onFound", "onLost", "onConnection", "onBytes", "onError")

        Function("playServicesOk") {
            GoogleApiAvailability.getInstance()
                .isGooglePlayServicesAvailable(activity) == ConnectionResult.SUCCESS
        }

        /**
         * Nearby needs local radios, even when the phones have no internet connection.
         * Report each radio separately so the React UI can give an actionable explanation
         * instead of treating every startDiscovery failure as the same generic error.
         */
        Function("connectivityStatus") {
            val bluetooth = activity.getSystemService(BluetoothManager::class.java)?.adapter
            @Suppress("DEPRECATION")
            val wifi = activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            mapOf(
                "bluetoothSupported" to (bluetooth != null),
                "bluetoothOn" to (bluetooth?.isEnabled == true),
                "wifiSupported" to (wifi != null),
                "wifiOn" to (wifi?.isWifiEnabled == true),
            )
        }

        /** Android requires a visible system confirmation before an app can enable Bluetooth. */
        Function("requestBluetoothEnable") {
            val bluetooth = activity.getSystemService(BluetoothManager::class.java)?.adapter
            if (bluetooth == null || bluetooth.isEnabled) {
                false
            } else {
                try {
                    activity.startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
                    true
                } catch (_: Exception) {
                    false
                }
            }
        }

        /** Apps cannot silently enable Wi-Fi on modern Android, so show the system control. */
        Function("openWifiSettings") {
            try {
                val action = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    Settings.Panel.ACTION_WIFI
                } else {
                    Settings.ACTION_WIFI_SETTINGS
                }
                activity.startActivity(Intent(action))
                true
            } catch (_: Exception) {
                false
            }
        }

        AsyncFunction("encryptRequest") { publicKey: String, challenge: String, plaintext: String ->
            TalaCrypto.encryptRequest(publicKey, challenge, plaintext)
        }

        AsyncFunction("decryptResponse") { sessionKey: String, challenge: String, nonce: String, ciphertext: String ->
            TalaCrypto.decryptResponse(sessionKey, challenge, nonce, ciphertext)
        }

        AsyncFunction("randomBytes") { n: Int ->
            TalaCrypto.encode(TalaCrypto.randomBytes(n))
        }

        AsyncFunction("sha256") { input: String ->
            TalaCrypto.encode(TalaCrypto.sha256(TalaCrypto.decode(input)))
        }

        AsyncFunction("hmacSha256") { key: String, message: String ->
            TalaCrypto.encode(TalaCrypto.hmacSha256(TalaCrypto.decode(key), TalaCrypto.decode(message)))
        }

        AsyncFunction("decryptAesGcm") { key: String, nonce: String, aad: String, ciphertext: String ->
            TalaCrypto.decryptAesGcm(key, nonce, aad, ciphertext)
        }

        AsyncFunction("startDiscovery") { promise: Promise ->
            client().startDiscovery({ promise.resolve(true) }, { error ->
                promise.reject("TALA_DISCOVERY", error.message, error)
            })
        }

        AsyncFunction("requestConnection") { endpointId: String, promise: Promise ->
            client().requestConnection(endpointId, { promise.resolve(true) }, { error ->
                promise.reject("TALA_CONNECT", error.message, error)
            })
        }

        AsyncFunction("send") { endpointId: String, json: String, promise: Promise ->
            client().send(endpointId, json, { promise.resolve(true) }, { error ->
                promise.reject("TALA_SEND", error.message, error)
            })
        }

        AsyncFunction("disconnect") { endpointId: String ->
            nearby?.disconnect(endpointId)
        }

        AsyncFunction("stop") {
            nearby?.stop()
        }
    }
}
