package com.hiraia.tala

import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

data class EnrollmentTicket(val enrollmentId: String, val code: String, val expiresAt: Long) {
    fun display(): String = code.chunked(4).joinToString("-")
}

class ManualEnrollment {
    private var ticket: EnrollmentTicket? = null
    private val random = SecureRandom()

    @Synchronized
    fun current(enrollmentId: String, now: Long = System.currentTimeMillis()): EnrollmentTicket {
        val existing = ticket
        if (existing != null && existing.enrollmentId == enrollmentId && existing.expiresAt > now) return existing
        return EnrollmentTicket(enrollmentId, buildString {
            repeat(12) { append(ALPHABET[random.nextInt(ALPHABET.length)]) }
        }, now + ONE_HOUR).also { ticket = it }
    }

    @Synchronized
    fun clear() {
        ticket = null
    }

    @Synchronized
    fun respond(enrollmentId: String, challenge: String, request: JSONObject, qrPayload: String,
        now: Long = System.currentTimeMillis()): JSONObject {
        val active = ticket ?: throw IllegalArgumentException("No enrollment code")
        require(active.enrollmentId == enrollmentId && active.expiresAt > now)
        require(request.getInt("v") == 1 && request.getString("type") == "manual_enroll")
        val clientNonce = ClassIdentity.decode(request.getString("client_nonce"))
        require(clientNonce.size == 16)
        val challengeBytes = challenge.toByteArray(Charsets.UTF_8)
        val secret = MessageDigest.getInstance("SHA-256").digest(
            "hiraia-tala-manual-v1:".toByteArray(Charsets.UTF_8) + active.code.toByteArray(Charsets.US_ASCII)
        )
        val expected = hmac(secret, byteArrayOf(1) + challengeBytes + clientNonce)
        require(MessageDigest.isEqual(expected, ClassIdentity.decode(request.getString("proof"))))
        val responseKey = hmac(secret, byteArrayOf(2) + challengeBytes + clientNonce)
        val nonce = ByteArray(12).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(responseKey, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(byteArrayOf(3) + challengeBytes + clientNonce)
        return JSONObject().put("v", 1).put("type", "manual_key")
            .put("nonce", ClassIdentity.encode(nonce))
            .put("ciphertext", ClassIdentity.encode(cipher.doFinal(qrPayload.toByteArray(Charsets.UTF_8))))
    }

    companion object {
        const val ONE_HOUR = 60 * 60 * 1000L
        private const val ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

        fun hmac(key: ByteArray, message: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(message)
        }
    }
}
