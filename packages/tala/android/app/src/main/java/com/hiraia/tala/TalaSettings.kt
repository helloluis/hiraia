package com.hiraia.tala

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView

class TalaSettings(
    private val activity: Activity,
    private val database: TalaDatabase,
    private val selectedClassId: String?,
    private val onClassSelected: (String) -> Unit,
    private val onClassesChanged: () -> Unit,
    private val onCheckUpdates: () -> Unit = {}
) {
    private lateinit var dialog: Dialog

    fun show(): Dialog {
        dialog = Dialog(activity)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setContentView(page())
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            attributes = attributes.apply {
                windowAnimations = R.style.TalaSettingsSlide
                gravity = Gravity.START or Gravity.TOP
            }
            setDimAmount(0f)
            navigationBarColor = PAPER
        }
        dialog.show()
        dialog.window?.apply {
            setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
            addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION)
            statusBarColor = INK
            navigationBarColor = PAPER
            isNavigationBarContrastEnforced = false
            decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        return dialog
    }

    private fun refresh() {
        if (dialog.isShowing) dialog.setContentView(page())
    }

    private fun page(): View {
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(22), dp(18), dp(30))
        }
        val header = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(label("Settings", 29f, INK, true), LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(button("×", false) { dialog.dismiss() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        content.addView(header)
        val installed = AppVersion.installed(activity)
        content.addView(label("Tala v${installed.version} · build ${installed.build}", 14f, MUTED, false).apply {
            setTextIsSelectable(true)
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        content.addView(button("Check for app updates", false) { onCheckUpdates() },
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        content.addView(label("Activity uploads", 18f, INK, true),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        content.addView(label(database.activityDeliverySummary(), 13f, MUTED, false))
        content.addView(label("Uploads retry automatically when internet is available. Student names stay on this phone.", 13f, MUTED, false))
        content.addView(label("After reinstalling Tala, create your classes again and have each student scan the new class QR. Updated Hiraia phones restore the card and quiz history still saved on them when they sync.", 13f, MUTED, false),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        content.addView(label("Classes on this phone", 22f, INK, true),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(25); bottomMargin = dp(10) })
        content.addView(label("Tap a class to open its dashboard and QR.", 13f, MUTED, false),
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })

        for (schoolClass in database.classes()) {
            val active = schoolClass.id == selectedClassId
            val card = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(11), dp(14), dp(11))
                background = rounded(if (active) PALE else Color.WHITE, dp(14))
                setOnClickListener {
                    dialog.dismiss()
                    onClassSelected(schoolClass.id)
                }
            }
            val title = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            title.addView(label("${schoolClass.name}${if (active) " · Active" else ""}", 17f, INK, true),
                LinearLayout.LayoutParams(0, -2, 1f))
            title.addView(button("Edit", false) { showClassEditor(schoolClass) })
            card.addView(title)
            card.addView(label("Grade ${schoolClass.gradeLevel} · ${schoolClass.schoolName}", 13f, MUTED, false))
            card.addView(label("${schoolClass.teacherName.ifBlank { "Teacher not set" }} · ${schoolClass.schoolYear}",
                13f, MUTED, false))
            content.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(9) })
        }
        content.addView(button("+ Add class", true) { showClassEditor(null) },
            LinearLayout.LayoutParams(-1, dp(50)).apply { topMargin = dp(5) })

        for ((kind, title, singular) in listOf(
            Triple("teacher", "Teachers", "teacher"),
            Triple("school", "Schools", "school")
        )) {
            val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            row.addView(label(title, 20f, INK, true), LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(button("+ Add", false) { showAddOption(kind, singular) })
            content.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(24) })
            content.addView(label(database.options(kind).joinToString(" · ").ifBlank { "None yet" },
                13f, MUTED, false))
        }
        return ScrollView(activity).apply {
            setBackgroundColor(PAPER)
            isFillViewport = true
            addView(content)
        }
    }

    private fun showAddOption(kind: String, singular: String) {
        val input = EditText(activity).apply {
            hint = "New $singular"
            setSingleLine(true)
            filters = arrayOf(android.text.InputFilter.LengthFilter(80))
            setPadding(dp(20), dp(12), dp(20), dp(12))
        }
        val editor = AlertDialog.Builder(activity).setTitle("Add $singular")
            .setView(input).setNegativeButton("Cancel", null).setPositiveButton("Add", null).create()
        editor.setOnShowListener {
            editor.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val value = input.text.toString().trim()
                if (value.isBlank()) input.error = "Required"
                else {
                    database.addOption(kind, value)
                    editor.dismiss()
                    refresh()
                }
            }
        }
        editor.show()
    }

    private fun showClassEditor(existing: SchoolClass?) {
        val template = existing ?: database.classes().firstOrNull { it.id == selectedClassId }
        val form = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), dp(8))
        }
        // A class name is not optional any more: the student phone shows it instead of an
        // opaque id. New classes open with a colour-animal suggestion the teacher can accept
        // or type over, so the common path needs no typing and the field is never empty.
        val className = field(form, "Class name", existing?.name ?: ClassNames.suggest())
        val teacherName = catalogField(form, "Teacher name", template?.teacherName ?: "", database.options("teacher"))
        val schoolName = catalogField(form, "School name", template?.schoolName ?: "", database.options("school"))
        val gradeLevel = Spinner(activity).apply {
            adapter = ArrayAdapter(activity, android.R.layout.simple_spinner_dropdown_item,
                (1..12).map(Int::toString))
            setSelection(((template?.gradeLevel?.toIntOrNull() ?: 6) - 1).coerceIn(0, 11))
        }
        form.addView(label("Grade level", 12f, MUTED, true).apply { setPadding(0, dp(8), 0, 0) })
        form.addView(gradeLevel)
        val schoolYear = field(form, "School year", template?.schoolYear ?: "2026–2027")
        val editor = AlertDialog.Builder(activity)
            .setTitle(if (existing == null) "Add class" else "Edit class")
            .setView(ScrollView(activity).apply { addView(form) })
            .setNegativeButton("Cancel", null)
            .setPositiveButton(if (existing == null) "Create" else "Save", null).create()
        editor.setOnShowListener {
            editor.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val required = listOf(teacherName, schoolName, schoolYear)
                val missing = required.firstOrNull { it.text.toString().trim().isEmpty() }
                if (missing != null) {
                    missing.error = "Required"
                    return@setOnClickListener
                }
                if (existing == null) {
                    // Blank only if the teacher cleared the suggestion: fall back rather than refuse.
                    val typed = className.text.toString().trim()
                    val schoolClass = database.createClass(
                        typed.ifEmpty { ClassNames.suggest() }, teacherName.text.toString(),
                        schoolName.text.toString(),
                        gradeLevel.selectedItem.toString(), schoolYear.text.toString()
                    )
                    editor.dismiss()
                    dialog.dismiss()
                    onClassSelected(schoolClass.id)
                } else {
                    database.updateClass(existing.id,
                        className.text.toString().trim().ifEmpty { ClassNames.forClass(existing.enrollmentId) },
                        teacherName.text.toString(),
                        schoolName.text.toString(), gradeLevel.selectedItem.toString(), schoolYear.text.toString())
                    editor.dismiss()
                    refresh()
                    onClassesChanged()
                }
            }
        }
        editor.show()
    }

    private fun field(form: LinearLayout, hint: String, value: String): EditText = EditText(activity).apply {
        this.hint = hint
        setText(value)
        setSingleLine(true)
        filters = arrayOf(android.text.InputFilter.LengthFilter(80))
        form.addView(label(hint, 12f, MUTED, true).apply { setPadding(0, dp(8), 0, 0) })
        form.addView(this)
    }

    private fun catalogField(form: LinearLayout, hint: String, value: String,
        options: List<String>): AutoCompleteTextView = AutoCompleteTextView(activity).apply {
        this.hint = hint
        setText(value)
        setSingleLine(true)
        filters = arrayOf(android.text.InputFilter.LengthFilter(80))
        setAdapter(ArrayAdapter(activity, android.R.layout.simple_dropdown_item_1line, options))
        threshold = 0
        setOnClickListener { showDropDown() }
        form.addView(label(hint, 12f, MUTED, true).apply { setPadding(0, dp(8), 0, 0) })
        form.addView(this)
    }

    private fun label(value: String, size: Float, color: Int, bold: Boolean): TextView = TextView(activity).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

    private fun button(value: String, filled: Boolean, action: () -> Unit): TextView =
        label(value, 14f, if (filled) Color.WHITE else TEAL, true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(9), dp(12), dp(9), dp(12))
            background = rounded(if (filled) TEAL else PALE, dp(12))
            setOnClickListener { action() }
        }

    private fun rounded(color: Int, radius: Int): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius.toFloat()
    }

    private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density + 0.5f).toInt()

    companion object {
        private val PAPER = 0xFFF6F4EC.toInt()
        private val INK = 0xFF173F3D.toInt()
        private val TEAL = 0xFF087A78.toInt()
        private val PALE = 0xFFDDF0EE.toInt()
        private val MUTED = 0xFF667872.toInt()
    }
}
