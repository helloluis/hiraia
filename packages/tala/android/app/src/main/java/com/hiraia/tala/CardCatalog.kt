package com.hiraia.tala

import android.content.Context
import java.io.BufferedReader
import java.io.Reader
import java.util.IdentityHashMap

/**
 * Which subcategories a card or quiz question belongs to — the pills on the student app's
 * calendar — read from assets/card-catalog.tsv, which packages/tala/scripts/build-card-catalog.py
 * generates from the student app's card index.
 *
 * The lookup lives in Tala rather than in the events because there are far more student
 * installs than Tala installs: an old student build keeps reporting bare ids for as long as it
 * is in the field, and only Tala can be updated cheaply. The catalog only ever grows for the
 * same reason, so a card retired from the inventory still resolves.
 */
class CardCatalog private constructor(
    private val labels: List<String>,
    private val labelOfId: Map<String, Int>,
    internal val cards: Map<String, IntArray>,
    internal val facts: Map<String, IntArray>
) {
    /**
     * A subcategory here is a LABEL, not a taxonomy id. Several ids print the same pill —
     * "States of Matter" is a generic leaf and two grade-level ones — and a teacher shown three
     * identical rows with the counts split between them could not tell them apart.
     */
    fun label(subcategory: Int): String = labels[subcategory]

    internal val ids: Set<String> get() = labelOfId.keys

    internal fun labelOf(id: String): String? = labelOfId[id]?.let(labels::get)

    /**
     * The subcategories a learning event was about, or none when it cannot be placed: a card
     * the model wrote on the phone has no id, and a card newer than this catalog is unknown.
     * A graded quiz names its question's fact in question_id; history an install recorded
     * before it paired with Tala is rebuilt with that same fact id in card_id instead.
     */
    fun subcategories(event: LearningEvent): IntArray = when (event.name) {
        "card_viewed" -> cards[event.cardId]
        "quiz_graded" -> facts[event.questionId] ?: facts[event.cardId]
        else -> null
    } ?: NONE

    companion object {
        const val ASSET = "card-catalog.tsv"
        private val NONE = IntArray(0)

        @Volatile private var shared: CardCatalog? = null

        /** Parsed once per process; MainActivity warms it off the main thread at launch. */
        fun get(context: Context): CardCatalog = shared ?: synchronized(this) {
            shared ?: context.applicationContext.assets.open(ASSET).reader().use(::parse)
                .also { shared = it }
        }

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
            // Parsed by hand, not split(): this is ~75,000 lines on a teacher's phone.
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
