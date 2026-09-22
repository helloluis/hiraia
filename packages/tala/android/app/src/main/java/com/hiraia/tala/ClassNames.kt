package com.hiraia.tala

import java.security.MessageDigest
import java.util.Locale

/**
 * Human-readable class names, so a student phone can say WHICH class it joined.
 *
 * A class name is no longer optional: every class carries one, and when a teacher does not
 * type one we generate a colour-and-animal pair instead of leaving it blank. The animals are
 * Philippine ones the cards already teach, so the name reads as part of the same world the
 * children are reading about rather than as a system-generated token.
 *
 * `forClass` is DETERMINISTIC on the class id. That matters for classes created before names
 * were required: their name is derived rather than stored, so the same class shows the same
 * name on every phone and after every reinstall, with nothing to migrate.
 */
object ClassNames {

    private val COLOURS = listOf(
        "Blue", "Green", "Red", "Gold", "Silver", "Orange", "Purple", "Teal",
        "Amber", "Coral", "Indigo", "Jade", "Ruby", "Copper", "Violet", "Crimson",
    )

    /**
     * English animal names only, so one class name reads the same to a Tagalog reader, a
     * Cebuano reader and an English one. Every entry is attested in the card corpus' English
     * (sparrow 10 uses at the low end, carabao 293 at the high), so these are animals the
     * children are already meeting in the cards — Philippine ones wherever English has a name
     * for them: tarsier, carabao, tamaraw, dugong, pangolin.
     *
     * Using Filipino names was the first attempt and it failed a corpus check: "Usa" is
     * Tagalog for deer but the ordinary Cebuano word for ONE, so "Blue Usa" would have read
     * to a Cebuano child as "Blue One".
     */
    private val ANIMALS = listOf(
        "Tarsier", "Carabao", "Tamaraw", "Dugong", "Pangolin", "Eagle", "Hornbill", "Turtle",
        "Dolphin", "Butterfly", "Firefly", "Dragonfly", "Owl", "Hawk", "Heron", "Frog",
        "Crab", "Seahorse", "Python", "Gecko", "Parrot", "Swift", "Crow", "Sparrow",
    )

    /** Total distinct names: 16 x 24 = 384. */
    fun combinations(): Int = COLOURS.size * ANIMALS.size

    /** A stable name for a class that has none, derived from its id. */
    fun forClass(classId: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(classId.toByteArray(Charsets.UTF_8))
        // Two independent bytes so colour and animal do not move together.
        val colour = COLOURS[(digest[0].toInt() and 0xff) % COLOURS.size]
        val animal = ANIMALS[(digest[1].toInt() and 0xff) % ANIMALS.size]
        return "$colour $animal"
    }

    /** A fresh suggestion for the class-creation form, which the teacher may overwrite. */
    fun suggest(): String =
        "${COLOURS.random()} ${ANIMALS.random()}"

    /** The name to put on the wire: what the teacher typed, else a derived one. Never blank. */
    fun resolve(classId: String, typed: String?): String {
        val trimmed = typed?.trim().orEmpty()
        return if (trimmed.isNotEmpty()) trimmed else forClass(classId)
    }

    /** Case-insensitive check used by tests and by the duplicate guard in the editor. */
    fun looksGenerated(name: String): Boolean {
        val parts = name.trim().split(' ')
        if (parts.size != 2) return false
        val colour = parts[0].lowercase(Locale.ROOT)
        val animal = parts[1].lowercase(Locale.ROOT)
        return COLOURS.any { it.lowercase(Locale.ROOT) == colour } &&
            ANIMALS.any { it.lowercase(Locale.ROOT) == animal }
    }
}
