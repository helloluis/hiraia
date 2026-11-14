package expo.modules.talaactivity

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.StringReader

/** Tala 0.4.4's CardCatalogTest (branch tala-0.4.x), against the copied parser. */
class CardCatalogTest {
    private val catalog = CardCatalog.parse(StringReader(FIXTURE))

    @Test
    fun cardViewsResolveByCardId() {
        assertArrayEquals(intArrayOf(1), catalog.subcategories("card_viewed", "ffct-00001", ""))
        assertArrayEquals(intArrayOf(1, 2), catalog.subcategories("card_viewed", "ffct-00002", ""))
        assertEquals(listOf("Insects", "Mammals"), catalog.subcategoryLabels("card_viewed", "ffct-00002", ""))
        assertEquals("Insects", catalog.label(1))
        assertEquals("Weather Types", catalog.label(0))
    }

    @Test
    fun quizzesResolveByTheirFactEvenWhenLegacyHistoryCarriesItAsCardId() {
        assertArrayEquals(intArrayOf(0, 2), catalog.subcategories("quiz_graded", "", "storm-g4"))
        assertArrayEquals(intArrayOf(1), catalog.subcategories("quiz_graded", "butterfly-g5", ""))
        assertArrayEquals(intArrayOf(0, 2), catalog.subcategories("quiz_graded", "x", "storm-g4"))
    }

    @Test
    fun whatCannotBePlacedHasNoSubcategory() {
        assertEquals(0, catalog.subcategories("card_viewed", "", "").size)
        assertEquals(0, catalog.subcategories("card_viewed", "ffct-99999", "").size)
        assertEquals(0, catalog.subcategories("quiz_graded", "", "ffct-00001").size)
        assertEquals(0, catalog.subcategories("card_viewed", "butterfly-g5", "").size)
        assertEquals(0, catalog.subcategories("session_started", "ffct-00001", "").size)
    }

    @Test
    fun taxonomyIdsThatPrintTheSameLabelAreOneSubcategory() {
        assertArrayEquals(intArrayOf(0), catalog.subcategories("card_viewed", "dcard-00005", ""))
        assertArrayEquals(intArrayOf(0), catalog.subcategories("card_viewed", "dcard-00003", ""))
        assertEquals("Weather Types", catalog.labelOf("g4-weather"))
        assertEquals("Weather Types", catalog.labelOf("weather"))
        assertEquals(setOf("g4-weather", "insects", "mammals", "weather"), catalog.ids)
        assertEquals(8, catalog.size)
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

    @Test
    fun theRealCatalogParsesWhenSynced() {
        val file = listOf("../src/main/assets/card-catalog.tsv", "src/main/assets/card-catalog.tsv").map(::File).firstOrNull { it.exists() }
            ?: return // synced by scripts/sync-card-catalog.mjs at build time
        val real = file.reader().use(CardCatalog::parse)
        assertTrue(real.size > 70_000)
        assertTrue(real.labels().isNotEmpty())
    }

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
