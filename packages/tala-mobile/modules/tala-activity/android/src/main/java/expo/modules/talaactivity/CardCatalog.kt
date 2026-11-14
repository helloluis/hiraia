package expo.modules.talaactivity

import java.io.BufferedReader
import java.io.Reader
import java.util.IdentityHashMap

/**
 * Which subcategories a card or quiz question belongs to — the pills on the student app's
 * calendar — read from assets/card-catalog.tsv, which is Tala 0.4.x's generated, append-only
 * catalog copied from the tala-0.4.x branch at build time (scripts/sync-card-catalog.mjs).
 *
 * Copied from packages/tala/android/app/src/main/java/com/hiraia/tala/CardCatalog.kt (0.4.4) with
 * the Android asset loading moved to the module. Parsing stays native: ~75,000 lines on a
 * teacher's phone, parsed once and kept in native memory, so the JS bundle and heap carry none of it.
 *
 * A subcategory here is a LABEL, not a taxonomy id: several ids print the same pill ("States of
 * Matter" is three) and a teacher shown three identical rows could not tell them apart.
 */
class CardCatalog private constructor(
    private val labels: List<String>,
    private val labelOfId: Map<String, Int>,
    internal val cards: Map<String, IntArray>,
    internal val facts: Map<String, IntArray>
) {
    val size: Int get() = cards.size + facts.size

    fun label(subcategory: Int): String = labels[subcategory]

    fun labels(): List<String> = labels

    internal val ids: Set<String> get() = labelOfId.keys

    internal fun labelOf(id: String): String? = labelOfId[id]?.let(labels::get)

    /**
     * The subcategory indexes a learning event was about, or none when it cannot be placed: a card
     * the model wrote on the phone has no id, and a card newer than this catalog is unknown. A
     * graded quiz names its question's fact in question_id; history an install recorded before it
     * paired with Tala is rebuilt with that same fact id in card_id instead.
     */
    fun subcategories(name: String, cardId: String, questionId: String): IntArray = when (name) {
        "card_viewed" -> cards[cardId]
        "quiz_graded" -> facts[questionId] ?: facts[cardId]
        else -> null
    } ?: NONE

    fun subcategoryLabels(name: String, cardId: String, questionId: String): List<String> =
        subcategories(name, cardId, questionId).map(labels::get)

    companion object {
        const val ASSET = "card-catalog.tsv"
        private val NONE = IntArray(0)

        fun parse(input: Reader): CardCatalog {
            val labels = mutableListOf<String>()
            val labelIndex = HashMap<String, Int>()
            val labelOfLine = mutableListOf<Int>()
            val labelOfId = HashMap<String, Int>()
            val cards = HashMap<String, IntArray>(1 shl 17)
            val facts = HashMap<String, IntArray>(1 shl 16)
            // Most cards share one of a few thousand subcategory combinations; keep one array each,
            // holding T line numbers until every T line has been read.
            val combinations = HashMap<String, IntArray>()
            val reader = input as? BufferedReader ?: BufferedReader(input, 1 shl 16)
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty() || line[0] == '#') continue
                val second = line.indexOf('\t', 2)
                require(line.length > 2 && line[1] == '\t' && second > 2 && second < line.length - 1 &&
                    line.indexOf('\t', second + 1) < 0) { "Malformed card catalog line: $line" }
                val key = line.substring(2, second)
                val value = line.substring(second + 1)
                when (line[0]) {
                    'T' -> {
                        val label = labelIndex.getOrPut(value) { labels.add(value); labels.lastIndex }
                        labelOfLine.add(label)
                        labelOfId[key] = label
                    }
                    'C', 'F' -> (if (line[0] == 'C') cards else facts)[key] =
                        combinations.getOrPut(value) { value.split(',').map { it.toInt() }.toIntArray() }
                    else -> throw IllegalArgumentException("Unknown card catalog record: $line")
                }
            }
            require(labels.isNotEmpty()) { "Card catalog has no subcategories" }
            require(combinations.values.all { lines -> lines.isNotEmpty() && lines.all { it in labelOfLine.indices } }) {
                "Card catalog names a subcategory it does not define"
            }
            val byLabel = IdentityHashMap<IntArray, IntArray>()
            for (lines in combinations.values) byLabel[lines] = lines.map { labelOfLine[it] }.distinct().toIntArray()
            cards.replaceAll { _, lines -> byLabel.getValue(lines) }
            facts.replaceAll { _, lines -> byLabel.getValue(lines) }
            return CardCatalog(labels, labelOfId, cards, facts)
        }
    }
}
