package expo.modules.talaactivity

import java.security.MessageDigest

/**
 * Typed-code enrolment, ported from Tala 0.4.4 ManualEnrollment.kt (branch tala-0.4.x) and checked
 * against the student's manual.ts. The 12-character code is a one-hour secret that authenticates a
 * Nearby exchange delivering the exact QR JSON; it is NOT an encoding of the key.
 *
 *   secret       = SHA-256(UTF-8("hiraia-tala-manual-v1:") || ASCII(code))
 *   proof        = HMAC-SHA256(secret, 0x01 || UTF-8(challenge) || client_nonce)
 *   response_key = HMAC-SHA256(secret, 0x02 || UTF-8(challenge) || client_nonce)
 *   response_AAD =                     0x03 || UTF-8(challenge) || client_nonce
 *
 * Ticket lifetime (one hour, cleared on refresh / class change / restart) and the ≤3 attempts per
 * connection are enforced by the JS session; this object only does the arithmetic, so the code never
 * has to be logged or compared in JavaScript.
 */
object ManualEnrollment {
    const val ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    const val CODE_LENGTH = 12
    private const val PREFIX = "hiraia-tala-manual-v1:"

    /** A fresh 12-character code; rejection sampling keeps all 31 symbols equally likely. */
    fun newCode(): String = buildString {
        while (length < CODE_LENGTH) {
            for (byte in TalaCrypto.randomBytes(16)) {
                val value = byte.toInt() and 0xFF
                if (value < 248 && length < CODE_LENGTH) append(ALPHABET[value % ALPHABET.length])
            }
        }
    }

    /** Uppercase, hyphens/spaces removed; null unless exactly 12 alphabet characters. */
    fun normalize(input: String): String? {
        val raw = input.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }
        if (raw.length != CODE_LENGTH || raw.any { it !in ALPHABET }) return null
        return raw
    }

    fun display(code: String): String = code.chunked(4).joinToString("-")

    fun secret(code: String): ByteArray = TalaCrypto.sha256(
        PREFIX.toByteArray(Charsets.UTF_8) + code.toByteArray(Charsets.US_ASCII))

    private fun tagged(tag: Int, challenge: String, clientNonce: ByteArray): ByteArray =
        byteArrayOf(tag.toByte()) + challenge.toByteArray(Charsets.UTF_8) + clientNonce

    fun proof(secret: ByteArray, challenge: String, clientNonce: ByteArray): ByteArray =
        TalaCrypto.hmacSha256(secret, tagged(1, challenge, clientNonce))

    fun responseKey(secret: ByteArray, challenge: String, clientNonce: ByteArray): ByteArray =
        TalaCrypto.hmacSha256(secret, tagged(2, challenge, clientNonce))

    fun responseAad(challenge: String, clientNonce: ByteArray): ByteArray = tagged(3, challenge, clientNonce)

    /**
     * Check a student's `manual_enroll` proof against [code] and, when it holds, seal [qrPayload]
     * into the `manual_key` reply (compact JSON). Throws on a bad nonce or proof; the caller
     * disconnects and counts the attempt.
     */
    fun respond(code: String, challenge: String, clientNonceB64: String, proofB64: String,
        qrPayload: String, nonce: ByteArray = TalaCrypto.randomBytes(12)): String {
        val clientNonce = TalaCrypto.decode(clientNonceB64)
        require(clientNonce.size == 16) { "client nonce" }
        val secret = secret(code)
        val expected = proof(secret, challenge, clientNonce)
        require(MessageDigest.isEqual(expected, TalaCrypto.decode(proofB64))) { "proof" }
        val sealed = TalaCrypto.aesGcmEncrypt(responseKey(secret, challenge, clientNonce), nonce,
            responseAad(challenge, clientNonce), qrPayload.toByteArray(Charsets.UTF_8))
        return """{"v":1,"type":"manual_key","nonce":"${TalaCrypto.encode(nonce)}","ciphertext":"${TalaCrypto.encode(sealed)}"}"""
    }
}
