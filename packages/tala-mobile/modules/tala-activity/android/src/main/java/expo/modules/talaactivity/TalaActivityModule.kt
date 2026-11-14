package expo.modules.talaactivity

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * `TalaActivity`: what the teacher phone needs natively for classroom collection — radios,
 * permissions, the per-class keystore key, the protocol's crypto, and the card catalog. Everything
 * else (sessions, storage, screens) is TypeScript in src/features/activity.
 *
 * Collection needs Android 10+ (API 29), as Tala 0.4.x did; on older phones `availability()`
 * reports `supported: false` and the JS layer shows collection as unavailable (PRD ACT-7).
 */
class TalaActivityModule : Module() {
    private val activity
        get() = appContext.currentActivity ?: throw Exceptions.MissingActivity()

    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private var nearby: NearbyAdvertiser? = null

    @Volatile
    private var catalog: CardCatalog? = null

    private fun nearby(): NearbyAdvertiser {
        val existing = nearby
        if (existing != null) return existing
        val created = NearbyAdvertiser(activity) { name, body -> sendEvent(name, body) }
        nearby = created
        return created
    }

    private fun requiredPermissions(): List<String> {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 31) {
            permissions.add(Manifest.permission.BLUETOOTH_ADVERTISE)
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            permissions.add(Manifest.permission.BLUETOOTH_SCAN)
        }
        if (Build.VERSION.SDK_INT <= 31) permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        return permissions
    }

    private fun granted(): Boolean = requiredPermissions().all {
        context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
    }

    private fun catalog(): CardCatalog = catalog ?: synchronized(this) {
        catalog ?: context.assets.open(CardCatalog.ASSET).reader().use(CardCatalog::parse).also { catalog = it }
    }

    override fun definition() = ModuleDefinition {
        Name("TalaActivity")
        Events("onConnection", "onBytes", "onError")

        OnDestroy {
            nearby?.stop()
            nearby = null
        }

        /**
         * Everything the UI needs to say in plain words why collection cannot start: the Android
         * version gate, Play services, and each radio separately (the student module does the same).
         */
        Function("availability") {
            val bluetooth = context.getSystemService(BluetoothManager::class.java)?.adapter
            @Suppress("DEPRECATION")
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            mapOf(
                "sdkInt" to Build.VERSION.SDK_INT,
                "supported" to (Build.VERSION.SDK_INT >= 29),
                "playServices" to (GoogleApiAvailability.getInstance()
                    .isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS),
                "permissionsGranted" to granted(),
                "bluetoothSupported" to (bluetooth != null),
                "bluetoothOn" to (bluetooth?.isEnabled == true),
                "wifiSupported" to (wifi != null),
                "wifiOn" to (wifi?.isWifiEnabled == true),
            )
        }

        Function("requiredPermissions") { requiredPermissions() }

        AsyncFunction("requestPermissions") { promise: Promise ->
            val needed = requiredPermissions()
            if (needed.isEmpty() || granted()) {
                promise.resolve(true)
                return@AsyncFunction
            }
            val permissions = appContext.permissions ?: throw Exceptions.PermissionsModuleNotFound()
            permissions.askForPermissions(PermissionsResponseListener { result ->
                promise.resolve(result.values.all { it.status == PermissionsStatus.GRANTED })
            }, *needed.toTypedArray())
        }

        /** Android requires a visible system confirmation before an app can enable Bluetooth. */
        Function("requestBluetoothEnable") {
            val bluetooth = context.getSystemService(BluetoothManager::class.java)?.adapter
            if (bluetooth == null || bluetooth.isEnabled) false
            else try {
                activity.startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
                true
            } catch (_: Exception) {
                false
            }
        }

        /** Apps cannot silently enable Wi-Fi on modern Android, so show the system control. */
        Function("openWifiSettings") {
            try {
                activity.startActivity(Intent(
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Settings.Panel.ACTION_WIFI
                    else Settings.ACTION_WIFI_SETTINGS))
                true
            } catch (_: Exception) {
                false
            }
        }

        // ---- class keys (AndroidKeyStore) ----
        AsyncFunction("ensureClassKey") { classId: String -> ClassKeys.ensure(classId) }
        Function("classPublicKey") { classId: String -> ClassKeys.publicKey(classId) }
        Function("hasClassKey") { classId: String -> ClassKeys.exists(classId) }
        Function("deleteClassKey") { classId: String -> ClassKeys.delete(classId) }

        // ---- protocol crypto (all base64url without padding) ----
        Function("classHint") { classId: String -> ClassHint.of(classId) }
        Function("endpointName") { classId: String -> ClassHint.endpointName(classId) }
        Function("challenge") { TalaCrypto.challenge() }
        Function("randomBytes") { count: Int -> TalaCrypto.encode(TalaCrypto.randomBytes(count)) }
        Function("sha256") { input: String -> TalaCrypto.encode(TalaCrypto.sha256(TalaCrypto.decode(input))) }
        Function("hmacSha256") { key: String, message: String ->
            TalaCrypto.encode(TalaCrypto.hmacSha256(TalaCrypto.decode(key), TalaCrypto.decode(message)))
        }

        AsyncFunction("unwrapSessionKey") { classId: String, wrapped: String ->
            TalaCrypto.encode(ClassKeys.unwrap(classId, wrapped))
        }

        AsyncFunction("decryptEnvelope") { sessionKey: String, challenge: String, nonce: String, ciphertext: String ->
            TalaCrypto.decryptEnvelope(TalaCrypto.decode(sessionKey), challenge, nonce, ciphertext)
        }

        /** The sealed `ready`/`ack` outer JSON. */
        AsyncFunction("encryptReply") { sessionKey: String, challenge: String, type: String, plaintext: String ->
            TalaCrypto.encryptReply(TalaCrypto.decode(sessionKey), challenge, type, plaintext)
        }

        Function("newManualCode") { ManualEnrollment.newCode() }

        /** The `manual_key` outer JSON when the proof holds; throws otherwise (JS counts the attempt). */
        AsyncFunction("manualRespond") { code: String, challenge: String, clientNonce: String, proof: String, qrPayload: String ->
            ManualEnrollment.respond(code, challenge, clientNonce, proof, qrPayload)
        }

        // ---- Nearby ----
        AsyncFunction("startAdvertising") { endpointName: String, promise: Promise ->
            nearby().startAdvertising(endpointName, { promise.resolve(null) }, { error ->
                promise.reject("TALA_ADVERTISE", "nearby-${NearbyAdvertiser.statusCode(error)}", error)
            })
        }

        Function("isAdvertising") { nearby?.isAdvertising == true }

        AsyncFunction("sendPayload") { endpointId: String, json: String, promise: Promise ->
            nearby().send(endpointId, json, { promise.resolve(null) }, { error ->
                promise.reject("TALA_SEND", error.message ?: "send", error)
            })
        }

        Function("disconnect") { endpointId: String -> nearby?.disconnect(endpointId) }

        Function("stopAdvertising") { nearby?.stop() }

        // ---- card catalog (parsed lazily, kept natively) ----
        AsyncFunction("catalogLoad") {
            val loaded = catalog()
            mapOf("labels" to loaded.labels().size, "entries" to loaded.size)
        }

        /** events: JSON array of {name, cardId, questionId} → JSON array of label arrays. */
        AsyncFunction("catalogSubcategories") { eventsJson: String ->
            val loaded = catalog()
            val events = JSONArray(eventsJson)
            val out = JSONArray()
            for (index in 0 until events.length()) {
                val event = events.getJSONObject(index)
                out.put(JSONArray(loaded.subcategoryLabels(event.optString("name"),
                    event.optString("cardId"), event.optString("questionId"))))
            }
            out.toString()
        }

        Function("catalogLoaded") { catalog != null }
    }
}
