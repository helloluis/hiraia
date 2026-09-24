package com.hiraia.tala

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.StringReader
import java.time.LocalDate

class LearningActivityTest {
    private val catalog = CardCatalog.parse(StringReader(CardCatalogTest.FIXTURE))
    private val day = LocalDate.of(2026, 9, 24)

    @Test
    fun totalsCountDistinctCuratedCardsAndCorrectQuizzes() {
        val events = listOf(view("ffct-00001"), view("ffct-00001"), view(""), view("ffct-00002"),
            quiz("storm-g4", true), quiz("storm-g4", false))
        assertEquals(ActivityTotals(4, 2, 2, 1), ActivityTotals.of(events))
        assertEquals(ActivityTotals(0, 0, 0, 0), ActivityTotals.of(emptyList()))
    }

    @Test
    fun aDayListsItsSubcategoriesBusiestFirstWithWhatCouldNotBePlacedLast() {
        val activity = DayActivity.of(day, listOf(
            view("ffct-00001"), view("ffct-00001"),  // Insects, the same card twice
            view("ffct-00002"),                      // Insects AND Mammals
            view("dcard-00003"),                     // Weather Types
            view(""),                                // generated on the phone: no id
            quiz("storm-g4", true),                  // Weather Types AND Mammals
            quiz("butterfly-g5", false),             // Insects
            quiz("unknown-fact", true)
        ), catalog)
        assertEquals(day, activity.date)
        assertEquals(ActivityTotals(5, 3, 3, 2), activity.totals)
        assertEquals(listOf(
            SubcategoryDay("Insects", ActivityTotals(3, 2, 1, 0)),
            SubcategoryDay("Mammals", ActivityTotals(1, 1, 1, 1)),
            SubcategoryDay("Weather Types", ActivityTotals(1, 1, 1, 1)),
            SubcategoryDay(DayActivity.NO_SUBCATEGORY, ActivityTotals(1, 0, 1, 1))
        ), activity.subcategories)
    }

    @Test
    fun anEmptyDayHasNoSubcategories() {
        assertEquals(DayActivity(day, ActivityTotals(0, 0, 0, 0), emptyList()), DayActivity.of(day, emptyList(), catalog))
    }

    @Test
    fun summariesReadNaturallyAndLeaveOutWhatDidNotHappen() {
        assertEquals("5 cards viewed, 4 unique · 3 quizzes, 2 correct", ActivityTotals(5, 4, 3, 2).describe())
        assertEquals("1 card viewed, 1 unique", ActivityTotals(1, 1, 0, 0).describe())
        assertEquals("2 cards viewed", ActivityTotals(2, 0, 0, 0).describe()) // generated cards have no id
        assertEquals("1 quiz, 0 correct", ActivityTotals(0, 0, 1, 0).describe())
        assertEquals("", ActivityTotals(0, 0, 0, 0).describe())
    }

    private fun view(cardId: String) = LearningEvent("card_viewed", 0, false, cardId)
    private fun quiz(fact: String, correct: Boolean) = LearningEvent("quiz_graded", 0, correct, questionId = fact)
}
