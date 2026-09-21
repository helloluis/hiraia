package com.hiraia.tala

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ActivityRelayTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val installation = "student_installation_1234"
    private fun event(n: Int) = JSONObject().put("id", "student_event_000000$n").put("name", "card_viewed")
        .put("occurred_at", 1760000000000L).put("session_id", "student_session_123456")
        .put("props", JSONObject().put("grade", 5).put("language", "tagalog").put("source", "curated")
            .put("card_id", "card-123").put("profile_kind", "student").put("profile_id", "student_profile_123456"))
    private fun batch(enrollment: String, events: List<JSONObject>) = JSONObject()
        .put("schema", 1).put("class_id", enrollment).put("installation_id", installation)
        .put("profiles", JSONArray().put(JSONObject().put("id", "student_profile_123456").put("name", "Ana")))
        .put("events", JSONArray(events))
    private fun ack(pending: RelayBatch) = JSONObject().put("reporter_recorded", true)
        .put("acknowledged", JSONArray((0 until pending.events.length()).map { pending.events.getJSONObject(it).getString("id") }))
        .put("rejected", JSONArray())

    @Test fun studentVersionsSurviveRelayAndTeacherVersionUsesInstalledPackage() {
        val input = event(9)
        input.getJSONObject("props").put("app_version", "0.4.19").put("build", "19")
            .put("hiraiapedia_version", "1.5").put("cards_db_version", "eaacc6f34090")
        val clean = ActivityRelay.event(input, installation)
        assertEquals("1.5", clean.getJSONObject("props").getString("hiraiapedia_version"))
        assertEquals("eaacc6f34090", clean.getJSONObject("props").getString("cards_db_version"))
        val installed = AppVersion.installed(context)
        val body = ActivityRelay.body(RelayBatch("class", installation, JSONArray().put(clean), JSONArray()),
            "teacher_installation_1234", installed.version)
        assertEquals(context.packageManager.getPackageInfo(context.packageName, 0).versionName,
            body.getJSONObject("reporter").getString("version"))
        assertEquals("0.4.19", body.getJSONArray("events").getJSONObject(0).getJSONObject("props").getString("app_version"))
        assertEquals(context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode, installed.build)
    }

    @Test fun relayKeepsOriginalIdsSanitizesNamesAndSurvivesLostAckAndReopen() {
        context.deleteDatabase("hiraia-tala.db")
        var reporter = ""
        try {
            TalaDatabase(context).use { db ->
                val classroom = db.classes().single()
                val input = event(1)
                input.getJSONObject("props").put("name", "Private name").put("answer", "Private answer")
                db.ingest(classroom.enrollmentId, batch(classroom.enrollmentId, listOf(input)))
                reporter = db.reporterId()
                val pending = db.pendingActivity()!!
                val body = ActivityRelay.body(pending, reporter, "0.4.1")
                assertEquals("tala", body.getJSONObject("reporter").getString("app"))
                assertEquals(installation, body.getString("installation_id"))
                assertFalse(body.toString().contains("Private"))
                assertFalse(body.has("profiles"))
                assertEquals("student_session_123456", pending.events.getJSONObject(0).getString("session_id"))
                assertEquals(0, pending.reconstructed.length())
                // Native ACK lost: retransmission must not multiply classroom or relay records.
                db.ingest(classroom.enrollmentId, batch(classroom.enrollmentId, listOf(input)))
                assertEquals(1, db.pendingActivity()!!.events.length())
                assertEquals(1, db.students(classroom.id).single().cards)
                assertTrue(runCatching { db.acknowledgeActivity(pending, JSONObject()
                    .put("acknowledged", JSONArray().put(input.getString("id"))).put("rejected", JSONArray())) }.isFailure)
                assertNotNull(db.pendingActivity())
            }
            TalaDatabase(context).use { db ->
                assertEquals(reporter, db.reporterId())
                val pending = db.pendingActivity()!!
                val foreign = ack(pending).put("rejected", JSONArray().put("someone_else_123456"))
                assertTrue(runCatching { db.acknowledgeActivity(pending, foreign) }.isFailure)
                assertNotNull(db.pendingActivity())
                db.acknowledgeActivity(pending, ack(pending))
                assertNull(db.pendingActivity())
                val classroom = db.classes().single()
                db.ingest(classroom.enrollmentId, batch(classroom.enrollmentId, listOf(event(1))))
                assertNull(db.pendingActivity())
                assertEquals(1, db.students(classroom.id).single().cards)
            }
        } finally { context.deleteDatabase("hiraia-tala.db") }
    }

    @Test fun versionSevenUpgradePreservesClassroomDataAndLabelsLegacyRelay() {
        context.deleteDatabase("hiraia-tala.db")
        try {
            TalaDatabase(context).use { db ->
                val classroom = db.classes().single()
                db.ingest(classroom.enrollmentId, batch(classroom.enrollmentId, listOf(event(2))))
                db.writableDatabase.execSQL("DROP TABLE activity_relay")
                db.writableDatabase.execSQL("DROP TABLE relay_identity")
                db.writableDatabase.version = 7
            }
            TalaDatabase(context).use { db ->
                assertEquals(1, db.students().single().cards)
                val pending = db.pendingActivity()!!
                assertEquals(event(2).getString("id"), pending.reconstructed.getString(0))
                assertEquals(installation, pending.events.getJSONObject(0).getString("session_id"))
                db.acknowledgeActivity(pending, ack(pending))
                assertNull(db.pendingActivity())
            }
        } finally { context.deleteDatabase("hiraia-tala.db") }
    }

    @Test fun offlineAndPartialServerAckRetainOnlyUnacknowledgedWork() {
        context.deleteDatabase("hiraia-tala.db")
        context.getSharedPreferences("activity-upload", 0).edit().clear().commit()
        try {
            TalaDatabase(context).use { db ->
                val enrollment = db.classes().single().enrollmentId
                db.ingest(enrollment, batch(enrollment, listOf(event(3), event(4), event(5))))
            }
            assertTrue(runCatching { ActivityUploader.uploadPending(context, send = { error("offline") }) }.isFailure)
            TalaDatabase(context).use { db ->
                val pending = db.pendingActivity()!!
                assertEquals(3, pending.events.length())
                db.acknowledgeActivity(pending, JSONObject().put("reporter_recorded", true)
                    .put("acknowledged", JSONArray().put(event(3).getString("id")))
                    .put("rejected", JSONArray().put(event(4).getString("id"))))
                assertEquals(event(5).getString("id"), db.pendingActivity()!!.events.getJSONObject(0).getString("id"))
                assertEquals(3, db.students().single().cards)
            }
            assertTrue(ActivityUploader.uploadPending(context, send = { body ->
                JSONObject().put("reporter_recorded", true).put("acknowledged",
                    JSONArray().put(body.getJSONArray("events").getJSONObject(0).getString("id")))
                    .put("rejected", JSONArray())
            }))
        } finally { context.deleteDatabase("hiraia-tala.db") }
    }
}
