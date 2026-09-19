package com.hiraia.tala

import java.security.MessageDigest
import java.text.Normalizer
import java.util.Locale

data class RosterCard(
    val student: StudentRow,
    val displayName: String,
    val animalIndex: Int,
    val colorIndex: Int
)

object RosterIdentity {
    val animals = arrayOf("🐢", "🦊", "🐳", "🦉", "🐻", "🦋", "🐸", "🐧", "🐯", "🐨", "🦜", "🐰")
    val colors = intArrayOf(
        0xFFFFDAC6.toInt(), 0xFFF5DEA4.toInt(), 0xFFD1EACC.toInt(),
        0xFFCFE4F2.toInt(), 0xFFE3D8F4.toInt(), 0xFFF5D7DF.toInt()
    )

    fun cards(students: List<StudentRow>): List<RosterCard> {
        val names = mutableMapOf<String, String>()
        val used = mutableSetOf<String>()
        val occurrences = mutableMapOf<String, Int>()
        val sorted = students.sortedWith(compareBy<StudentRow>(
            { normalized(it.name) }, { it.profileId }, { it.installationId }
        ))
        for (student in sorted) {
            val base = student.name.trim().replace(Regex("\\s+"), " ")
            val canonical = normalized(base)
            var number = (occurrences[canonical] ?: 0) + 1
            var candidate = if (number == 1) base else "$base-$number"
            while (normalized(candidate) in used) {
                number++
                candidate = "$base-$number"
            }
            occurrences[canonical] = number
            used.add(normalized(candidate))
            names[identity(student)] = candidate
        }
        return students.map { student ->
            val displayName = names.getValue(identity(student))
            val profileKey = if (student.profileId == "guest" || student.name.startsWith("Guest-"))
                "guest" else student.profileId
            val key = "hiraia-tala-avatar-v1\u0000${student.installationId}\u0000$profileKey"
            val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
            RosterCard(student, displayName,
                (digest[0].toInt() and 0xFF) % animals.size,
                (digest[1].toInt() and 0xFF) % colors.size)
        }
    }

    private fun identity(student: StudentRow): String = "${student.installationId}:${student.profileId}"

    private fun normalized(value: String): String = Normalizer.normalize(
        value.trim().replace(Regex("\\s+"), " "), Normalizer.Form.NFKC
    ).lowercase(Locale.ROOT)
}
