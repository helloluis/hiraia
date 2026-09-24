package com.hiraia.tala

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import java.security.spec.MGF1ParameterSpec

private const val MAX_CLASS_NAME = 48

class ClassIdentity(context: Context, val classId: String = legacyClassId(context)) {
    private val privateKey: PrivateKey
    private val publicKey: ByteArray

    init {
        val alias = "hiraia.tala.class.$classId"
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!keyStore.containsAlias(alias)) {
            val parameters = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .build()
            KeyPairGenerator.getInstance("RSA", "AndroidKeyStore").apply { initialize(parameters) }
                .generateKeyPair()
        }
        privateKey = keyStore.getKey(alias, null) as PrivateKey
        publicKey = keyStore.getCertificate(alias).publicKey.encoded
    }

    /**
     * The enrolment payload. `class_name` is carried so the student phone can NAME the class it
     * joined instead of showing an opaque class_id; it is advisory only — nothing authenticates
     * or routes on it, and a student build that predates it simply ignores the extra key.
     * Capped so a long name cannot bloat the QR past its scan-reliable density.
     *
     * NEVER BLANK. Classes created before names were required have none stored, so
     * ClassNames.resolve derives a stable colour-animal name from the class id instead —
     * same class, same name, on every phone, with nothing to migrate.
     */
    fun qrPayload(className: String = ""): String = JSONObject()
        .put("v", 1)
        .put("kind", "hiraia-tala")
        .put("class_id", classId)
        .put("class_name", displayName(className))
        .put("public_key", encode(publicKey))
        .toString()

    /** The class name a student phone is given, in the QR and in every sync reply alike. */
    fun displayName(className: String?): String = ClassNames.resolve(classId, className).take(MAX_CLASS_NAME)

    fun unwrapSessionKey(wrapped: String): ByteArray {
        val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding")
        val parameters = OAEPParameterSpec(
            "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT
        )
        cipher.init(Cipher.DECRYPT_MODE, privateKey, parameters)
        return cipher.doFinal(decode(wrapped)).also { require(it.size == 32) }
    }

    fun encrypt(key: ByteArray, challenge: String, plaintext: String, type: String): JSONObject {
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(challenge.toByteArray(Charsets.UTF_8))
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return JSONObject().put("v", 1).put("type", type)
            .put("nonce", encode(nonce)).put("ciphertext", encode(ciphertext))
    }

    fun decrypt(key: ByteArray, challenge: String, message: JSONObject): String {
        val nonce = decode(message.getString("nonce"))
        require(nonce.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(challenge.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(decode(message.getString("ciphertext"))).toString(Charsets.UTF_8)
    }

    companion object {
        fun legacyClassId(context: Context): String {
            val preferences = context.getSharedPreferences("tala-class-v1", Context.MODE_PRIVATE)
            return preferences.getString("class_id", null) ?: UUID.randomUUID().toString().also {
                check(preferences.edit().putString("class_id", it).commit())
            }
        }

        fun encode(bytes: ByteArray): String = Base64.encodeToString(
            bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )

        fun decode(value: String): ByteArray = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP)

        fun challenge(): String = encode(ByteArray(24).also { SecureRandom().nextBytes(it) })
    }
}
