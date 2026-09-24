package com.hiraia.tala

import java.time.LocalDate

/** A card view or graded quiz, reduced to what the student page counts. */
data class LearningEvent(
    val name: String,
    val occurredAt: Long,
    val correct: Boolean,
    val cardId: String = "",
    val questionId: String = ""
)

data class ActivityTotals(val viewed: Int, val unique: Int, val quizzes: Int, val correct: Int) {
    companion object {
        /** Unique counts distinct curated cards; a generated card has no id, so it never is. */
        fun of(events: List<LearningEvent>): ActivityTotals {
            val views = events.filter { it.name == "card_viewed" }
            val quizzes = events.filter { it.name == "quiz_graded" }
            return ActivityTotals(views.size, views.mapNotNull { it.cardId.ifEmpty { null } }.toSet().size,
                quizzes.size, quizzes.count { it.correct })
        }
    }
}

/** What a student did in one subcategory on one day. */
data class SubcategoryDay(val label: String, val totals: ActivityTotals)

/**
 * One day of a student's learning: its totals, and the subcategories it was spent in. A student
 * usually gets through one or two subcategories in a sitting, so a day reads as a short list.
 * A card in two subcategories is listed under both; the day's own totals count it once.
 * Whatever cannot be placed is kept as its own last entry rather than dropped.
 */
data class DayActivity(val date: LocalDate, val totals: ActivityTotals, val subcategories: List<SubcategoryDay>) {
    companion object {
        const val NO_SUBCATEGORY = "No subcategory"
        private const val NONE = -1

        fun of(date: LocalDate, events: List<LearningEvent>, catalog: CardCatalog): DayActivity {
            val groups = LinkedHashMap<Int, MutableList<LearningEvent>>()
            for (event in events) {
                val placed = catalog.subcategories(event)
                for (subcategory in if (placed.isEmpty()) listOf(NONE) else placed.distinct())
                    groups.getOrPut(subcategory) { mutableListOf() }.add(event)
            }
            val subcategories = groups.entries
                .sortedWith(compareBy<Map.Entry<Int, MutableList<LearningEvent>>> { it.key == NONE }
                    .thenByDescending { it.value.size }
                    .thenBy { if (it.key == NONE) "" else catalog.label(it.key).lowercase() })
                .map { (subcategory, grouped) ->
                    SubcategoryDay(if (subcategory == NONE) NO_SUBCATEGORY else catalog.label(subcategory),
                        ActivityTotals.of(grouped))
                }
            return DayActivity(date, ActivityTotals.of(events), subcategories)
        }
    }
}

/** "5 cards viewed, 4 unique · 3 quizzes, 2 correct", leaving out whichever half is empty. */
fun ActivityTotals.describe(): String = listOfNotNull(
    if (viewed == 0) null else "$viewed ${if (viewed == 1) "card" else "cards"} viewed" +
        if (unique > 0) ", $unique unique" else "",
    if (quizzes == 0) null else "$quizzes ${if (quizzes == 1) "quiz" else "quizzes"}, $correct correct"
).joinToString(" · ")
