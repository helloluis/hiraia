package com.hiraia.tala

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The shipped catalog, read by the shipped parser, against what the student app really draws
 * from — its card index plus the lesson-supplement files lessonSupplement.ts spreads in (see
 * cards.ts POOL and HAS_QUESTION). Every card and quiz question the current student build can
 * report must resolve to the subcategory labels that build shows. Gradle's checkCardCatalog
 * proves the file is current; this proves Tala reads it the way the generator meant.
 */
class CardCatalogCoverageTest {
    private val data = File("../../../mobile/src/data")

    @Test
    fun everyCardAndQuestionTheStudentAppShipsResolves() {
        val catalog = File("src/main/assets/${CardCatalog.ASSET}").reader().use(CardCatalog::parse)
        val index = JSONObject(File("../../../mobile/src/generated/cardsIndex.generated.json").readText())
        val supplements = Regex("""^import (\w+) from '\./([\w.-]+\.json)';""", RegexOption.MULTILINE)
            .findAll(File(data, "lessonSupplement.ts").readText()).map { JSONObject(File(data, it.groupValues[2]).readText()) }
            .toList()
        assertEquals(8, supplements.size)
        val cards = (listOf(index.getJSONArray("cards")) + supplements.map { it.getJSONArray("cards") })
            .flatMap { array -> (0 until array.length()).map { array.getJSONObject(it) } }
        val questions = index.getJSONArray("questionFactIds").let { a -> (0 until a.length()).map { a.getString(it) } } +
            supplements.flatMap { it.getJSONObject("questions").keys().asSequence().toList() }
        val byFact = HashMap<String, MutableSet<String>>()
        for (card in cards) {
            val cats = card.getJSONArray("cats").let { a -> (0 until a.length()).map { a.getString(it) } }
            val found = catalog.subcategories(LearningEvent("card_viewed", 0, false, card.getString("id")))
            assertEquals(card.getString("id"), cats.map { catalog.labelOf(it) }.distinct(), found.map { catalog.label(it) })
            byFact.getOrPut(card.getString("factId")) { mutableSetOf() }.addAll(cats.map { catalog.labelOf(it)!! })
        }
        for (fact in questions) {
            val found = catalog.subcategories(LearningEvent("quiz_graded", 0, false, questionId = fact))
            assertEquals(fact, byFact.getValue(fact), found.map { catalog.label(it) }.toSet())
        }
        val taxonomy = index.getJSONArray("taxonomy")
        assertTrue(catalog.ids.containsAll((0 until taxonomy.length()).map { taxonomy.getJSONObject(it).getString("id") }))
        assertEquals(listOf("Insects"), catalog.subcategories(LearningEvent("card_viewed", 0, false, "ffct-00000"))
            .map { catalog.label(it) })
        assertTrue(cards.size > 49_000 && questions.size > 25_000)
    }
}
