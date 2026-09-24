package com.hiraia.tala

import java.security.MessageDigest
import java.util.Base64

/**
 * The class hint in Tala's Nearby endpoint name, so a student phone can tell BEFORE connecting
 * whether this Tala is collecting a class one of its profiles joined. Without it a phone whose
 * profiles are in different classes has to try each class key on every Tala it finds.
 *
 * The name is "Hiraia Tala 2 " followed by the hint; the "2" says the name carries hints and
 * that this Tala honours `left_profiles`. Tala 0.4.3 and older advertise plain "Hiraia Tala".
 * A later Tala may list several hints after the prefix, comma-separated.
 *
 * The hint is a hash of the class id, not the id: the broadcast is readable by anyone nearby,
 * and it only has to be told apart from the few other classes in range. It is advisory — a
 * wrong hint costs a wasted connection, and only the class key can read a student's batch.
 */
object ClassHint {
    private const val PREFIX = "Hiraia Tala 2 "

    fun of(classId: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("hiraia-tala-hint-v1:$classId".toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest).take(8)
    }

    fun endpointName(classId: String): String = PREFIX + of(classId)
}
