package expo.modules.hiraiatala

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

        AsyncFunction("stop") {
            nearby?.stop()
        }
    }
}
