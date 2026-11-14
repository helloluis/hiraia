package expo.modules.talaactivity

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64

/**
 * The same vectors the TypeScript side generates (../../vectors/protocol-vectors.json). The RSA case
 * is the one that matters most: javax.crypto's RSA/ECB/OAEPPadding with SHA-256 + MGF1-SHA1 — what
 * Android and Tala 0.4.x use — must unwrap the key the student side wrapped.
 */
class ProtocolVectorsTest {
    private val vectors: JSONObject by lazy {
        val candidates = listOf("../vectors/protocol-vectors.json", "../../vectors/protocol-vectors.json",
            "vectors/protocol-vectors.json")
        val file = candidates.map(::File).firstOrNull { it.exists() }
            ?: throw IllegalStateException("protocol-vectors.json not found from ${File(".").absolutePath}")
        JSONObject(file.readText())
    }

    private fun privateKey(): java.security.PrivateKey {
        val pem = vectors.getJSONObject("rsa").getString("privateKeyPkcs8Pem")
            .replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "")
            .replace("\\s".toRegex(), "")
        return KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)))
    }

    @Test
    fun hintsAndEndpointNamesMatch() {
        val hints = vectors.getJSONArray("hints")
        for (index in 0 until hints.length()) {
            val entry = hints.getJSONObject(index)
            assertEquals(entry.getString("hint"), ClassHint.of(entry.getString("classId")))
            assertEquals(entry.getString("endpointName"), ClassHint.endpointName(entry.getString("classId")))
        }
        assertEquals("WlOusN1s", ClassHint.of("0f8fad5b-d9cb-469f-a165-70867728950e"))
    }

    @Test
    fun oaepUnwrapsTheStudentsSessionKey() {
        val envelope = vectors.getJSONObject("envelope")
        val sessionKey = TalaCrypto.unwrapSessionKey(privateKey(), envelope.getString("wrappedKeyB64url"))
        assertArrayEquals(TalaCrypto.decode(envelope.getString("sessionKeyB64url")), sessionKey)
        val plaintext = TalaCrypto.decryptEnvelope(sessionKey, envelope.getString("challenge"),
            envelope.getString("nonceB64url"), envelope.getString("ciphertextB64url"))
        assertEquals(envelope.getString("plaintext"), plaintext)
        // The challenge is the AAD: a different one must fail the tag.
        assertTrue(runCatching {
            TalaCrypto.decryptEnvelope(sessionKey, "other", envelope.getString("nonceB64url"), envelope.getString("ciphertextB64url"))
        }.isFailure)
    }

    @Test
    fun replyEnvelopeIsByteIdentical() {
        val reply = vectors.getJSONObject("reply")
        val outer = TalaCrypto.encryptReply(TalaCrypto.decode(reply.getString("sessionKeyB64url")),
            reply.getString("challenge"), reply.getString("type"), reply.getString("plaintext"),
            TalaCrypto.decode(reply.getString("nonceB64url")))
        assertEquals(reply.getString("outerJson"), outer)
        val parsed = JSONObject(outer)
        assertEquals(1, parsed.getInt("v"))
        assertEquals("ack", parsed.getString("type"))
    }

    @Test
    fun manualEnrolmentMatchesTheStudentFormulas() {
        val manual = vectors.getJSONObject("manual")
        val code = manual.getString("code")
        val challenge = manual.getString("challenge")
        val clientNonce = TalaCrypto.decode(manual.getString("clientNonceB64url"))
        val secret = ManualEnrollment.secret(code)
        assertEquals(manual.getString("secretB64url"), TalaCrypto.encode(secret))
        assertEquals(manual.getString("proofB64url"), TalaCrypto.encode(ManualEnrollment.proof(secret, challenge, clientNonce)))
        assertEquals(manual.getString("responseKeyB64url"), TalaCrypto.encode(ManualEnrollment.responseKey(secret, challenge, clientNonce)))
        assertEquals(manual.getString("responseAadB64url"), TalaCrypto.encode(ManualEnrollment.responseAad(challenge, clientNonce)))
        val reply = ManualEnrollment.respond(code, challenge, manual.getString("clientNonceB64url"),
            manual.getString("proofB64url"), manual.getString("qrPayload"), TalaCrypto.decode(manual.getString("replyNonceB64url")))
        assertEquals(manual.getString("manualKeyJson"), reply)
        // Wrong proof, wrong code, short nonce: refused.
        assertTrue(runCatching { ManualEnrollment.respond("ABCDEFGHJKMP", challenge, manual.getString("clientNonceB64url"), manual.getString("proofB64url"), "x") }.isFailure)
        assertTrue(runCatching { ManualEnrollment.respond(code, challenge, TalaCrypto.encode(ByteArray(15)), manual.getString("proofB64url"), "x") }.isFailure)
        assertTrue(runCatching { ManualEnrollment.respond(code, "other", manual.getString("clientNonceB64url"), manual.getString("proofB64url"), "x") }.isFailure)
    }

    @Test
    fun codesNormaliseAndDisplayLikeTheStudentApp() {
        assertEquals("ABCDEFGHJKMN", ManualEnrollment.normalize("abcd-efgh-jkmn"))
        assertEquals(null, ManualEnrollment.normalize("ABCD-EFGH-JKM0"))
        assertEquals("ABCD-EFGH-JKMN", ManualEnrollment.display("ABCDEFGHJKMN"))
        val code = ManualEnrollment.newCode()
        assertEquals(12, code.length)
        assertTrue(code.all { it in ManualEnrollment.ALPHABET })
        assertEquals(32, TalaCrypto.challenge().length)
        assertEquals(24, TalaCrypto.decode(TalaCrypto.challenge()).size)
    }

    @Test
    fun base64urlAcceptsPaddedInput() {
        val bytes = byteArrayOf(0, 1, 2, -6, -5, -4, -3, -2, -1)
        val encoded = TalaCrypto.encode(bytes)
        assertTrue(!encoded.contains('=') && !encoded.contains('+') && !encoded.contains('/'))
        assertArrayEquals(bytes, TalaCrypto.decode(encoded))
        assertArrayEquals(bytes, TalaCrypto.decode("$encoded=="))
        JSONArray().put(encoded) // org.json available for the module's tests
    }
}
