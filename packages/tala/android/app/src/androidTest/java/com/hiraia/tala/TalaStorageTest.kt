package com.hiraia.tala

import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.MessageDigest
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.security.spec.MGF1ParameterSpec
import java.io.File
import java.io.RandomAccessFile
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory

@RunWith(AndroidJUnit4::class)
class TalaStorageTest {
    @Test
    fun oversizedVideoIsRejectedBeforeItCanBeAttached() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "exports")
        folder.mkdirs()
        val video = File(folder, "oversized-issue.mp4")
        val photo = File(folder, "small-issue.png")
        try {
            RandomAccessFile(video, "rw").use { it.setLength(IssueAttachmentValidator.MAX_TOTAL_BYTES + 1) }
            val videoUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", video)
            val failure = runCatching {
                IssueAttachmentValidator.measure(context, videoUri, IssueAttachmentValidator.MAX_TOTAL_BYTES)
            }.exceptionOrNull()
            assertTrue(failure is IllegalArgumentException)
            assertTrue(failure?.message?.contains("video") == true)

            photo.writeBytes(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47))
            val photoUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", photo)
            assertEquals(4L, IssueAttachmentValidator.measure(context, photoUri, 4L))
            assertTrue(runCatching { IssueAttachmentValidator.measure(context, photoUri, 3L) }
                .exceptionOrNull() is IllegalArgumentException)
        } finally {
            video.delete()
            photo.delete()
        }
    }

    @Test
    fun issueMediaAndDeliveryStateSurviveReopeningTheDatabase() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val source = File(context.cacheDir, "exports/issue-example.png")
        source.parentFile!!.mkdirs()
        source.writeBytes(android.util.Base64.decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
            android.util.Base64.DEFAULT))
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", source)
        var reportId = ""
        TalaDatabase(context).use { database ->
            reportId = database.addIssue("App problem", "The app froze", database.classes().single(), listOf(uri))
            assertEquals(1, database.pendingIssueCount())
            assertEquals(1, database.pendingIssues().single().media.size)
        }
        try {
            TalaDatabase(context).use { database ->
                val report = database.pendingIssues().single()
                assertEquals(reportId, report.id)
                assertEquals("Pilot class", report.className)
                assertTrue(File(report.media.single().path).isFile)
                database.markIssueError(reportId, "Offline")
                assertEquals("Offline", database.pendingIssueError())
                database.markIssueSent(reportId)
                assertEquals(0, database.pendingIssueCount())
                assertEquals(1, database.issueCount())
                assertFalse(File(report.media.single().path).exists())
            }
        } finally {
            File(context.filesDir, "issue-media/$reportId").deleteRecursively()
            source.delete()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun studentCarouselSwipesBetweenLearners() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        context.deleteDatabase("hiraia-tala.db")
        val database = TalaDatabase(context)
        var activity: MainActivity? = null
        try {
            val schoolClass = database.classes().single()
            val batch = JSONObject().put("schema", 1).put("class_id", schoolClass.enrollmentId)
                .put("installation_id", "installation-123456789")
                .put("profiles", JSONArray()
                    .put(JSONObject().put("id", "student-profile-111111111").put("name", "Ana"))
                    .put(JSONObject().put("id", "student-profile-222222222").put("name", "Ben")))
                .put("events", JSONArray())
            database.ingest(schoolClass.enrollmentId, batch, false)
            val roster = RosterIdentity.cards(database.students(schoolClass.id))
            activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as MainActivity
            lateinit var dialog: StudentCarousel
            instrumentation.runOnMainSync {
                dialog = StudentCarousel(activity, database, roster, 0) {
                    "Connected" to 0xFF17695F.toInt()
                }
                dialog.show()
            }
            instrumentation.waitForIdleSync()
            assertTrue(visibleText(dialog.window!!.decorView).contains("Ana"))
            assertTrue(visibleText(dialog.window!!.decorView).contains("1 / 2"))
            instrumentation.runOnMainSync {
                val now = System.currentTimeMillis()
                dialog.dispatchTouchEvent(MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, 250f, 300f, 0))
                dialog.dispatchTouchEvent(MotionEvent.obtain(now, now + 100, MotionEvent.ACTION_UP, 50f, 300f, 0))
            }
            Thread.sleep(350)
            instrumentation.waitForIdleSync()
            assertTrue(visibleText(dialog.window!!.decorView).contains("Ben"))
            assertTrue(visibleText(dialog.window!!.decorView).contains("2 / 2"))
            instrumentation.runOnMainSync { dialog.dismiss() }
        } finally {
            activity?.let { instrumentation.runOnMainSync { it.finish() } }
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    private fun visibleText(view: View): List<String> = when (view) {
        is TextView -> listOf(view.text.toString())
        is ViewGroup -> (0 until view.childCount).flatMap { visibleText(view.getChildAt(it)) }
        else -> emptyList()
    }

    @Test
    fun workbookSharesOnlyActiveClassAndKeepsRecentBackfilledEvents() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val database = TalaDatabase(context)
        try {
            val schoolClass = database.classes().single()
            val otherClass = database.createClass("Other", "Teacher", "Other school", "7", "2026–2027")
            val profileId = "student-profile-123456789"
            val installationId = "installation-123456789"
            val old = System.currentTimeMillis() - 8L * 24 * 60 * 60 * 1000
            val batch = JSONObject().put("schema", 1).put("class_id", schoolClass.enrollmentId)
                .put("installation_id", installationId)
                .put("profiles", JSONArray().put(JSONObject().put("id", profileId)
                    .put("name", "=2+2 & Sam")))
            val events = JSONArray()
            listOf("CARD-A", "CARD-A", "CARD-B").forEachIndexed { index, cardId ->
                events.put(JSONObject().put("id", "card-event-12345678$index")
                    .put("name", "card_viewed").put("occurred_at", old)
                    .put("props", JSONObject().put("profile_kind", "student")
                        .put("profile_id", profileId).put("card_id", cardId)))
            }
            database.ingest(schoolClass.enrollmentId, batch.put("events", events))
            val student = database.students(schoolClass.id).single()
            assertEquals(3, student.cards)
            assertEquals(2, database.uniqueCards(student))
            assertEquals(3, database.recentEvents(student, System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000).size)
            batch.put("class_id", otherClass.enrollmentId)
                .put("events", JSONArray().put(JSONObject().put("id", "other-event-123456789")
                    .put("name", "card_viewed").put("occurred_at", System.currentTimeMillis())
                    .put("props", JSONObject().put("profile_kind", "student")
                        .put("profile_id", profileId).put("card_id", "OTHER-CARD"))))
            database.ingest(otherClass.enrollmentId, batch)

            val workbook = ClassWorkbook.export(context, database, schoolClass)
            ZipFile(workbook).use { zip ->
                val parser = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                val entries = zip.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    if (entry.name.endsWith(".xml")) zip.getInputStream(entry).use { parser.parse(it) }
                }
                val students = zip.getInputStream(zip.getEntry("xl/worksheets/sheet2.xml"))
                    .bufferedReader().use { it.readText() }
                val activity = zip.getInputStream(zip.getEntry("xl/worksheets/sheet3.xml"))
                    .bufferedReader().use { it.readText() }
                assertTrue(students.contains("Unique cards"))
                assertTrue(students.contains("=2+2 &amp; Sam"))
                assertTrue(students.contains("<v>2</v>"))
                assertTrue(activity.contains("CARD-A"))
                assertTrue(activity.contains("CARD-B"))
                assertFalse(activity.contains("OTHER-CARD"))
            }
            val uri = FileProvider.getUriForFile(context,
                "${context.packageName}.fileprovider", workbook)
            context.contentResolver.openInputStream(uri)!!.use { input ->
                assertEquals('P'.code, input.read())
                assertEquals('K'.code, input.read())
            }
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }
    @Test
    fun nearbyCanReadWifiStateOnCurrentAndroid() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(PackageManager.PERMISSION_GRANTED,
            context.checkSelfPermission(Manifest.permission.ACCESS_WIFI_STATE))
        assertEquals(PackageManager.PERMISSION_GRANTED,
            context.checkSelfPermission(Manifest.permission.CHANGE_WIFI_STATE))
    }

    @Test
    fun qrKeyDecryptsOnlyForItsTeacher() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val identity = ClassIdentity(context)
        val qr = JSONObject(identity.qrPayload())
        assertEquals(identity.classId, qr.getString("class_id"))
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(
            X509EncodedKeySpec(ClassIdentity.decode(qr.getString("public_key")))
        )
        val sessionKey = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val wrapping = Cipher.getInstance("RSA/ECB/OAEPPadding")
        wrapping.init(Cipher.ENCRYPT_MODE, publicKey,
            OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT))
        assertTrue(sessionKey.contentEquals(identity.unwrapSessionKey(
            ClassIdentity.encode(wrapping.doFinal(sessionKey)))))

        val challenge = ClassIdentity.challenge()
        val encrypted = identity.encrypt(sessionKey, challenge, "private telemetry", "batch")
        assertEquals("private telemetry", identity.decrypt(sessionKey, challenge, encrypted))
        try {
            identity.decrypt(sessionKey, ClassIdentity.challenge(), encrypted)
            throw AssertionError("Wrong challenge was accepted")
        } catch (_: javax.crypto.AEADBadTagException) {
        }
    }

    @Test
    fun brandedQrDecodesToTheUnchangedEnrollmentPayload() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val identity = ClassIdentity(context)
        val bitmap = EnrollmentQr.create(identity.qrPayload(),
            context.getDrawable(R.drawable.hiraia_glyph)!!, 0xFF203D38.toInt())
        for (dimension in intArrayOf(700, 420)) {
            val rendered = android.graphics.Bitmap.createScaledBitmap(bitmap, dimension, dimension, true)
            val pixels = IntArray(rendered.width * rendered.height)
            rendered.getPixels(pixels, 0, rendered.width, 0, 0, rendered.width, rendered.height)
            val source = RGBLuminanceSource(rendered.width, rendered.height, pixels)
            val decoded = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source)))
            assertEquals(identity.qrPayload(), decoded.text)
        }
    }

    @Test
    fun introDoesNotMarkSyncedAndRetriesDoNotDoubleCount() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val database = TalaDatabase(context)
        try {
            val classId = ClassIdentity.legacyClassId(context)
            val installationId = "installation-123456789"
            val profileId = "student-profile-123456789"
            val eventId = "card-event-123456789"
            val batch = JSONObject()
                .put("schema", 1).put("class_id", classId)
                .put("installation_id", installationId)
                .put("profiles", JSONArray().put(JSONObject()
                    .put("id", profileId).put("name", "Student One")))
                .put("events", JSONArray())
            database.ingest(classId, batch, false)
            assertEquals(0L, database.students().single().lastSync)
            assertTrue(database.students().single().lastSeen > 0)

            val event = JSONObject().put("id", eventId).put("name", "card_viewed")
                .put("occurred_at", System.currentTimeMillis())
                .put("props", JSONObject().put("profile_kind", "student")
                    .put("profile_id", profileId))
            batch.put("events", JSONArray().put(event))
            assertEquals(listOf(eventId), database.ingest(classId, batch).accepted)
            assertEquals(listOf(eventId), database.ingest(classId, batch).accepted)
            assertEquals(1, database.students().single().cards)
            assertEquals(1, database.students().single().events)
            assertTrue(database.students().single().lastSync > 0)

            event.put("name", "unknown_event")
            val rejected = database.ingest(classId, batch)
            assertEquals(listOf(eventId), rejected.rejected)
            assertEquals(1, database.students().single().cards)
            assertEquals(1, database.students().single().lastRejected)
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun guestPhonesKeepDistinctAliasesAndTheirEvents() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val database = TalaDatabase(context)
        try {
            val enrollmentId = database.classes().single().enrollmentId
            val firstPhone = JSONObject().put("schema", 1).put("class_id", enrollmentId)
                .put("installation_id", "installation-123456789")
                .put("profiles", JSONArray()).put("events", JSONArray())
            database.ingest(enrollmentId, firstPhone, false)
            val first = database.students().single()
            val schoolClass = database.classes().single()
            val firstAvatar = database.rosterCards(schoolClass, listOf(first)).single()
            assertTrue(first.name.startsWith("Guest-"))
            assertEquals(0L, first.lastSync)
            assertTrue(first.lastSeen > 0)
            val guestEvent = JSONObject().put("id", "guest-card-123456789")
                .put("name", "card_viewed").put("occurred_at", System.currentTimeMillis())
                .put("props", JSONObject().put("profile_kind", "guest"))
            firstPhone.put("events", JSONArray().put(guestEvent))
            assertEquals(listOf("guest-card-123456789"), database.ingest(enrollmentId, firstPhone).accepted)
            assertEquals(1, database.students().single().cards)
            assertEquals(1, database.students().single().events)
            firstPhone.put("events", JSONArray())
            database.ingest(enrollmentId, firstPhone, false)
            assertEquals(first.name, database.students().single().name)
            firstPhone.put("profiles", JSONArray().put(JSONObject()
                .put("id", "guest-profile-123456789").put("name", "Guest")))
            database.ingest(enrollmentId, firstPhone, false)
            assertEquals(1, database.students().size)
            assertEquals(first.name, database.students().single().name)
            assertEquals(1, database.students().single().cards)
            val guestAvatar = database.rosterCards(schoolClass, database.students()).single()
            assertEquals(firstAvatar.animalIndex, guestAvatar.animalIndex)
            assertEquals(firstAvatar.colorIndex, guestAvatar.colorIndex)

            val secondPhone = JSONObject(firstPhone.toString())
                .put("installation_id", "installation-987654321")
            database.ingest(enrollmentId, secondPhone, false)
            val guests = database.students()
            assertEquals(2, guests.size)
            assertEquals(2, guests.map { it.name }.toSet().size)
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun allAcceptedTelemetryIsCountedAndRejectionsAreVisible() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val database = TalaDatabase(context)
        try {
            val schoolClass = database.classes().single()
            val profileId = "student-profile-123456789"
            val batch = JSONObject().put("schema", 1).put("class_id", schoolClass.enrollmentId)
                .put("installation_id", "installation-123456789")
                .put("profiles", JSONArray().put(JSONObject().put("id", profileId).put("name", "Luis")))
                .put("events", JSONArray())
            database.ingest(schoolClass.enrollmentId, batch, false)
            val events = JSONArray()
            for ((id, name) in listOf(
                "session-event-123456789" to "session_started",
                "card-event-123456789" to "card_viewed",
                "unknown-event-123456789" to "unapproved_event"
            )) events.put(JSONObject().put("id", id).put("name", name)
                .put("occurred_at", System.currentTimeMillis())
                .put("props", JSONObject().put("profile_kind", "student").put("profile_id", profileId)))
            batch.put("events", events)
            val result = database.ingest(schoolClass.enrollmentId, batch)
            assertEquals(2, result.accepted.size)
            assertEquals(1, result.rejected.size)
            val student = database.students().single()
            assertEquals(2, student.events)
            assertEquals(1, student.cards)
            assertEquals(2, student.lastAccepted)
            assertEquals(1, student.lastRejected)
            assertEquals(2, database.eventCount(schoolClass.id))
            assertEquals(listOf("card_viewed" to 1, "session_started" to 1),
                database.eventBreakdown(student))
            batch.put("events", JSONArray())
            database.ingest(schoolClass.enrollmentId, batch)
            assertEquals(2, database.students().single().lastAccepted)
            assertEquals(1, database.students().single().lastRejected)
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun animalColorsAndDuplicateNamesAreStableAcrossTeacherPhones() {
        val schoolClass = SchoolClass("teacher-a", "enrollment-a", "Perseverance", "Jannie",
            "Calapacuan", "6", "2026–2027")
        fun student(profileId: String, name: String) = StudentRow(
            schoolClass.id, "installation-123456789", profileId, name,
            0, 0, 0, 0, 0, 0, 0, 0, 0
        )
        val first = student("student-profile-111111111", "Luis")
        val second = student("student-profile-222222222", "luis ")
        val original = RosterIdentity.cards(listOf(second, first))
        val replacement = RosterIdentity.cards(listOf(first.copy(classId = "teacher-b"),
            second.copy(classId = "teacher-b")))
        assertEquals("Luis", original.first { it.student.profileId == first.profileId }.displayName)
        assertEquals("luis-2", original.first { it.student.profileId == second.profileId }.displayName)
        assertEquals(11, original[0].animalIndex)
        assertEquals(2, original[0].colorIndex)
        assertEquals(2, original[1].animalIndex)
        assertEquals(2, original[1].colorIndex)
        for (card in original) {
            val other = replacement.first { it.student.profileId == card.student.profileId }
            assertEquals(card.displayName, other.displayName)
            assertEquals(card.animalIndex, other.animalIndex)
            assertEquals(card.colorIndex, other.colorIndex)
        }
    }

    @Test
    fun avatarsMatchOnReplacementTeacherPhoneForNamedAndGuestProfiles() {
        val original = StudentRow("old-class", "installation-123456789", "student-profile-123456789",
            "Luis", 0, 0, 0, 0, 0, 0, 0, 0, 0)
        val replacement = original.copy(classId = "new-class", name = "Luis Santos")
        val firstCard = RosterIdentity.cards(listOf(original)).single()
        val replacementCard = RosterIdentity.cards(listOf(replacement)).single()
        assertEquals(firstCard.animalIndex, replacementCard.animalIndex)
        assertEquals(firstCard.colorIndex, replacementCard.colorIndex)

        val firstGuest = original.copy(profileId = "guest", name = "Guest-Q3K7B2")
        val replacementGuest = original.copy(classId = "new-class",
            profileId = "guest-profile-123456789", name = "Guest-T6M4P8")
        val firstGuestCard = RosterIdentity.cards(listOf(firstGuest)).single()
        val replacementGuestCard = RosterIdentity.cards(listOf(replacementGuest)).single()
        assertEquals(firstGuestCard.animalIndex, replacementGuestCard.animalIndex)
        assertEquals(firstGuestCard.colorIndex, replacementGuestCard.colorIndex)
    }

    @Test
    fun assignedAvatarsSurviveMetadataChangesAndDatabaseReopen() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        try {
            val first = TalaDatabase(context)
            val schoolClass = first.classes().single()
            val installationId = "installation-123456789"
            val profileId = "student-profile-123456789"
            fun batch(name: String) = JSONObject().put("schema", 1)
                .put("class_id", schoolClass.enrollmentId)
                .put("installation_id", installationId)
                .put("profiles", JSONArray().put(JSONObject().put("id", profileId).put("name", name)))
                .put("events", JSONArray())
            first.ingest(schoolClass.enrollmentId, batch("Luis"))
            val original = first.rosterCards(schoolClass, first.students(schoolClass.id)).single()
            first.updateClass(schoolClass.id, "New class", "Jannie", "New school", "6", "2027–2028")
            first.ingest(schoolClass.enrollmentId, batch("Luis Santos"))
            first.close()
            TalaDatabase(context).use { reopened ->
                val renamedClass = reopened.classes().single()
                val renamed = reopened.rosterCards(renamedClass, reopened.students(renamedClass.id)).single()
                assertEquals("Luis Santos", renamed.displayName)
                assertEquals(original.animalIndex, renamed.animalIndex)
                assertEquals(original.colorIndex, renamed.colorIndex)
            }
        } finally {
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun classesKeepQrAndStudentActivitySeparate() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val database = TalaDatabase(context)
        try {
            val schoolClass = database.classes().single()
            val otherClass = database.createClass("Other class", "Teacher", "Other school", "7", "2026–2027")
            val enrollmentId = schoolClass.enrollmentId
            val installationId = "installation-123456789"
            val profileId = "student-profile-123456789"
            val batch = JSONObject().put("schema", 1)
                .put("installation_id", installationId)
                .put("profiles", JSONArray().put(JSONObject().put("id", profileId).put("name", "Student One")))
                .put("events", JSONArray().put(JSONObject().put("id", "card-event-123456789")
                    .put("name", "card_viewed").put("occurred_at", System.currentTimeMillis())
                    .put("props", JSONObject().put("profile_kind", "student").put("profile_id", profileId))))
            database.ingest(enrollmentId, batch.put("class_id", enrollmentId))
            database.ingest(enrollmentId, batch)
            assertEquals(1, database.students(schoolClass.id).single().cards)
            assertEquals(enrollmentId, database.classes().first { it.id == schoolClass.id }.enrollmentId)
            assertEquals(1, database.students(schoolClass.id).size)
            database.ingest(otherClass.enrollmentId, batch.put("class_id", otherClass.enrollmentId))
            assertEquals(1, database.students(otherClass.id).single().cards)
            assertEquals(2, database.students().size)
            assertTrue("Teacher" in database.options("teacher"))
            assertTrue("Other school" in database.options("school"))
            database.addOption("teacher", "Jannie")
            database.updateClass(schoolClass.id, "Perseverance", "Jannie", "Other school", "7", "2026–2027")
            assertEquals(enrollmentId, database.classes().first { it.id == schoolClass.id }.enrollmentId)
            assertEquals("Perseverance", database.classes().first { it.id == schoolClass.id }.name)
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun manualCodeDeliversTheExistingQrIdentity() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val identity = ClassIdentity(context)
        val enrollment = ManualEnrollment()
        val ticket = enrollment.current(identity.classId, 1000L)
        assertEquals(12, ticket.code.length)
        assertEquals(1000L + ManualEnrollment.ONE_HOUR, ticket.expiresAt)
        assertEquals(ticket.code, enrollment.current(identity.classId, ticket.expiresAt - 1).code)
        assertFalse(ticket.code.any { it in "0OIL1l" })
        val challenge = ClassIdentity.challenge()
        val clientNonce = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val challengeBytes = challenge.toByteArray(Charsets.UTF_8)
        val secret = MessageDigest.getInstance("SHA-256").digest(
            "hiraia-tala-manual-v1:".toByteArray(Charsets.UTF_8) + ticket.code.toByteArray(Charsets.US_ASCII)
        )
        val proof = ManualEnrollment.hmac(secret, byteArrayOf(1) + challengeBytes + clientNonce)
        val request = JSONObject().put("v", 1).put("type", "manual_enroll")
            .put("client_nonce", ClassIdentity.encode(clientNonce)).put("proof", ClassIdentity.encode(proof))
        val response = enrollment.respond(identity.classId, challenge, request, identity.qrPayload(), 2000L)
        val responseKey = ManualEnrollment.hmac(secret, byteArrayOf(2) + challengeBytes + clientNonce)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(responseKey, "AES"),
            GCMParameterSpec(128, ClassIdentity.decode(response.getString("nonce"))))
        cipher.updateAAD(byteArrayOf(3) + challengeBytes + clientNonce)
        val delivered = String(cipher.doFinal(ClassIdentity.decode(response.getString("ciphertext"))), Charsets.UTF_8)
        assertEquals(identity.qrPayload(), delivered)
        request.put("proof", ClassIdentity.encode(ByteArray(32)))
        try {
            enrollment.respond(identity.classId, challenge, request, identity.qrPayload(), 2000L)
            throw AssertionError("Wrong code proof was accepted")
        } catch (_: IllegalArgumentException) {
        }
        try {
            enrollment.respond(identity.classId, challenge, request, identity.qrPayload(), ticket.expiresAt)
            throw AssertionError("Expired code was accepted")
        } catch (_: IllegalArgumentException) {
        }
    }

    @Test
    fun oldTeacherDatabaseKeepsItsRosterAfterUpgrade() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        context.openOrCreateDatabase("hiraia-tala.db", 0, null).use { old ->
            old.execSQL("CREATE TABLE students(installation_id TEXT NOT NULL,profile_id TEXT NOT NULL,name TEXT NOT NULL,first_seen INTEGER NOT NULL,PRIMARY KEY(installation_id,profile_id))")
            old.execSQL("CREATE TABLE events(installation_id TEXT NOT NULL,event_id TEXT NOT NULL,profile_id TEXT NOT NULL,event_name TEXT NOT NULL,correct INTEGER NOT NULL,occurred_at INTEGER NOT NULL,received_at INTEGER NOT NULL,props TEXT NOT NULL,PRIMARY KEY(installation_id,event_id))")
            old.execSQL("CREATE TABLE devices(installation_id TEXT PRIMARY KEY,last_sync INTEGER NOT NULL)")
            old.execSQL("CREATE TABLE issues(id TEXT PRIMARY KEY,category TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL)")
            old.execSQL("INSERT INTO students VALUES('installation-123456789','student-profile-123456789','Old Student',1)")
            old.execSQL("INSERT INTO events VALUES('installation-123456789','card-event-123456789','student-profile-123456789','card_viewed',0,1780000000000,1780000000000,'{}')")
            old.execSQL("INSERT INTO devices VALUES('installation-123456789',1780000000000)")
            old.execSQL("INSERT INTO issues VALUES('issue-1','App problem','Old issue',1780000000000)")
            old.version = 1
        }
        val database = TalaDatabase(context)
        try {
            val rows = database.students()
            assertEquals(1, rows.size)
            assertEquals("Old Student", rows.single().name)
            assertEquals(1, rows.single().cards)
            assertEquals(ClassIdentity.legacyClassId(context), database.classes().single().enrollmentId)
            assertEquals(database.classes().single().id, rows.single().classId)
            assertEquals(1, database.issueCount())
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun groupBasedDatabaseMigratesWithoutLosingStudentActivity() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val classId = "class-123456789012345"
        val firstGroup = "group-123456789012345"
        val secondGroup = "group-987654321098765"
        context.openOrCreateDatabase("hiraia-tala.db", 0, null).use { old ->
            old.execSQL("CREATE TABLE school_classes(id TEXT PRIMARY KEY,name TEXT,teacher_name TEXT,school_name TEXT,grade_level TEXT,school_year TEXT,created_at INTEGER)")
            old.execSQL("CREATE TABLE class_groups(id TEXT PRIMARY KEY,class_id TEXT,name TEXT,created_at INTEGER)")
            old.execSQL("CREATE TABLE students(group_id TEXT,installation_id TEXT,profile_id TEXT,name TEXT,first_seen INTEGER,PRIMARY KEY(group_id,installation_id,profile_id))")
            old.execSQL("CREATE TABLE events(group_id TEXT,installation_id TEXT,event_id TEXT,profile_id TEXT,event_name TEXT,correct INTEGER,occurred_at INTEGER,received_at INTEGER,props TEXT,PRIMARY KEY(group_id,installation_id,event_id))")
            old.execSQL("CREATE INDEX events_profile_time ON events(group_id,installation_id,profile_id,occurred_at)")
            old.execSQL("CREATE TABLE devices(group_id TEXT,installation_id TEXT,last_sync INTEGER,PRIMARY KEY(group_id,installation_id))")
            old.execSQL("CREATE TABLE issues(id TEXT PRIMARY KEY,category TEXT,details TEXT,created_at INTEGER)")
            old.execSQL("INSERT INTO school_classes VALUES(?,?,?,?,?,?,?)", arrayOf(classId, "Pilot", "Teacher", "School", "6", "2026–2027", 1))
            old.execSQL("INSERT INTO class_groups VALUES(?,?,?,?)", arrayOf(firstGroup, classId, "First", 1))
            old.execSQL("INSERT INTO class_groups VALUES(?,?,?,?)", arrayOf(secondGroup, classId, "Second", 2))
            old.execSQL("INSERT INTO students VALUES(?,?,?,?,?)", arrayOf(secondGroup, "installation-123456789", "student-profile-123456789", "Student", 3))
            old.execSQL("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)", arrayOf(secondGroup, "installation-123456789", "card-event-123456789", "student-profile-123456789", "card_viewed", 0, 1780000000000, 1780000000000, "{}"))
            old.execSQL("INSERT INTO devices VALUES(?,?,?)", arrayOf(secondGroup, "installation-123456789", 1780000000000))
            old.execSQL("INSERT INTO issues VALUES('issue-1','App problem','Saved issue',1)")
            old.version = 2
        }
        val database = TalaDatabase(context)
        try {
            assertEquals(firstGroup, database.classes().single().enrollmentId)
            val student = database.students().single()
            assertEquals(classId, student.classId)
            assertEquals(1, student.cards)
            assertEquals(1780000000000, student.lastSync)
            assertEquals(1, database.issueCount())
            assertEquals(listOf("Teacher"), database.options("teacher"))
            assertEquals(listOf("School"), database.options("school"))
            database.createClass("Another", "Teacher", "School", "6", "2026–2027")
            assertEquals(2, database.classes().size)
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun classEnrollmentDatabaseDropsGroupsButKeepsQrAndRoster() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val classId = "class-123456789012345"
        val enrollmentId = "enrollment-123456789"
        val groupId = "group-123456789012345"
        context.openOrCreateDatabase("hiraia-tala.db", 0, null).use { old ->
            old.execSQL("CREATE TABLE school_classes(id TEXT PRIMARY KEY,name TEXT,teacher_name TEXT,school_name TEXT,grade_level TEXT,school_year TEXT,created_at INTEGER,enrollment_id TEXT)")
            old.execSQL("CREATE TABLE class_groups(id TEXT PRIMARY KEY,class_id TEXT,name TEXT,created_at INTEGER)")
            old.execSQL("CREATE TABLE students(class_id TEXT,installation_id TEXT,profile_id TEXT,assigned_group_id TEXT,name TEXT,first_seen INTEGER,PRIMARY KEY(class_id,installation_id,profile_id))")
            old.execSQL("CREATE TABLE events(class_id TEXT,installation_id TEXT,event_id TEXT,profile_id TEXT,event_name TEXT,correct INTEGER,occurred_at INTEGER,received_at INTEGER,props TEXT,PRIMARY KEY(class_id,installation_id,event_id))")
            old.execSQL("CREATE TABLE devices(class_id TEXT,installation_id TEXT,last_sync INTEGER,PRIMARY KEY(class_id,installation_id))")
            old.execSQL("CREATE TABLE issues(id TEXT PRIMARY KEY,category TEXT,details TEXT,created_at INTEGER)")
            old.execSQL("INSERT INTO school_classes VALUES(?,?,?,?,?,?,?,?)", arrayOf(classId, "Perseverance", "Jannie", "Calapacuan", "6", "2026–2027", 1, enrollmentId))
            old.execSQL("INSERT INTO class_groups VALUES(?,?,?,?)", arrayOf(groupId, classId, "Old group", 1))
            old.execSQL("INSERT INTO students VALUES(?,?,?,?,?,?)", arrayOf(classId, "installation-123456789", "student-profile-123456789", groupId, "Student", 2))
            old.execSQL("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)", arrayOf(classId, "installation-123456789", "card-event-123456789", "student-profile-123456789", "card_viewed", 0, 1780000000000, 1780000000000, "{}"))
            old.execSQL("INSERT INTO devices VALUES(?,?,?)", arrayOf(classId, "installation-123456789", 1780000000000))
            old.execSQL("INSERT INTO issues VALUES('issue-1','App problem','Saved issue',1)")
            old.version = 3
        }
        val database = TalaDatabase(context)
        try {
            assertEquals(enrollmentId, database.classes().single().enrollmentId)
            assertEquals("Perseverance", database.classes().single().name)
            assertEquals(1, database.students().single().cards)
            assertEquals(1780000000000, database.students().single().lastSync)
            assertEquals(1, database.issueCount())
            assertEquals(listOf("Jannie"), database.options("teacher"))
            assertFalse(database.readableDatabase.rawQuery(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='class_groups'", null
            ).use { it.moveToFirst() })
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }

    @Test
    fun versionFourGuestAndActivitySurviveUpgrade() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.deleteDatabase("hiraia-tala.db")
        val classId = "class-123456789012345"
        val enrollmentId = "enrollment-123456789"
        val installationId = "installation-123456789"
        val profileId = "guest-profile-123456789"
        context.openOrCreateDatabase("hiraia-tala.db", 0, null).use { old ->
            old.execSQL("""CREATE TABLE school_classes(id TEXT PRIMARY KEY,enrollment_id TEXT,name TEXT,
                teacher_name TEXT,school_name TEXT,grade_level TEXT,school_year TEXT,created_at INTEGER)""")
            old.execSQL("""CREATE TABLE students(class_id TEXT,installation_id TEXT,profile_id TEXT,
                name TEXT,first_seen INTEGER,PRIMARY KEY(class_id,installation_id,profile_id))""")
            old.execSQL("""CREATE TABLE events(class_id TEXT,installation_id TEXT,event_id TEXT,
                profile_id TEXT,event_name TEXT,correct INTEGER,occurred_at INTEGER,received_at INTEGER,
                props TEXT,PRIMARY KEY(class_id,installation_id,event_id))""")
            old.execSQL("""CREATE TABLE devices(class_id TEXT,installation_id TEXT,last_sync INTEGER,
                PRIMARY KEY(class_id,installation_id))""")
            old.execSQL("INSERT INTO school_classes VALUES(?,?,?,?,?,?,?,?)",
                arrayOf(classId, enrollmentId, "Perseverance", "Jannie", "Calapacuan", "6", "2026–2027", 1))
            old.execSQL("INSERT INTO students VALUES(?,?,?,?,?)",
                arrayOf(classId, installationId, profileId, "Guest", 2))
            old.execSQL("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)",
                arrayOf(classId, installationId, "guest-event-123456789", "guest", "card_viewed",
                    0, 1780000000000L, 1780000000000L, "{}"))
            old.execSQL("INSERT INTO devices VALUES(?,?,?)",
                arrayOf(classId, installationId, 1780000000000L))
            old.version = 4
        }
        val database = TalaDatabase(context)
        try {
            val guest = database.students().single()
            assertTrue(guest.name.startsWith("Guest-"))
            assertEquals(1, guest.cards)
            assertEquals(1780000000000L, guest.lastSeen)
            assertEquals(enrollmentId, database.classes().single().enrollmentId)
        } finally {
            database.close()
            context.deleteDatabase("hiraia-tala.db")
        }
    }
}
