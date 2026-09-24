package com.hiraia.tala

import android.app.AlertDialog
import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.DateFormat
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs

class StudentCarousel(
    context: Context,
    private val database: TalaDatabase,
    private val roster: List<RosterCard>,
    private var index: Int,
    private val onRemoved: () -> Unit = {},
    private val status: (StudentRow) -> Pair<String, Int>
) : Dialog(context) {
    private lateinit var pages: FrameLayout
    private lateinit var position: TextView
    private lateinit var previous: TextView
    private lateinit var next: TextView
    private var downX = 0f
    private var downY = 0f
    private var animating = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.setBackgroundDrawableResource(android.R.color.transparent)
        window?.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window?.setDimAmount(0.58f)

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(PAPER, 23)
        }
        val top = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(11), dp(11), dp(5))
        }
        top.addView(label("STUDENT ACTIVITY", 12f, TEAL, true),
            LinearLayout.LayoutParams(0, -2, 1f))
        position = label("", 13f, MUTED, true)
        top.addView(position)
        top.addView(label("×", 29f, INK, false).apply {
            gravity = Gravity.CENTER
            contentDescription = "Close student activity"
            setOnClickListener { dismiss() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(top)

        pages = FrameLayout(context).apply { clipChildren = true }
        root.addView(pages, LinearLayout.LayoutParams(-1, 0, 1f))

        val navigation = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(7), dp(16), dp(13))
        }
        previous = navigationButton("← Previous") { navigate(-1) }
        next = navigationButton("Next →") { navigate(1) }
        navigation.addView(previous, LinearLayout.LayoutParams(0, dp(46), 1f).apply {
            rightMargin = dp(8)
        })
        navigation.addView(next, LinearLayout.LayoutParams(0, dp(46), 1f))
        root.addView(navigation)
        setContentView(root)
        pages.addView(page(roster[index]), FrameLayout.LayoutParams(-1, -1))
        updateNavigation()
    }

    override fun onStart() {
        super.onStart()
        window?.setLayout(context.resources.displayMetrics.widthPixels - dp(24),
            context.resources.displayMetrics.heightPixels - dp(64))
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x
                downY = event.y
            }
            MotionEvent.ACTION_UP -> {
                val horizontal = event.x - downX
                val vertical = event.y - downY
                if (abs(horizontal) > dp(65) && abs(horizontal) > abs(vertical) * 1.4f) {
                    navigate(if (horizontal < 0) 1 else -1)
                    return true
                }
            }
        }
        return super.dispatchTouchEvent(event)
    }

    private fun navigate(direction: Int) {
        val target = index + direction
        if (animating || target !in roster.indices) return
        val current = pages.getChildAt(0)
        val incoming = page(roster[target])
        val width = pages.width.toFloat().coerceAtLeast(1f)
        incoming.translationX = direction * width
        pages.addView(incoming, FrameLayout.LayoutParams(-1, -1))
        animating = true
        current.animate().translationX(-direction * width).setDuration(220).start()
        incoming.animate().translationX(0f).setDuration(220).withEndAction {
            pages.removeView(current)
            index = target
            animating = false
            updateNavigation()
        }.start()
    }

    private fun updateNavigation() {
        position.text = "${index + 1} / ${roster.size}"
        previous.isEnabled = index > 0
        next.isEnabled = index < roster.lastIndex
        previous.alpha = if (previous.isEnabled) 1f else 0.4f
        next.alpha = if (next.isEnabled) 1f else 0.4f
    }

    private fun page(card: RosterCard): View {
        val student = card.student
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(2), dp(18), dp(20))
        }
        val icon = label(RosterIdentity.animals[card.animalIndex], 43f, INK, false).apply {
            gravity = Gravity.CENTER
            background = rounded(RosterIdentity.colors[card.colorIndex], 25)
        }
        content.addView(icon, LinearLayout.LayoutParams(dp(80), dp(80)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(4)
        })
        content.addView(label(card.displayName, 25f, INK, true).apply {
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        val (state, stateColor) = status(student)
        content.addView(label("● $state", 14f, stateColor, true).apply {
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(3) })

        section(content, "Overview")
        val lastSeen = if (student.lastSeen > 0) formatted(student.lastSeen) else "Never"
        val lastSync = if (student.lastSync > 0) formatted(student.lastSync) else "Never"
        tableHeader(content, "Measure", "Value")
        tableRow(content, "Last connection", lastSeen, false)
        tableRow(content, "Last transfer", lastSync, true)
        tableRow(content, "Stored events", student.events.toString(), false)
        tableRow(content, "Cards viewed", student.cards.toString(), true)
        tableRow(content, "Unique cards", database.uniqueCards(student).toString(), false)
        tableRow(content, "Quiz answers", student.quizzes.toString(), true)
        tableRow(content, "Correct answers", student.correct.toString(), false)
        tableRow(content, "Device failures", student.failures.toString(), true)
        tableRow(content, "Last batch accepted", student.lastAccepted.toString(), false)
        tableRow(content, "Last batch rejected", student.lastRejected.toString(), true)

        section(content, "Learning activity")
        val periods = SchoolPeriods.around(LocalDate.now(), ZoneId.systemDefault())
        val events = database.learningEvents(student, periods.minOf { it.start }, periods.maxOf { it.end })
        val totals = periods.map { period ->
            ActivityTotals.of(events.filter { it.occurredAt >= period.start && it.occurredAt < period.end })
        }
        periodHeader(content, periods)
        periodRow(content, "Total viewed", totals.map { it.viewed.toString() }, false)
        periodRow(content, "Unique viewed", totals.map { it.unique.toString() }, true)
        periodRow(content, "Quizzes taken", totals.map { it.quizzes.toString() }, false)
        periodRow(content, "Quizzes correct", totals.map { it.correct.toString() }, true)
        note(content, "Counted by when the student did it. A phone that has not connected " +
            "since may still add to these. School days are Monday to Friday; holidays are not skipped.")

        section(content, "By day")
        val catalog = CardCatalog.get(context)
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val days = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        content.addView(days)
        var before = Long.MAX_VALUE
        lateinit var earlier: TextView
        val load = {
            val page = database.learningDays(student, before, DAYS_PER_PAGE, zone)
            for ((date, dayEvents) in page) dayBlock(days, DayActivity.of(date, dayEvents, catalog), today)
            page.lastOrNull()?.let { before = it.first.atStartOfDay(zone).toInstant().toEpochMilli() }
            if (page.isEmpty() && days.childCount == 0)
                days.addView(label("No cards viewed or quizzes answered yet.", 13f, MUTED, false))
            earlier.visibility = if (database.latestLearningBefore(student, before) != null) View.VISIBLE else View.GONE
        }
        earlier = navigationButton("Show earlier days") { load() }
        content.addView(earlier, LinearLayout.LayoutParams(-1, dp(46)).apply { topMargin = dp(12) })
        load()
        note(content, "A card in two subcategories is listed under both.")
        content.addView(navigationButton("Remove from class") { confirmRemove(card) }.apply {
            setTextColor(DANGER)
            background = rounded(DANGER_PALE, 12)
        }, LinearLayout.LayoutParams(-1, dp(46)).apply { topMargin = dp(32) })
        return ScrollView(context).apply {
            isFillViewport = false
            addView(content)
        }
    }

    private fun confirmRemove(card: RosterCard) {
        // A 'guest' row is the placeholder older student builds made for Guest activity. Removing
        // it is not sticky against the phone's Guest later joining this class for real.
        val after = if (card.student.profileId == "guest")
            "If a student on that phone later joins this class as Guest, they appear again as a new tile."
        else "If their phone syncs again, Tala ignores their activity; other students on the same " +
            "phone are not affected. This cannot be undone."
        AlertDialog.Builder(context).setTitle("Remove ${card.displayName} from this class?")
            .setMessage("Their activity is deleted from Tala, and they no longer appear in this class " +
                "or its spreadsheet. $after")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Remove") { _, _ ->
                database.removeStudent(card.student)
                dismiss()
                onRemoved()
            }
            .show()
    }

    private fun section(parent: LinearLayout, title: String) {
        parent.addView(label(title, 18f, INK, true), LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(24)
            bottomMargin = dp(10)
        })
    }

    private fun tableHeader(parent: LinearLayout, first: String, second: String) {
        tableRow(parent, first, second, false, true)
    }

    private fun tableRow(parent: LinearLayout, first: String, second: String, shaded: Boolean,
        heading: Boolean = false) {
        val row = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(9), dp(10), dp(9))
            setBackgroundColor(if (heading) PALE else if (shaded) SHADE else Color.WHITE)
        }
        row.addView(label(first, if (heading) 12f else 13f, if (heading) TEAL else MUTED, heading),
            LinearLayout.LayoutParams(0, -2, 0.43f))
        row.addView(label(second, if (heading) 12f else 13f, INK, heading).apply {
            gravity = Gravity.END
        }, LinearLayout.LayoutParams(0, -2, 0.57f))
        parent.addView(row, LinearLayout.LayoutParams(-1, -2))
    }

    private fun periodHeader(parent: LinearLayout, periods: List<SchoolPeriod>) {
        // Bottom-aligned so the dates share one line however many lines each name wraps to.
        val row = periodRowLayout(PALE).apply { gravity = Gravity.BOTTOM }
        row.addView(label("", 12f, TEAL, true), LinearLayout.LayoutParams(0, -2, MEASURE_WEIGHT))
        for (period in periods) row.addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(label(period.label, 12f, TEAL, true).apply { gravity = Gravity.END })
            addView(label(period.dates, 11f, MUTED, false).apply { gravity = Gravity.END })
        }, LinearLayout.LayoutParams(0, -2, PERIOD_WEIGHT).apply { leftMargin = dp(6) })
        parent.addView(row, LinearLayout.LayoutParams(-1, -2))
    }

    private fun periodRow(parent: LinearLayout, measure: String, values: List<String>, shaded: Boolean) {
        val row = periodRowLayout(if (shaded) SHADE else Color.WHITE)
        row.addView(label(measure, 13f, MUTED, false), LinearLayout.LayoutParams(0, -2, MEASURE_WEIGHT))
        for (value in values) row.addView(label(value, 15f, INK, true).apply {
            gravity = Gravity.END
        }, LinearLayout.LayoutParams(0, -2, PERIOD_WEIGHT).apply { leftMargin = dp(6) })
        parent.addView(row, LinearLayout.LayoutParams(-1, -2))
    }

    private fun dayBlock(parent: LinearLayout, day: DayActivity, today: LocalDate) {
        val heading = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(9), dp(10), dp(9))
            setBackgroundColor(PALE)
        }
        val pattern = if (day.date.year == today.year) "EEEE d MMM" else "EEEE d MMM yyyy"
        heading.addView(label(day.date.format(DateTimeFormatter.ofPattern(pattern)), 15f, INK, true),
            LinearLayout.LayoutParams(0, -2, 1f))
        when (day.date) {
            today -> "Today"
            today.minusDays(1) -> "Yesterday"
            else -> null
        }?.let { heading.addView(label(it, 12f, TEAL, true)) }
        parent.addView(heading, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        // With one subcategory the day's totals ARE that subcategory's; saying it twice is noise.
        if (day.subcategories.size > 1) parent.addView(label(day.totals.describe(), 13f, INK, false).apply {
            setPadding(dp(10), dp(8), dp(10), dp(8))
            setBackgroundColor(Color.WHITE)
        }, LinearLayout.LayoutParams(-1, -2))
        day.subcategories.forEachIndexed { index, subcategory ->
            parent.addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(22), dp(8), dp(10), dp(9))
                setBackgroundColor(if (index % 2 == 0) SHADE else Color.WHITE)
                addView(label(subcategory.label, 14f, INK, true))
                addView(label(subcategory.totals.describe(), 12f, MUTED, false))
            }, LinearLayout.LayoutParams(-1, -2))
        }
    }

    private fun note(parent: LinearLayout, text: String) {
        parent.addView(label(text, 12f, MUTED, false), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
    }

    private fun periodRowLayout(color: Int): LinearLayout = LinearLayout(context).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(10), dp(9), dp(10), dp(9))
        setBackgroundColor(color)
    }

    private fun navigationButton(text: String, action: () -> Unit): TextView = label(text, 14f, TEAL, true).apply {
        gravity = Gravity.CENTER
        background = rounded(PALE, 12)
        setOnClickListener { action() }
    }

    private fun label(text: String, size: Float, color: Int, bold: Boolean): TextView = TextView(context).apply {
        this.text = text
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

    private fun rounded(color: Int, radius: Int): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }

    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density + 0.5f).toInt()

    private fun formatted(timestamp: Long): String = DateFormat.getDateTimeInstance(
        DateFormat.SHORT, DateFormat.SHORT).format(timestamp)

    companion object {
        private const val MEASURE_WEIGHT = 0.37f
        private const val PERIOD_WEIGHT = 0.21f
        /** About a school week of active days; older ones load on request. */
        private const val DAYS_PER_PAGE = 5
        private val PAPER = 0xFFF6F4EC.toInt()
        private val SHADE = 0xFFF0F2ED.toInt()
        private val INK = 0xFF173F3D.toInt()
        private val TEAL = 0xFF087A78.toInt()
        private val PALE = 0xFFDDF0EE.toInt()
        private val MUTED = 0xFF667872.toInt()
        private val DANGER = 0xFFAD514B.toInt()
        private val DANGER_PALE = 0xFFF7E3E0.toInt()
    }
}
