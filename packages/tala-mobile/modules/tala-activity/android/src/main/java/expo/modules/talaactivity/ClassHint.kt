package expo.modules.talaactivity

/**
 * The class hint in Tala's Nearby endpoint name (Tala 0.4.4, ClassHint.kt on tala-0.4.x): the first
 * 8 characters of base64url-without-padding(SHA-256(UTF-8("hiraia-tala-hint-v1:" + class_id))).
 * Advisory only — a student phone uses it to skip other classes' teachers before connecting; only
 * the class key can read a batch. Vectors: 0f8fad5b-d9cb-469f-a165-70867728950e → WlOusN1s,
 * 7c9e6679-7425-40de-944b-e07fc1f90ae7 → x3ejyN5T.
 */
object ClassHint {
    const val PREFIX = "Hiraia Tala 2 "
    private const val SALT = "hiraia-tala-hint-v1:"

    fun of(classId: String): String =
        TalaCrypto.encode(TalaCrypto.sha256((SALT + classId).toByteArray(Charsets.UTF_8))).take(8)

    fun endpointName(classId: String): String = PREFIX + of(classId)
}
