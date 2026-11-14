package expo.modules.talaactivity

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey

/**
 * One RSA-2048 key pair per class in AndroidKeyStore, exactly as Tala 0.4.x ClassIdentity.kt
 * creates it — including the alias `hiraia.tala.class.<enrollment id>`. Keeping the alias is what
 * lets the in-place upgrade (PRD ACT-2) find 0.4.x's existing keys: AndroidKeyStore entries belong
 * to the app UID, which an in-place upgrade of `com.hiraia.tala` preserves (see UPGRADE.md). The
 * private key never leaves the keystore; only `unwrap` uses it.
 */
object ClassKeys {
    private const val PREFIX = "hiraia.tala.class."

    fun alias(classId: String): String = PREFIX + classId

    private fun store(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun exists(classId: String): Boolean = store().containsAlias(alias(classId))

    /** Creates the pair when missing; returns the SPKI DER public key, base64url (the QR's `public_key`). */
    fun ensure(classId: String): String {
        require(classId.isNotBlank() && classId.length <= 80 && classId.all { it.isLetterOrDigit() || it == '-' })
        val alias = alias(classId)
        val keyStore = store()
        if (!keyStore.containsAlias(alias)) {
            val parameters = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .build()
            KeyPairGenerator.getInstance("RSA", "AndroidKeyStore").apply { initialize(parameters) }
                .generateKeyPair()
        }
        return TalaCrypto.encode(keyStore.getCertificate(alias).publicKey.encoded)
    }

    fun publicKey(classId: String): String? {
        val keyStore = store()
        val alias = alias(classId)
        if (!keyStore.containsAlias(alias)) return null
        return TalaCrypto.encode(keyStore.getCertificate(alias).publicKey.encoded)
    }

    fun unwrap(classId: String, wrapped: String): ByteArray {
        val privateKey = store().getKey(alias(classId), null) as? PrivateKey
            ?: throw IllegalStateException("No key for class")
        return TalaCrypto.unwrapSessionKey(privateKey, wrapped)
    }

    /** Deleting a class deletes its key: students bound to the old QR can never be read again. */
    fun delete(classId: String) {
        val keyStore = store()
        val alias = alias(classId)
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    }
}
