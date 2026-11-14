package expo.modules.talaactivity

import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/**
 * The classroom protocol's primitives, ported from Hiraia Tala 0.4.4
 * (packages/tala/android/app/src/main/java/com/hiraia/tala/ClassIdentity.kt on branch tala-0.4.x)
 * and the student side (packages/mobile/modules/hiraia-tala/.../TalaCrypto.java). Pure JVM — no
 * Android imports — so it is unit-tested against the vectors in ../vectors without a device.
 *
 * RSA-OAEP SHA-256 / MGF1-SHA1 key unwrap; AES-256-GCM with a 128-bit tag, a 12-byte nonce and the
 * connection's challenge (UTF-8) as associated data; base64url without padding everywhere.
 */
object TalaCrypto {
    private val random = SecureRandom()

    fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    /** Accepts padded or unpadded input, like android.util.Base64 URL_SAFE did in 0.4.x. */
    fun decode(value: String): ByteArray = Base64.getUrlDecoder().decode(value.trimEnd('='))

    fun randomBytes(count: Int): ByteArray = ByteArray(count).also { random.nextBytes(it) }

    /** 24 random bytes, base64url: the per-connection challenge (ClassIdentity.challenge). */
    fun challenge(): String = encode(randomBytes(24))

    fun sha256(input: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(input)

    fun hmacSha256(key: ByteArray, message: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(message)
    }

    /** ClassIdentity.unwrapSessionKey: the student's fresh AES key, which must be exactly 32 bytes. */
    fun unwrapSessionKey(privateKey: PrivateKey, wrapped: String): ByteArray {
        val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding")
        cipher.init(Cipher.DECRYPT_MODE, privateKey,
            OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT))
        return cipher.doFinal(decode(wrapped)).also { require(it.size == 32) { "session key size" } }
    }

    fun aesGcmEncrypt(key: ByteArray, nonce: ByteArray, aad: ByteArray, plaintext: ByteArray): ByteArray {
        require(key.size == 32 && nonce.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad)
        return cipher.doFinal(plaintext)
    }

    fun aesGcmDecrypt(key: ByteArray, nonce: ByteArray, aad: ByteArray, ciphertext: ByteArray): ByteArray {
        require(key.size == 32) { "key size" }
        require(nonce.size == 12) { "nonce size" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad)
        return cipher.doFinal(ciphertext)
    }

    /** ClassIdentity.decrypt: the inner JSON of an intro/batch envelope. */
    fun decryptEnvelope(sessionKey: ByteArray, challenge: String, nonce: String, ciphertext: String): String =
        aesGcmDecrypt(sessionKey, decode(nonce), challenge.toByteArray(Charsets.UTF_8), decode(ciphertext))
            .toString(Charsets.UTF_8)

    /**
     * ClassIdentity.encrypt: a sealed `ready`/`ack` envelope as compact JSON. Key order matches
     * org.json's output in 0.4.4 (v, type, nonce, ciphertext); the student parses it as JSON anyway.
     */
    fun encryptReply(sessionKey: ByteArray, challenge: String, type: String, plaintext: String,
        nonce: ByteArray = randomBytes(12)): String {
        val sealed = aesGcmEncrypt(sessionKey, nonce, challenge.toByteArray(Charsets.UTF_8),
            plaintext.toByteArray(Charsets.UTF_8))
        return """{"v":1,"type":"${type}","nonce":"${encode(nonce)}","ciphertext":"${encode(sealed)}"}"""
    }
}
