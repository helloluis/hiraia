package com.hiraia.tala

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.StringReader

class CardCatalogTest {
    private val catalog = CardCatalog.parse(StringReader(FIXTURE))

    @Test
    fun cardViewsResolveByCardId() {
        assertArrayEquals(intArrayOf(1), catalog.subcategories(view("ffct-00001")))
        assertArrayEquals(intArrayOf(1, 2), catalog.subcategories(view("ffct-00002")))
        assertEquals("Insects", catalog.label(1))
        assertEquals("Weather Types", catalog.label(0))
    }

    @Test
    fun quizzesResolveByTheirFactEvenWhenLegacyHistoryCarriesItAsCardId() {
        assertArrayEquals(intArrayOf(0, 2), catalog.subcategories(quiz(questionId = "storm-g4")))
        // Rebuilt pre-pairing history puts the question's fact id in card_id.
        assertArrayEquals(intArrayOf(1), catalog.subcategories(quiz(cardId = "butterfly-g5")))
        assertArrayEquals(intArrayOf(0, 2), catalog.subcategories(quiz(cardId = "x", questionId = "storm-g4")))
    }

    @Test
    fun whatCannotBePlacedHasNoSubcategory() {
        assertEquals(0, catalog.subcategories(view("")).size) // a generated card has no id
        assertEquals(0, catalog.subcategories(view("ffct-99999")).size) // newer than the catalog
        assertEquals(0, catalog.subcategories(quiz(questionId = "ffct-00001")).size) // cards are not facts
        assertEquals(0, catalog.subcategories(view("butterfly-g5")).size) // facts are not cards
        assertEquals(0, catalog.subcategories(LearningEvent("session_started", 0, false, "ffct-00001")).size)
    }

    @Test
    fun taxonomyIdsThatPrintTheSameLabelAreOneSubcategory() {
        // "Weather Types" is the index of its first T line in label order: Weather Types = 0.
        assertArrayEquals(intArrayOf(0), catalog.subcategories(view("dcard-00005")))
        assertArrayEquals(intArrayOf(0), catalog.subcategories(view("dcard-00003")))
        assertArrayEquals(intArrayOf(0), catalog.subcategories(quiz(questionId = "rain-g4")))
        assertEquals("Weather Types", catalog.labelOf("g4-weather"))
        assertEquals("Weather Types", catalog.labelOf("weather"))
        assertEquals(setOf("g4-weather", "insects", "mammals", "weather"), catalog.ids)
    }

    @Test
    fun cardsWithTheSameSubcategoriesShareOneArray() {
        assertSame(catalog.cards["ffct-00001"], catalog.cards["ffct-00004"])
    }

    @Test
    fun malformedCatalogsAreRefused() {
        for (broken in listOf("", "# only a comment\n", "T\tinsects\n", "X\ta\tb\n",
            "T\tinsects\tInsects\nC\tffct-00001\t1\n", "T\tinsects\tInsects\nC\tffct-00001\t\n",
            "T\tinsects\tInsects\nC\tffct-00001\ta\n")) {
            assertTrue(broken, runCatching { CardCatalog.parse(StringReader(broken)) }.isFailure)
        }
    }

    private fun view(cardId: String) = LearningEvent("card_viewed", 0, false, cardId)
    private fun quiz(cardId: String = "", questionId: String = "") =
        LearningEvent("quiz_graded", 0, true, cardId, questionId)

    companion object {
        val FIXTURE = """
            # Tala card catalog fixture
            T	g4-weather	Weather Types
            T	insects	Insects
            T	mammals	Mammals
            T	weather	Weather Types
            C	dcard-00003	3
            C	dcard-00005	0,3
            C	ffct-00001	1
            C	ffct-00002	1,2
            C	ffct-00004	1
            F	butterfly-g5	1
            F	rain-g4	0
            F	storm-g4	3,2
        """.trimIndent() + "\n"
    }
}
