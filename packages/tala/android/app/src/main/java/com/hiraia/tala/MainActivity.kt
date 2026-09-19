package com.hiraia.tala

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import java.util.Calendar
import kotlin.math.abs

class MainActivity : Activity(), NearbyCollector.Listener {
    private lateinit var database: TalaDatabase
    private var collector: NearbyCollector? = null
    private val manualEnrollment = ManualEnrollment()
    private val preferences by lazy { getSharedPreferences("tala-dashboard-v2", Context.MODE_PRIVATE) }
    private var selectedClassId: String? = null
    private var settingsDialog: Dialog? = null
    private var studentDialog: Dialog? = null
    private var issuePickerCallback: ((List<Uri>) -> Unit)? = null
    private var collecting = false
    private var status = "Collection paused"
    private var nearbyCount = 0
    private var qrCollectionStatus: TextView? = null
    private var lastTransferSummary: String? = null
    private var tutorialVisible = false
    private var tutorialPage = 0
    private val live = mutableMapOf<String, SyncState>()
    private val classSwipe by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(event: MotionEvent): Boolean = true

            override fun onFling(first: MotionEvent?, second: MotionEvent, velocityX: Float,
                velocityY: Float): Boolean {
                if (first == null) return false
                val horizontal = second.x - first.x
                val vertical = second.y - first.y
                if (abs(horizontal) < dp(70) || abs(horizontal) < abs(vertical) * 1.5f ||
                    abs(velocityX) < dp(300)) return false
                moveClass(if (horizontal < 0) 1 else -1)
                return true
            }
        })
    }
    private val tutorialSwipe by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(event: MotionEvent): Boolean = true

            override fun onFling(first: MotionEvent?, second: MotionEvent, velocityX: Float,
                velocityY: Float): Boolean {
                if (first == null) return false
                val horizontal = second.x - first.x
                val vertical = second.y - first.y
                if (abs(horizontal) < dp(60) || abs(horizontal) < abs(vertical) * 1.5f ||
                    abs(velocityX) < dp(250)) return false
                moveTutorial(if (horizontal < 0) 1 else -1)
                return true
            }
        })
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = INK
        window.navigationBarColor = PAPER
        database = TalaDatabase(this)
        val classes = database.classes()
        selectedClassId = preferences.getString("class_id", null)?.takeIf { id -> classes.any { it.id == id } }
            ?: classes.first().id
        tutorialVisible = !preferences.getBoolean(TUTORIAL_COMPLETE, false)
        if (tutorialVisible) renderTutorial() else render()
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (tutorialVisible) tutorialSwipe.onTouchEvent(event)
        else if (settingsDialog?.isShowing != true && studentDialog?.isShowing != true)
            classSwipe.onTouchEvent(event)
        return super.dispatchTouchEvent(event)
    }

    override fun onResume() {
        super.onResume()
        if (tutorialVisible) return
        render()
        if (database.pendingIssueCount() > 0) IssueUploader.schedule(this)
        if (collecting && permissionsGranted()) collector?.start()
    }

    override fun onPause() {
        collector?.stop()
        live.entries.removeAll { it.value != SyncState.ERROR_CONNECTING && it.value != SyncState.ERROR_TRANSFER }
        super.onPause()
    }

    override fun onDestroy() {
        settingsDialog?.dismiss()
        studentDialog?.dismiss()
        collector?.close()
        database.close()
        super.onDestroy()
    }

    override fun onStatus(message: String, connections: Int) {
        status = message
        nearbyCount = connections
        qrCollectionStatus?.text = message
        if (!tutorialVisible) render()
    }

    override fun onAdvertisingFailed(message: String) {
        collecting = false
        status = message
        nearbyCount = 0
        qrCollectionStatus?.text = message
        if (!tutorialVisible) render()
    }

    override fun onConnected(installationId: String) {
        live[liveKey(installationId)] = SyncState.CONNECTED
        if (!tutorialVisible) render()
    }

    override fun onTransfer(installationId: String) {
        live[liveKey(installationId)] = SyncState.TRANSFERRING
        if (!tutorialVisible) render()
    }

    override fun onSaved(installationId: String, accepted: Int, rejected: Int) {
        live[liveKey(installationId)] = SyncState.SYNCED
        lastTransferSummary = "Last batch: $accepted accepted · $rejected rejected"
        if (!tutorialVisible) render()
    }

    override fun onFailure(installationId: String?, duringTransfer: Boolean) {
        if (installationId != null) live[liveKey(installationId)] =
            if (duringTransfer) SyncState.ERROR_TRANSFER else SyncState.ERROR_CONNECTING
        status = if (duringTransfer) "A transfer failed; the student can retry."
            else "A student could not connect; ask them to retry."
        qrCollectionStatus?.text = status
        if (!tutorialVisible) render()
    }

    override fun onDisconnected(installationId: String) {
        val key = liveKey(installationId)
        if (live[key] != SyncState.ERROR_CONNECTING && live[key] != SyncState.ERROR_TRANSFER)
            live.remove(key)
        if (!tutorialVisible) render()
    }

    private fun liveKey(installationId: String): String = "$selectedClassId:$installationId"

    private fun selectClass(classId: String) {
        if (classId != selectedClassId) {
            studentDialog?.dismiss()
            collecting = false
            collector?.close()
            collector = null
            manualEnrollment.clear()
            live.clear()
            lastTransferSummary = null
            status = "Collection paused"
            nearbyCount = 0
        }
        selectedClassId = classId
        preferences.edit().putString("class_id", classId).remove("group_id").apply()
        render()
    }

    private fun moveClass(direction: Int) {
        val classes = database.classes()
        val index = classes.indexOfFirst { it.id == selectedClassId }
        val next = index + direction
        if (next in classes.indices) selectClass(classes[next].id)
    }

    private fun moveTutorial(direction: Int) {
        val next = (tutorialPage + direction).coerceIn(0, TUTORIAL_PAGES.lastIndex)
        if (next != tutorialPage) {
            tutorialPage = next
            renderTutorial()
        }
    }

    private fun completeTutorial() {
        preferences.edit().putBoolean(TUTORIAL_COMPLETE, true).apply()
        tutorialVisible = false
        render()
    }

    private fun renderTutorial() {
        val step = TUTORIAL_PAGES[tutorialPage]
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(PAPER)
            setPadding(dp(24), dp(22), dp(24), dp(28))
        }
        root.addView(label("HIRAIA  /  TALA", 14f, TEAL, true))
        root.addView(label("${tutorialPage + 1} of ${TUTORIAL_PAGES.size}", 13f, MUTED, false),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(5) })

        val illustration = ImageView(this).apply {
            setImageResource(step.imageRes)
            contentDescription = step.imageDescription
            scaleType = ImageView.ScaleType.FIT_CENTER
            adjustViewBounds = true
        }
        root.addView(illustration, LinearLayout.LayoutParams(-1, 0, 1f).apply {
            topMargin = dp(12)
            bottomMargin = dp(14)
        })
        root.addView(label(step.title, 25f, INK, true))
        root.addView(label(step.message, 15f, MUTED, false).apply {
            setLineSpacing(dp(3).toFloat(), 1f)
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(7) })
        root.addView(label("Swipe to continue", 12f, MUTED, false),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })

        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        if (tutorialPage > 0) controls.addView(button("Back", false) { moveTutorial(-1) },
            LinearLayout.LayoutParams(0, dp(50), 0.42f).apply { rightMargin = dp(8) })
        controls.addView(button(if (tutorialPage == TUTORIAL_PAGES.lastIndex) "Get Started" else "Next", true) {
            if (tutorialPage == TUTORIAL_PAGES.lastIndex) completeTutorial() else moveTutorial(1)
        }, LinearLayout.LayoutParams(0, dp(50), if (tutorialPage > 0) 0.58f else 1f))
        root.addView(controls, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(15) })
        setContentView(root)
    }

    private fun startCollection() {
        val schoolClass = database.classes().firstOrNull { it.id == selectedClassId }
        if (schoolClass == null) {
            showCollectionStatus("Select a class before collecting.")
            return
        }
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) != ConnectionResult.SUCCESS) {
            showCollectionStatus("Google Play services is required for Nearby Connections.")
            return
        }
        if (!permissionsGranted()) {
            showCollectionStatus("Allow Nearby devices to collect activity.")
            requestPermissions(requiredPermissions().filter {
                checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
            }.toTypedArray(), PERMISSION_REQUEST)
            return
        }
        val bluetooth = getSystemService(BluetoothManager::class.java).adapter
        if (bluetooth == null) {
            showCollectionStatus("This phone does not support Bluetooth.")
            return
        }
        if (!bluetooth.isEnabled) {
            showCollectionStatus("Turn on Bluetooth to collect activity.")
            startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), BLUETOOTH_REQUEST)
            return
        }
        collecting = true
        if (collector == null) collector = NearbyCollector(
            this, ClassIdentity(this, schoolClass.enrollmentId), database, manualEnrollment, this
        )
        collector?.start()
        render()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST && permissionsGranted()) startCollection()
        else if (requestCode == PERMISSION_REQUEST) {
            showCollectionStatus("Nearby permission was denied. Allow it in Android Settings, then retry.")
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == BLUETOOTH_REQUEST) {
            if (resultCode == RESULT_OK) startCollection()
            else showCollectionStatus("Bluetooth is off. Turn it on, then retry collection.")
        }
        if (requestCode == ISSUE_MEDIA_REQUEST && resultCode == RESULT_OK) {
            val selected = mutableListOf<Uri>()
            data?.data?.let { selected.add(it) }
            data?.clipData?.let { clips ->
                for (index in 0 until clips.itemCount) selected.add(clips.getItemAt(index).uri)
            }
            issuePickerCallback?.invoke(selected.distinct())
        }
    }

    private fun showCollectionStatus(message: String) {
        status = message
        qrCollectionStatus?.text = message
        render()
    }

    private fun permissionsGranted(): Boolean = requiredPermissions().all {
        checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
    }

    private fun requiredPermissions(): Array<String> {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 31) {
            permissions.add(Manifest.permission.BLUETOOTH_ADVERTISE)
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            permissions.add(Manifest.permission.BLUETOOTH_SCAN)
        }
        if (Build.VERSION.SDK_INT <= 31) permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        return permissions.toTypedArray()
    }

    private fun render() {
        val classes = database.classes()
        val schoolClass = classes.first { it.id == selectedClassId }
        val students = database.students(schoolClass.id)
        val roster = database.rosterCards(schoolClass, students)
        val today = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        val syncedToday = students.count { it.lastSync >= today }
        val totalQuizzes = students.sumOf { it.quizzes }
        val totalCorrect = students.sumOf { it.correct }
        val scroll = ScrollView(this).apply { setBackgroundColor(PAPER); isFillViewport = true }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(22), dp(18), dp(30))
        }
        scroll.addView(page)

        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(label("HIRAIA  /  TALA", 14f, TEAL, true), LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(button("☰ Settings", false) { showSettings() })
        page.addView(header)
        page.addView(label(greeting(schoolClass.teacherName), 26f, INK, true),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        page.addView(label("Active classroom", 12f, MUTED, true),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) })
        page.addView(label("${schoolClass.name} (${students.size})", 22f, INK, true).apply {
            contentDescription = "Active classroom: ${schoolClass.name}, ${students.size} students"
            setPadding(dp(12), dp(9), dp(12), dp(9))
            background = rounded(PALE_YELLOW, dp(12))
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) })
        page.addView(label("${shortLabel(schoolClass.schoolName, 18)} - " +
            "${schoolClass.schoolYear.replace('–', '-')} - Grade ${schoolClass.gradeLevel}",
            14f, MUTED, false), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(3) })
        if (classes.size > 1) page.addView(label(
            "Swipe to switch classes · ${classes.indexOfFirst { it.id == schoolClass.id } + 1}/${classes.size}",
            12f, MUTED, false), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) })

        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        controls.addView(button(if (collecting) "Pause collection" else "Collect activity", true) {
            if (collecting) {
                collecting = false
                collector?.stop()
                render()
            } else startCollection()
        }, LinearLayout.LayoutParams(0, dp(50), 1f).apply { rightMargin = dp(8) })
        controls.addView(button("Show QR Code", false) { showQr() }, LinearLayout.LayoutParams(0, dp(50), 0.68f))
        page.addView(controls, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        page.addView(label(
            "For best results, please stay within the same room as your students when collecting their Hiraia activity.",
            13f, INK, true
        ).apply {
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = rounded(PALE_YELLOW, dp(12))
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        page.addView(label(
            "$status${if (collecting) " · $nearbyCount connected" else ""}", 13f, MUTED, false
        ).apply { setPadding(0, dp(10), 0, dp(14)) })
        lastTransferSummary?.let { page.addView(label(it, 13f, TEAL, true).apply {
            setPadding(0, 0, 0, dp(12))
        }) }

        val metrics = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        metrics.addView(metric("Students", "${students.size}"), LinearLayout.LayoutParams(0, dp(92), 1f).apply { rightMargin = dp(7) })
        metrics.addView(metric("Synced today", "$syncedToday"), LinearLayout.LayoutParams(0, dp(92), 1f).apply { rightMargin = dp(7) })
        metrics.addView(metric("Quiz correct", if (totalQuizzes == 0) "—" else "$totalCorrect/$totalQuizzes"), LinearLayout.LayoutParams(0, dp(92), 1f))
        page.addView(metrics)
        page.addView(label("${database.eventCount(schoolClass.id)} activity events stored", 13f, MUTED, false).apply {
            setPadding(0, dp(10), 0, 0)
        })

        val classroomHeader = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        classroomHeader.addView(label("Classroom", 22f, INK, true),
            LinearLayout.LayoutParams(0, -2, 1f))
        classroomHeader.addView(button("↗ Share XLSX", false) { confirmShareClass(schoolClass) })
        page.addView(classroomHeader, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        if (roster.isEmpty()) page.addView(label(
            "No learner phones have connected yet. Use Show QR Code to invite them.", 14f, MUTED, false
        ).apply { setPadding(dp(8), dp(16), dp(8), dp(25)) })
        for (rowIndex in 0 until (roster.size + 4) / 5) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (column in 0 until 5) {
                val index = rowIndex * 5 + column
                val card = roster.getOrNull(index) ?: break
                row.addView(studentTile(card), LinearLayout.LayoutParams(0, dp(83), 1f))
            }
            page.addView(row)
        }

        val issuePanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(15), dp(15), dp(15), dp(15))
            background = rounded(Color.WHITE, dp(16))
        }
        issuePanel.addView(label("Report an issue", 20f, INK, true))
        val issueHint = "Save offline with photos or a short video. Tala sends it when internet returns."
        issuePanel.addView(label(issueHint, 13f, MUTED, false).apply {
            setPadding(0, dp(3), 0, dp(12))
        })
        issuePanel.addView(button("Write a report", true) { showIssueForm() })
        val issueCount = database.issueCount()
        val pendingCount = database.pendingIssueCount()
        if (pendingCount > 0) issuePanel.addView(
            button("Send pending reports ($pendingCount)", false) { sendPendingIssues() },
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) }
        )
        database.pendingIssueError().takeIf { it.isNotBlank() }?.let { error ->
            issuePanel.addView(label("Last delivery attempt: $error", 12f, 0xFFAD514B.toInt(), false),
                LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(5) })
        }
        if (issueCount > 0) issuePanel.addView(
            button("Share report text ($issueCount)", false) { shareIssues() },
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) }
        )
        page.addView(issuePanel)
        setContentView(scroll)
    }

    private fun studentTile(card: RosterCard): View {
        val student = card.student
        val state = studentState(student)
        val lit = state != SyncState.INACTIVE && state != SyncState.ERROR_CONNECTING
        val tile = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val ring = when (state) {
            SyncState.SYNCED -> 0xFF19836F.toInt()
            SyncState.ERROR_TRANSFER, SyncState.ERROR_CONNECTING -> 0xFFCB5E58.toInt()
            else -> null
        }
        val icon = FrameLayout(this).apply {
            if (ring != null) background = rounded(Color.TRANSPARENT, dp(20)).apply {
                setStroke(dp(3), ring)
            }
            contentDescription = "${card.displayName}, ${state.label}"
        }
        val animal = label(RosterIdentity.animals[card.animalIndex], 26f, INK, false).apply {
            gravity = Gravity.CENTER
            background = rounded(RosterIdentity.colors[card.colorIndex], dp(18))
            alpha = if (lit) 1f else 0.5f
        }
        icon.addView(animal, FrameLayout.LayoutParams(-1, -1).apply {
            if (ring != null) setMargins(dp(4), dp(4), dp(4), dp(4))
        })
        if (state == SyncState.TRANSFERRING) pulse(icon)
        tile.addView(icon, LinearLayout.LayoutParams(dp(50), dp(50)))
        tile.addView(label(card.displayName, 11f, if (lit) INK else MUTED, true).apply {
            gravity = Gravity.CENTER
            maxLines = 1
            setPadding(dp(2), dp(5), dp(2), 0)
        })
        tile.setOnClickListener { showStudent(card) }
        return tile
    }

    private fun pulse(view: View) {
        view.startAnimation(AlphaAnimation(1f, 0.55f).apply {
            duration = 650
            repeatCount = Animation.INFINITE
            repeatMode = Animation.REVERSE
        })
    }

    private fun studentState(student: StudentRow): SyncState {
        val liveState = live["${student.classId}:${student.installationId}"]
        return when {
            liveState == SyncState.ERROR_CONNECTING -> SyncState.ERROR_CONNECTING
            liveState == SyncState.ERROR_TRANSFER -> SyncState.ERROR_TRANSFER
            liveState == SyncState.TRANSFERRING -> SyncState.TRANSFERRING
            liveState == SyncState.SYNCED -> SyncState.SYNCED
            liveState == SyncState.CONNECTED -> SyncState.CONNECTED
            else -> SyncState.INACTIVE
        }
    }

    private fun showStudent(card: RosterCard) {
        if (studentDialog?.isShowing == true) return
        val schoolClass = database.classes().first { it.id == card.student.classId }
        val roster = database.rosterCards(schoolClass, database.students(schoolClass.id))
        val index = roster.indexOfFirst {
            it.student.installationId == card.student.installationId &&
                it.student.profileId == card.student.profileId
        }
        if (index < 0) return
        studentDialog = StudentCarousel(this, database, roster, index) { student ->
            val state = studentState(student)
            state.label to state.color
        }.apply {
            setOnDismissListener { if (studentDialog === this) studentDialog = null }
            show()
        }
    }

    private fun confirmShareClass(schoolClass: SchoolClass) {
        AlertDialog.Builder(this).setTitle("Share class activity?")
            .setMessage("The spreadsheet includes student names and learning activity. Share it only with trusted recipients.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Create XLSX") { _, _ -> shareClass(schoolClass) }
            .show()
    }

    private fun shareClass(schoolClass: SchoolClass) {
        val progress = AlertDialog.Builder(this).setMessage("Preparing class spreadsheet…")
            .setCancelable(false).show()
        Thread {
            val result = runCatching { ClassWorkbook.export(this, database, schoolClass) }
            runOnUiThread {
                progress.dismiss()
                if (isFinishing || isDestroyed) return@runOnUiThread
                result.onSuccess { file ->
                    val uri = FileProvider.getUriForFile(this,
                        "$packageName.fileprovider", file)
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = ClassWorkbook.MIME
                        putExtra(Intent.EXTRA_SUBJECT, "${schoolClass.name} · Hiraia Tala activity")
                        putExtra(Intent.EXTRA_STREAM, uri)
                        clipData = ClipData.newUri(contentResolver, "Class activity", uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(intent, "Share class spreadsheet"))
                }.onFailure {
                    Toast.makeText(this, "Could not prepare the spreadsheet. Please try again.",
                        Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun greeting(teacherName: String): String {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val (time, emoji) = when (hour) {
            in 5..11 -> "morning" to "☀️"
            in 12..17 -> "afternoon" to "🌤️"
            else -> "evening" to "🌙"
        }
        val name = teacherName.trim().substringBefore(' ').ifBlank { "teacher" }
        return "Good $time, $name! $emoji"
    }

    private fun showSettings() {
        if (settingsDialog?.isShowing == true) return
        settingsDialog = TalaSettings(this, database, selectedClassId,
            onClassSelected = { selectClass(it) },
            onClassesChanged = { render() }).show()
    }

    private fun showQr() {
        val schoolClass = database.classes().firstOrNull { it.id == selectedClassId }
        if (schoolClass == null) {
            Toast.makeText(this, "Select a class to show its QR.", Toast.LENGTH_SHORT).show()
            return
        }
        if (schoolClass.teacherName.isBlank()) {
            AlertDialog.Builder(this).setTitle("Add teacher name")
                .setMessage("Enter the teacher name in Settings before showing this class QR.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Open settings") { _, _ -> showSettings() }.show()
            return
        }
        val identity = ClassIdentity(this, schoolClass.enrollmentId)
        val size = minOf(resources.displayMetrics.widthPixels - dp(100), dp(310))
        val bitmap = EnrollmentQr.create(identity.qrPayload(), getDrawable(R.drawable.hiraia_glyph)!!, INK)
        val image = ImageView(this).apply {
            setImageBitmap(bitmap)
            contentDescription = "Class enrollment QR code with Hiraia logo"
        }
        fun centered(value: String, size: Float, color: Int, bold: Boolean): TextView =
            label(value, size, color, bold).apply { gravity = Gravity.CENTER }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(6), dp(16), dp(18))
        }
        lateinit var dialog: AlertDialog
        content.addView(LinearLayout(this).apply {
            gravity = Gravity.END
            addView(centered("×", 28f, INK, false).apply {
                contentDescription = "Close QR code"
                setOnClickListener { dialog.dismiss() }
            }, LinearLayout.LayoutParams(dp(48), dp(48)))
        })
        content.addView(centered("Join ${schoolClass.teacherName.trim()}'s class", 25f, INK, true))
        val confirmation = "${shortLabel(schoolClass.name, 22)} - Grade ${schoolClass.gradeLevel} - " +
            "${schoolClass.schoolYear.replace('–', '-')} - ${shortLabel(schoolClass.schoolName, 18)}"
        content.addView(centered(confirmation, 13f, MUTED, false),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(5) })
        content.addView(image, LinearLayout.LayoutParams(size, size).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(14)
            bottomMargin = dp(12)
        })
        content.addView(centered("Camera not working? Enter the code", 15f, INK, false))
        val code = centered("", 23f, INK, true).apply {
            typeface = Typeface.MONOSPACE
            letterSpacing = 0.04f
            setPadding(dp(15), dp(10), dp(15), dp(10))
            background = rounded(PALE_YELLOW, dp(14))
        }
        content.addView(code, LinearLayout.LayoutParams(-2, -2).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(9)
        })
        content.addView(centered("Code valid for 1 hour · Keep collection on", 12f, MUTED, false),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        content.addView(centered("Students need to be in the same room when they join.",
            12f, INK, true), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        val collectionStatus = centered(status, 13f, TEAL, true)
        content.addView(collectionStatus, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        qrCollectionStatus = collectionStatus
        lateinit var updateCode: Runnable
        updateCode = object : Runnable {
            override fun run() {
                val ticket = manualEnrollment.current(schoolClass.enrollmentId)
                code.text = ticket.display()
                code.postDelayed(this, (ticket.expiresAt - System.currentTimeMillis()).coerceAtLeast(1L))
            }
        }
        content.addView(button("Refresh QR Code", true) {
            code.removeCallbacks(updateCode)
            manualEnrollment.clear()
            updateCode.run()
            Toast.makeText(this, "Backup code refreshed. Class QR stays the same.", Toast.LENGTH_SHORT).show()
        }, LinearLayout.LayoutParams(-1, dp(50)).apply { topMargin = dp(24) })
        val scroll = ScrollView(this).apply { addView(content) }
        dialog = AlertDialog.Builder(this).setView(scroll).create()
        dialog.setOnDismissListener {
            code.removeCallbacks(updateCode)
            if (qrCollectionStatus === collectionStatus) qrCollectionStatus = null
        }
        dialog.show()
        updateCode.run()
        if (!collecting) startCollection()
    }

    private fun shortLabel(value: String, maxLength: Int): String {
        val trimmed = value.trim()
        if (trimmed.length <= maxLength) return trimmed
        val prefix = trimmed.take(maxLength).trimEnd()
        return prefix.substringBeforeLast(' ', prefix)
    }

    private fun showIssueForm() {
        val schoolClass = database.classes().first { it.id == selectedClassId }
        val selected = mutableListOf<Uri>()
        var selectedBytes = 0L
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
        }
        val category = Spinner(this)
        category.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, TalaDatabase.ISSUE_CATEGORIES)
        val details = EditText(this).apply {
            hint = "What happened? Which phone or lesson?"
            minLines = 4
            maxLines = 8
            gravity = Gravity.TOP
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
        }
        form.addView(category)
        form.addView(details)
        form.addView(label("Avoid including student faces or names unless needed to explain the problem.",
            12f, MUTED, false), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(7) })
        val attachmentLabel = label("No attachments · up to 3 JPG, PNG, WebP or MP4 files · 10 MB total · videos under 1 minute",
            12f, MUTED, false)
        val attachButton = button("Attach images or video", false) {
            val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/jpeg", "image/png", "image/webp", "video/mp4"))
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            startActivityForResult(picker, ISSUE_MEDIA_REQUEST)
        }
        form.addView(attachButton, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        form.addView(attachmentLabel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) })
        val dialog = AlertDialog.Builder(this).setTitle("Report an issue")
            .setView(form).setNegativeButton("Cancel", null).setPositiveButton("Save", null).create()
        issuePickerCallback = { uris ->
            val pending = uris.distinct().filterNot { it in selected }
            if (selected.size + pending.size > 3) {
                Toast.makeText(this, "Choose up to 3 attachments.", Toast.LENGTH_LONG).show()
            } else if (pending.isNotEmpty()) {
                attachButton.isEnabled = false
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                attachmentLabel.text = "Checking attachment sizes…"
                val startingBytes = selectedBytes
                Thread {
                    var total = startingBytes
                    val accepted = mutableListOf<Uri>()
                    val failures = mutableListOf<String>()
                    for (uri in pending) {
                        runCatching {
                            IssueAttachmentValidator.measure(this, uri,
                                IssueAttachmentValidator.MAX_TOTAL_BYTES - total)
                        }.onSuccess { size ->
                            total += size
                            accepted.add(uri)
                        }.onFailure { error ->
                            failures.add(error.message ?: "Could not read an attachment.")
                        }
                    }
                    runOnUiThread {
                        if (!dialog.isShowing) return@runOnUiThread
                        selected.addAll(accepted)
                        selectedBytes = total
                        attachmentLabel.text = if (selected.isEmpty())
                            "No attachments · up to 3 files · 10 MB total · videos under 1 minute"
                        else "${selected.size} attachment${if (selected.size == 1) "" else "s"} · " +
                            "${String.format(java.util.Locale.ROOT, "%.1f", selectedBytes / 1_000_000.0)} / 10 MB"
                        attachButton.isEnabled = true
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                        if (failures.isNotEmpty()) Toast.makeText(this,
                            failures.first() + if (failures.size > 1) " ${failures.size - 1} more skipped." else "",
                            Toast.LENGTH_LONG).show()
                    }
                }.start()
            }
        }
        dialog.setOnDismissListener { issuePickerCallback = null }
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val value = details.text.toString().trim()
                if (value.isEmpty()) details.error = "Please describe the issue"
                else {
                    try {
                        database.addIssue(category.selectedItem.toString(), value.take(2000),
                            schoolClass, selected)
                        dialog.dismiss()
                        IssueUploader.schedule(this)
                        render()
                    } catch (error: Exception) {
                        Toast.makeText(this, error.message ?: "Could not save this report.",
                            Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
        dialog.show()
    }

    private fun sendPendingIssues() {
        Toast.makeText(this, "Sending saved reports…", Toast.LENGTH_SHORT).show()
        Thread {
            val complete = runCatching { IssueUploader.uploadPending(this) }.getOrDefault(false)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                render()
                Toast.makeText(this, if (complete) "Reports sent to Hiraia."
                    else "Could not send yet. Tala will retry when internet returns.",
                    Toast.LENGTH_LONG).show()
            }
        }.start()
    }

    private fun shareIssues() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Hiraia Tala pilot issues")
            putExtra(Intent.EXTRA_TEXT, database.issueText())
        }
        startActivity(Intent.createChooser(intent, "Share saved reports"))
    }

    private fun metric(title: String, value: String): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(10), dp(13), dp(7), dp(8))
        background = rounded(Color.WHITE, dp(14))
        addView(label(value, 22f, INK, true))
        addView(label(title, 11f, MUTED, false))
    }

    private fun label(value: String, size: Float, color: Int, bold: Boolean): TextView = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

    private fun button(value: String, filled: Boolean, action: () -> Unit): TextView = label(
        value, 14f, if (filled) Color.WHITE else TEAL, true
    ).apply {
        gravity = Gravity.CENTER
        setPadding(dp(9), dp(12), dp(9), dp(12))
        background = rounded(if (filled) TEAL else PALE, dp(12))
        setOnClickListener { action() }
    }

    private fun rounded(color: Int, radius: Int): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius.toFloat()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()

    private enum class SyncState(val label: String, val color: Int) {
        INACTIVE("Inactive", 0xFF9AA5A1.toInt()),
        CONNECTED("Connected", 0xFF4A86B8.toInt()),
        TRANSFERRING("Transferring", 0xFFD9A125.toInt()),
        SYNCED("Synced, connected", 0xFF19836F.toInt()),
        ERROR_TRANSFER("Transfer error", 0xFFCB5E58.toInt()),
        ERROR_CONNECTING("Connection error", 0xFFCB5E58.toInt())
    }

    companion object {
        private const val PERMISSION_REQUEST = 42
        private const val BLUETOOTH_REQUEST = 43
        private const val ISSUE_MEDIA_REQUEST = 44
        private const val TUTORIAL_COMPLETE = "tutorial_complete"
        private val PAPER = 0xFFF6F4EC.toInt()
        private val INK = 0xFF203D38.toInt()
        private val TEAL = 0xFF17695F.toInt()
        private val PALE = 0xFFE0EEE8.toInt()
        private val PALE_YELLOW = 0xFFFFF2C7.toInt()
        private val MUTED = 0xFF667872.toInt()
        private val TUTORIAL_PAGES = listOf(
            TutorialPage(
                R.drawable.tala_tutorial_monitor,
                "A teacher and students using Hiraia Tala together in class",
                "Meet Hiraia Tala",
                "Tala is the classroom monitoring app for Hiraia, the free AI tutor for public school students."
            ),
            TutorialPage(
                R.drawable.tala_tutorial_qr,
                "A student scanning a teacher's QR code on a phone",
                "Connect your class",
                "Each student scans the QR code from your Tala app. This lets you monitor that student's Hiraia activity."
            ),
            TutorialPage(
                R.drawable.tala_tutorial_nearby,
                "A teacher and nearby students connected through their phones",
                "Stay nearby",
                "A connection is maintained while students are using Hiraia and their phones remain within about 15 ft of yours."
            )
        )
    }

    private data class TutorialPage(
        val imageRes: Int,
        val imageDescription: String,
        val title: String,
        val message: String
    )
}
