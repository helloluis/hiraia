package com.hiraia.tala

import android.content.Context
import android.net.Uri
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class StudentRow(
    val classId: String,
    val installationId: String,
    val profileId: String,
    val name: String,
    val cards: Int,
    val quizzes: Int,
    val correct: Int,
    val failures: Int,
    val events: Int,
    val lastSync: Long,
    val lastSeen: Long,
    val lastAccepted: Int,
    val lastRejected: Int,
    /** When the student's phone said they left this class; 0 while they are in it. */
    val leftAt: Long = 0
)

data class IngestResult(val accepted: List<String>, val rejected: List<String>)

data class StoredEvent(
    val installationId: String,
    val profileId: String,
    val eventId: String,
    val name: String,
    val occurredAt: Long,
    val receivedAt: Long,
    val correct: Boolean,
    val props: String
)

data class IssueMedia(val id: String, val name: String, val mime: String, val size: Long, val path: String)

data class IssueReport(
    val id: String,
    val category: String,
    val details: String,
    val createdAt: Long,
    val className: String,
    val schoolName: String,
    val teacherName: String,
    val media: List<IssueMedia>
)

data class SchoolClass(
    val id: String,
    val enrollmentId: String,
    val name: String,
    val teacherName: String,
    val schoolName: String,
    val gradeLevel: String,
    val schoolYear: String
)

class TalaDatabase(private val context: Context) : SQLiteOpenHelper(context, "hiraia-tala.db", null, 9) {
    private val legacyGroupId = ClassIdentity.legacyClassId(context)
    private val random = SecureRandom()

    override fun onCreate(db: SQLiteDatabase) {
        createClassTables(db)
        createTelemetryTables(db)
        createAvatarTable(db)
        createOptionTable(db)
        createIssueTables(db)
        insertDefaultClass(db)
        createRelayTables(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            createClassTablesV2(db)
            insertDefaultClassV2(db)
            db.execSQL("ALTER TABLE students RENAME TO old_students")
            db.execSQL("ALTER TABLE events RENAME TO old_events")
            db.execSQL("ALTER TABLE devices RENAME TO old_devices")
            db.execSQL("DROP INDEX IF EXISTS events_profile_time")
            db.execSQL("""CREATE TABLE students (
                group_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
                name TEXT NOT NULL, first_seen INTEGER NOT NULL,
                PRIMARY KEY (group_id, installation_id, profile_id))""")
            db.execSQL("""CREATE TABLE events (
                group_id TEXT NOT NULL, installation_id TEXT NOT NULL, event_id TEXT NOT NULL,
                profile_id TEXT NOT NULL, event_name TEXT NOT NULL, correct INTEGER NOT NULL,
                occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, props TEXT NOT NULL,
                PRIMARY KEY (group_id, installation_id, event_id))""")
            db.execSQL("CREATE INDEX events_profile_time ON events(group_id, installation_id, profile_id, occurred_at)")
            db.execSQL("""CREATE TABLE devices (
                group_id TEXT NOT NULL, installation_id TEXT NOT NULL, last_sync INTEGER NOT NULL,
                PRIMARY KEY (group_id, installation_id))""")
            db.execSQL("INSERT INTO students SELECT ?,installation_id,profile_id,name,first_seen FROM old_students", arrayOf(legacyGroupId))
            db.execSQL("""INSERT INTO events SELECT ?,installation_id,event_id,profile_id,event_name,
                correct,occurred_at,received_at,props FROM old_events""", arrayOf(legacyGroupId))
            db.execSQL("INSERT INTO devices SELECT ?,installation_id,last_sync FROM old_devices", arrayOf(legacyGroupId))
            db.execSQL("DROP TABLE old_students")
            db.execSQL("DROP TABLE old_events")
            db.execSQL("DROP TABLE old_devices")
        }
        if (oldVersion < 3) migrateToClassEnrollment(db)
        if (oldVersion < 4) migrateFromGroups(db)
        if (oldVersion < 5) migrateActivityState(db)
        if (oldVersion < 6) migrateIssues(db)
        if (oldVersion < 7) createAvatarTable(db)
        if (oldVersion < 8) {
            createRelayTables(db)
            // Prior Tala versions kept props but not session IDs. Preserve IDs/dates and
            // explicitly label these records as reconstructed instead of inventing a session.
            db.rawQuery("SELECT class_id,installation_id,event_id,event_name,occurred_at,props FROM events", null).use { c ->
                while (c.moveToNext()) {
                    val event = JSONObject().put("id", c.getString(2)).put("name", c.getString(3))
                        .put("occurred_at", c.getLong(4)).put("session_id", c.getString(1))
                        .put("props", JSONObject(c.getString(5))).put("reconstructed", true)
                    saveRelay(db, c.getString(0), c.getString(1), event)
                }
            }
        }
        if (oldVersion < 9) migrateStudentStatus(db)
    }

    /**
     * A student row now outlives its place in the class. `left_at` is set when the student's
     * phone reports the profile left, and cleared when it lists the profile again; `removed_at`
     * is the teacher's Remove from class, which nothing the phone sends can undo.
     */
    private fun migrateStudentStatus(db: SQLiteDatabase) {
        // Upgrade tests fake an older version on a current database, whose table has them.
        val columns = db.rawQuery("PRAGMA table_info(students)", null).use { cursor ->
            buildSet { while (cursor.moveToNext()) add(cursor.getString(1)) }
        }
        for (column in listOf("left_at", "removed_at"))
            if (column !in columns) db.execSQL("ALTER TABLE students ADD COLUMN $column INTEGER")
    }

    private fun createRelayTables(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE activity_relay (
            class_id TEXT NOT NULL, installation_id TEXT NOT NULL, event_id TEXT NOT NULL,
            payload TEXT NOT NULL, reconstructed INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
            PRIMARY KEY(class_id,installation_id,event_id))""")
        db.execSQL("CREATE INDEX activity_relay_pending ON activity_relay(state,class_id,installation_id)")
        db.execSQL("CREATE TABLE relay_identity(id TEXT PRIMARY KEY)")
        db.execSQL("INSERT INTO relay_identity VALUES(?)", arrayOf(UUID.randomUUID().toString()))
    }

    fun reporterId(): String = readableDatabase.rawQuery("SELECT id FROM relay_identity", null).use {
        check(it.moveToFirst()); it.getString(0)
    }

    private fun saveRelay(db: SQLiteDatabase, classId: String, installation: String, event: JSONObject) {
        val payload = ActivityRelay.event(event, installation)
        db.execSQL("""INSERT OR IGNORE INTO activity_relay
            (class_id,installation_id,event_id,payload,reconstructed) VALUES(?,?,?,?,?)""",
            arrayOf(classId, installation, event.getString("id"), payload.toString(),
                if (event.optBoolean("reconstructed") || !ID.matches(event.optString("session_id"))) 1 else 0))
    }

    fun activityDeliverySummary(): String {
        val counts = mutableMapOf<String, Int>()
        readableDatabase.rawQuery("SELECT state,count(*) FROM activity_relay GROUP BY state", null).use {
            while (it.moveToNext()) counts[it.getString(0)] = it.getInt(1)
        }
        return "${counts["pending"] ?: 0} awaiting upload · ${counts["accepted"] ?: 0} delivered" +
            if ((counts["rejected"] ?: 0) > 0) " · ${counts["rejected"]} rejected (kept on this phone)" else ""
    }

    fun pendingActivity(): RelayBatch? {
        val group = readableDatabase.rawQuery("""SELECT class_id,installation_id FROM activity_relay
            WHERE state='pending' ORDER BY rowid LIMIT 1""", null).use {
            if (!it.moveToFirst()) return null
            it.getString(0) to it.getString(1)
        }
        val events = JSONArray()
        val reconstructed = JSONArray()
        readableDatabase.rawQuery("""SELECT event_id,payload,reconstructed FROM activity_relay
            WHERE state='pending' AND class_id=? AND installation_id=? ORDER BY rowid LIMIT 50""",
            arrayOf(group.first, group.second)).use { c ->
            while (c.moveToNext()) {
                events.put(JSONObject(c.getString(1)))
                if (c.getInt(2) != 0) reconstructed.put(c.getString(0))
            }
        }
        return RelayBatch(group.first, group.second, events, reconstructed)
    }

    fun acknowledgeActivity(batch: RelayBatch, response: JSONObject) {
        val states = ActivityRelay.acknowledgments(batch, response)
        writableDatabase.beginTransaction()
        try {
            for ((id, state) in states) writableDatabase.execSQL("""UPDATE activity_relay SET state=?
                WHERE class_id=? AND installation_id=? AND event_id=? AND state='pending'""",
                arrayOf(state, batch.classId, batch.installationId, id))
            writableDatabase.setTransactionSuccessful()
        } finally { writableDatabase.endTransaction() }
    }

    private fun createAvatarTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE student_avatars (
            class_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
            animal_index INTEGER NOT NULL, color_index INTEGER NOT NULL,
            PRIMARY KEY (class_id, installation_id, profile_id))""")
    }

    private fun createIssueTables(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE issues (
            id TEXT PRIMARY KEY, category TEXT NOT NULL, details TEXT NOT NULL,
            created_at INTEGER NOT NULL, class_name TEXT NOT NULL DEFAULT '',
            school_name TEXT NOT NULL DEFAULT '', teacher_name TEXT NOT NULL DEFAULT '',
            sent_at INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '')""")
        db.execSQL("""CREATE TABLE issue_media (
            id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, name TEXT NOT NULL,
            mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL)""")
        db.execSQL("CREATE INDEX issue_media_report ON issue_media(issue_id)")
    }

    private fun migrateIssues(db: SQLiteDatabase) {
        val hasIssues = db.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name='issues'",
            null).use { it.moveToFirst() }
        if (!hasIssues) {
            createIssueTables(db)
            return
        }
        for (field in listOf(
            "class_name TEXT NOT NULL DEFAULT ''", "school_name TEXT NOT NULL DEFAULT ''",
            "teacher_name TEXT NOT NULL DEFAULT ''", "sent_at INTEGER NOT NULL DEFAULT 0",
            "last_error TEXT NOT NULL DEFAULT ''"
        )) db.execSQL("ALTER TABLE issues ADD COLUMN $field")
        db.execSQL("""CREATE TABLE issue_media (
            id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, name TEXT NOT NULL,
            mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL)""")
        db.execSQL("CREATE INDEX issue_media_report ON issue_media(issue_id)")
    }

    private fun createClassTables(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE school_classes (
            id TEXT PRIMARY KEY, enrollment_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, teacher_name TEXT NOT NULL,
            school_name TEXT NOT NULL, grade_level TEXT NOT NULL, school_year TEXT NOT NULL,
            created_at INTEGER NOT NULL)""")
    }

    private fun createClassTablesV2(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE school_classes (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, teacher_name TEXT NOT NULL,
            school_name TEXT NOT NULL, grade_level TEXT NOT NULL, school_year TEXT NOT NULL,
            created_at INTEGER NOT NULL)""")
        createGroupTable(db)
    }

    private fun createGroupTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE class_groups (
            id TEXT PRIMARY KEY, class_id TEXT NOT NULL, name TEXT NOT NULL,
            created_at INTEGER NOT NULL)""")
        db.execSQL("CREATE INDEX groups_class ON class_groups(class_id)")
    }

    private fun insertDefaultClass(db: SQLiteDatabase) {
        val classId = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        db.execSQL("""INSERT INTO school_classes
            (id,enrollment_id,name,teacher_name,school_name,grade_level,school_year,created_at)
            VALUES(?,?,?,?,?,?,?,?)""", arrayOf(
            classId, legacyGroupId, "Pilot class", "", "Calapacuan Elementary School", "6", "2026–2027", now
        ))
        insertOption(db, "school", "Calapacuan Elementary School", now)
    }

    private fun insertDefaultClassV2(db: SQLiteDatabase) {
        val classId = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        db.execSQL("INSERT INTO school_classes VALUES(?,?,?,?,?,?,?)", arrayOf(
            classId, "Pilot class", "", "Calapacuan Elementary School", "6", "2026–2027", now
        ))
        db.execSQL("INSERT INTO class_groups VALUES(?,?,?,?)", arrayOf(legacyGroupId, classId, "Main group", now))
    }

    private fun createTelemetryTables(db: SQLiteDatabase, withGroups: Boolean = false,
        withActivityState: Boolean = true) {
        if (withGroups) db.execSQL("""CREATE TABLE students (
            class_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
            assigned_group_id TEXT, name TEXT NOT NULL, first_seen INTEGER NOT NULL,
            PRIMARY KEY (class_id, installation_id, profile_id))""")
        else db.execSQL("""CREATE TABLE students (
            class_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
            name TEXT NOT NULL, first_seen INTEGER NOT NULL, left_at INTEGER, removed_at INTEGER,
            PRIMARY KEY (class_id, installation_id, profile_id))""")
        db.execSQL("""CREATE TABLE events (
            class_id TEXT NOT NULL, installation_id TEXT NOT NULL, event_id TEXT NOT NULL, profile_id TEXT NOT NULL,
            event_name TEXT NOT NULL, correct INTEGER NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
            props TEXT NOT NULL, PRIMARY KEY (class_id, installation_id, event_id))""")
        db.execSQL("CREATE INDEX events_profile_time ON events(class_id, installation_id, profile_id, occurred_at)")
        if (withActivityState) db.execSQL("""CREATE TABLE devices (
            class_id TEXT NOT NULL, installation_id TEXT NOT NULL, last_sync INTEGER NOT NULL,
            last_seen INTEGER NOT NULL, last_accepted INTEGER NOT NULL, last_rejected INTEGER NOT NULL,
            PRIMARY KEY (class_id, installation_id))""")
        else db.execSQL("""CREATE TABLE devices (
            class_id TEXT NOT NULL, installation_id TEXT NOT NULL, last_sync INTEGER NOT NULL,
            PRIMARY KEY (class_id, installation_id))""")
    }

    private fun migrateActivityState(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE devices ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE devices ADD COLUMN last_accepted INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE devices ADD COLUMN last_rejected INTEGER NOT NULL DEFAULT 0")
        db.execSQL("UPDATE devices SET last_seen=last_sync")
        val guests = mutableListOf<Triple<String, String, String>>()
        db.rawQuery("""SELECT class_id,installation_id,profile_id FROM students
            WHERE lower(trim(name))='guest' ORDER BY first_seen,profile_id""", null).use { cursor ->
            while (cursor.moveToNext()) guests.add(Triple(cursor.getString(0), cursor.getString(1), cursor.getString(2)))
        }
        for ((classId, installationId, profileId) in guests) {
            db.execSQL("""UPDATE students SET name=? WHERE class_id=? AND installation_id=? AND profile_id=?""",
                arrayOf(guestAlias(db, classId), classId, installationId, profileId))
            if (profileId != "guest") db.execSQL("""UPDATE events SET profile_id=?
                WHERE class_id=? AND installation_id=? AND profile_id='guest'""",
                arrayOf(profileId, classId, installationId))
        }
        val missingGuests = mutableListOf<Triple<String, String, Long>>()
        db.rawQuery("""SELECT e.class_id,e.installation_id,MIN(e.received_at) FROM events e
            WHERE e.profile_id='guest' AND NOT EXISTS (
                SELECT 1 FROM students s WHERE s.class_id=e.class_id
                AND s.installation_id=e.installation_id AND s.profile_id='guest')
            GROUP BY e.class_id,e.installation_id""", null).use { cursor ->
            while (cursor.moveToNext()) missingGuests.add(Triple(cursor.getString(0), cursor.getString(1), cursor.getLong(2)))
        }
        for ((classId, installationId, firstSeen) in missingGuests) {
            db.execSQL("INSERT OR IGNORE INTO students VALUES(?,?,?,?,?)",
                arrayOf<Any>(classId, installationId, "guest", guestAlias(db, classId), firstSeen))
        }
    }

    private fun migrateToClassEnrollment(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE school_classes ADD COLUMN enrollment_id TEXT")
        db.execSQL("""UPDATE school_classes SET enrollment_id=(SELECT id FROM class_groups
            WHERE class_id=school_classes.id ORDER BY created_at,id LIMIT 1)""")
        db.execSQL("CREATE UNIQUE INDEX class_enrollment ON school_classes(enrollment_id)")
        db.execSQL("ALTER TABLE students RENAME TO old_students_v2")
        db.execSQL("ALTER TABLE events RENAME TO old_events_v2")
        db.execSQL("ALTER TABLE devices RENAME TO old_devices_v2")
        db.execSQL("DROP INDEX IF EXISTS events_profile_time")
        createTelemetryTables(db, withGroups = true, withActivityState = false)
        db.execSQL("""INSERT OR IGNORE INTO students
            SELECT g.class_id,s.installation_id,s.profile_id,s.group_id,s.name,s.first_seen
            FROM old_students_v2 s JOIN class_groups g ON g.id=s.group_id
            ORDER BY s.first_seen,s.group_id""")
        db.execSQL("""INSERT OR IGNORE INTO events
            SELECT g.class_id,e.installation_id,e.event_id,e.profile_id,e.event_name,e.correct,
            e.occurred_at,e.received_at,e.props
            FROM old_events_v2 e JOIN class_groups g ON g.id=e.group_id""")
        db.execSQL("""INSERT OR REPLACE INTO devices
            SELECT g.class_id,d.installation_id,MAX(d.last_sync)
            FROM old_devices_v2 d JOIN class_groups g ON g.id=d.group_id
            GROUP BY g.class_id,d.installation_id""")
        db.execSQL("DROP TABLE old_students_v2")
        db.execSQL("DROP TABLE old_events_v2")
        db.execSQL("DROP TABLE old_devices_v2")
    }

    private fun migrateFromGroups(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE students RENAME TO old_students_v3")
        db.execSQL("""CREATE TABLE students (
            class_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
            name TEXT NOT NULL, first_seen INTEGER NOT NULL,
            PRIMARY KEY (class_id, installation_id, profile_id))""")
        db.execSQL("""INSERT INTO students SELECT class_id,installation_id,profile_id,name,first_seen
            FROM old_students_v3""")
        db.execSQL("DROP TABLE old_students_v3")
        db.execSQL("DROP TABLE class_groups")
        createOptionTable(db)
        for ((kind, column) in listOf("teacher" to "teacher_name", "school" to "school_name")) {
            db.execSQL("""INSERT OR IGNORE INTO class_options(kind,value,created_at)
                SELECT ?, $column, MIN(created_at) FROM school_classes
                WHERE trim($column)!='' GROUP BY $column""", arrayOf(kind))
        }
    }

    private fun createOptionTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE class_options (
            kind TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY (kind, value))""")
    }

    private fun insertOption(db: SQLiteDatabase, kind: String, value: String, now: Long = System.currentTimeMillis()) {
        if (value.isNotBlank()) db.execSQL("INSERT OR IGNORE INTO class_options VALUES(?,?,?)",
            arrayOf<Any>(kind, value.trim(), now))
    }

    fun classes(): List<SchoolClass> {
        val rows = mutableListOf<SchoolClass>()
        readableDatabase.rawQuery("""SELECT id,enrollment_id,name,teacher_name,school_name,grade_level,school_year
            FROM school_classes ORDER BY created_at,name""", null).use { cursor ->
            while (cursor.moveToNext()) rows.add(SchoolClass(
                cursor.getString(0), cursor.getString(1), cursor.getString(2),
                cursor.getString(3), cursor.getString(4), cursor.getString(5), cursor.getString(6)
            ))
        }
        return rows
    }

    fun createClass(name: String, teacherName: String, schoolName: String, gradeLevel: String,
        schoolYear: String): SchoolClass {
        requireFields(name, teacherName, schoolName, gradeLevel, schoolYear)
        require(gradeLevel.toIntOrNull() in 1..12)
        val classId = UUID.randomUUID().toString()
        val enrollmentId = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("""INSERT INTO school_classes
                (id,enrollment_id,name,teacher_name,school_name,grade_level,school_year,created_at)
                VALUES(?,?,?,?,?,?,?,?)""", arrayOf(
                classId, enrollmentId, name.trim(), teacherName.trim(), schoolName.trim(), gradeLevel.trim(), schoolYear.trim(), now
            ))
            insertOption(db, "teacher", teacherName, now)
            insertOption(db, "school", schoolName, now)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return SchoolClass(classId, enrollmentId, name.trim(), teacherName.trim(), schoolName.trim(),
            gradeLevel.trim(), schoolYear.trim())
    }

    fun options(kind: String): List<String> {
        require(kind in OPTION_KINDS)
        val rows = mutableListOf<String>()
        readableDatabase.rawQuery("SELECT value FROM class_options WHERE kind=? ORDER BY lower(value)",
            arrayOf(kind)).use { cursor ->
            while (cursor.moveToNext()) rows.add(cursor.getString(0))
        }
        return rows
    }

    fun addOption(kind: String, value: String) {
        require(kind in OPTION_KINDS)
        requireFields(value)
        insertOption(writableDatabase, kind, value)
    }

    fun updateClass(id: String, name: String, teacherName: String, schoolName: String,
        gradeLevel: String, schoolYear: String) {
        requireFields(name, teacherName, schoolName, gradeLevel, schoolYear)
        require(gradeLevel.toIntOrNull() in 1..12)
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("""UPDATE school_classes SET name=?,teacher_name=?,school_name=?,
                grade_level=?,school_year=? WHERE id=?""", arrayOf(
                name.trim(), teacherName.trim(), schoolName.trim(), gradeLevel.trim(), schoolYear.trim(), id
            ))
            insertOption(db, "teacher", teacherName)
            insertOption(db, "school", schoolName)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun requireFields(vararg values: String) {
        require(values.all { it.isNotBlank() && it.trim().length <= 80 })
    }

    fun ingest(enrollmentId: String, batch: JSONObject, recordSync: Boolean = true): IngestResult {
        require(batch.getInt("schema") == 1 && batch.getString("class_id") == enrollmentId)
        val classId = classes().firstOrNull { it.enrollmentId == enrollmentId }?.id
            ?: throw IllegalArgumentException("Unknown class")
        val installationId = batch.getString("installation_id")
        require(ID.matches(installationId))
        val profiles = batch.optJSONArray("profiles") ?: JSONArray()
        // Profiles the phone says have left this class. Only a student that saw "left_profiles"
        // in this Tala's capabilities sends them; older ones never do.
        val leftProfiles = batch.optJSONArray("left_profiles") ?: JSONArray()
        val events = batch.getJSONArray("events")
        require(profiles.length() <= 50 && leftProfiles.length() <= 50 && events.length() <= 50)
        val accepted = mutableListOf<String>()
        val rejected = mutableListOf<String>()
        val now = System.currentTimeMillis()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val listed = mutableSetOf<String>()
            for (index in 0 until profiles.length()) {
                val profile = profiles.getJSONObject(index)
                val profileId = profile.getString("id")
                val name = profile.getString("name").trim()
                val guest = name.equals("Guest", ignoreCase = true) || profileId == "guest"
                require((ID.matches(profileId) || guest && profileId == "guest") &&
                    name.isNotEmpty() && name.length <= 40)
                listed.add(profileId)
                val existingName = studentName(db, classId, installationId, profileId)
                val syntheticGuest = if (guest && profileId != "guest")
                    studentName(db, classId, installationId, "guest") else null
                // The 'guest' placeholder is what older builds left for this phone without listing
                // anyone. A teacher's removal of it does not bind a Guest that now joins by being
                // listed: that Guest starts afresh, under an alias drawn while the placeholder's is
                // still taken, so the removed tile's name never comes back.
                val syntheticRemoved = syntheticGuest != null &&
                    removedAt(db, classId, installationId, "guest") != null
                val storedName = if (guest) existingName?.takeIf { it.startsWith("Guest-") }
                    ?: syntheticGuest?.takeIf { it.startsWith("Guest-") && !syntheticRemoved }
                    ?: guestAlias(db, classId) else name
                if (syntheticGuest != null) {
                    db.execSQL("""UPDATE events SET profile_id=? WHERE class_id=? AND installation_id=?
                        AND profile_id='guest'""", arrayOf(profileId, classId, installationId))
                    db.execSQL("""UPDATE OR IGNORE student_avatars SET profile_id=?
                        WHERE class_id=? AND installation_id=? AND profile_id='guest'""",
                        arrayOf(profileId, classId, installationId))
                    db.execSQL("""DELETE FROM students WHERE class_id=? AND installation_id=?
                        AND profile_id='guest'""", arrayOf(classId, installationId))
                    db.execSQL("""DELETE FROM student_avatars WHERE class_id=? AND installation_id=?
                        AND profile_id='guest'""", arrayOf(classId, installationId))
                }
                // Being listed means being in the class again, so a student who left is back. A
                // student the teacher removed is not: removal is the teacher's, not the phone's.
                db.execSQL("""INSERT INTO students(class_id,installation_id,profile_id,name,first_seen)
                    VALUES(?,?,?,?,?) ON CONFLICT(class_id,installation_id,profile_id)
                    DO UPDATE SET name=excluded.name,left_at=NULL""",
                    arrayOf(classId, installationId, profileId, storedName, now))
            }
            // Leaving is per profile: a phone shared by students of different classes tells each
            // class only about its own. An id that is not an id is skipped; the rest still counts.
            for (index in 0 until leftProfiles.length()) {
                val profileId = leftProfiles.opt(index) as? String ?: continue
                if (!ID.matches(profileId) || profileId in listed) continue
                // The phone's Guest goes by its installation id. An older build could also have left
                // a 'guest' placeholder for it here, which is the same Guest and leaves with it.
                val placeholder = if (profileId == installationId && "guest" !in listed) "guest" else profileId
                db.execSQL("""UPDATE students SET left_at=? WHERE class_id=? AND installation_id=?
                    AND profile_id IN (?,?) AND left_at IS NULL""",
                    arrayOf<Any>(now, classId, installationId, profileId, placeholder))
            }
            // A phone that only came to say its profiles left must not leave a Guest tile behind.
            if (!recordSync && profiles.length() == 0 && leftProfiles.length() == 0 &&
                !hasStudents(db, classId, installationId))
                ensureGuestRow(db, classId, installationId, now)
            for (index in 0 until events.length()) {
                val event = events.getJSONObject(index)
                val eventId = event.getString("id")
                require(ID.matches(eventId))
                val name = event.optString("name")
                val occurredAt = event.optLong("occurred_at")
                val props = event.optJSONObject("props")
                val profileId = if (props?.optString("profile_kind") == "student")
                    props.optString("profile_id") else ensureGuestRow(db, classId, installationId, now)
                if (name !in EVENTS || occurredAt !in 1577836800000L..8640000000000000L ||
                    props == null || props.toString().length > 1600 ||
                    (profileId != "guest" && !ID.matches(profileId))) {
                    rejected.add(eventId)
                    continue
                }
                // A removed student's phone was never told and would resend forever, so the event
                // is acknowledged as taken — but nothing of it is kept or relayed.
                if (removedAt(db, classId, installationId, profileId) != null) {
                    accepted.add(eventId)
                    continue
                }
                db.execSQL("""INSERT OR IGNORE INTO events
                    (class_id,installation_id,event_id,profile_id,event_name,correct,occurred_at,received_at,props)
                    VALUES(?,?,?,?,?,?,?,?,?)""", arrayOf(
                    classId, installationId, eventId, profileId, name,
                    if (props.optBoolean("correct")) 1 else 0, occurredAt, now, props.toString()
                ))
                if (studentName(db, classId, installationId, profileId) == null) {
                    db.execSQL("""INSERT OR IGNORE INTO students(class_id,installation_id,profile_id,name,first_seen)
                        VALUES(?,?,?,?,?)""", arrayOf(classId, installationId, profileId, "Recovered student", now))
                }
                saveRelay(db, classId, installationId, event)
                accepted.add(eventId)
            }
            if (recordSync) db.execSQL("""INSERT INTO devices
                (class_id,installation_id,last_sync,last_seen,last_accepted,last_rejected)
                VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,installation_id) DO UPDATE SET
                last_sync=excluded.last_sync,last_seen=excluded.last_seen,
                last_accepted=CASE WHEN ? > 0 THEN excluded.last_accepted ELSE devices.last_accepted END,
                last_rejected=CASE WHEN ? > 0 THEN excluded.last_rejected ELSE devices.last_rejected END""",
                arrayOf<Any>(classId, installationId, now, now, accepted.size, rejected.size,
                    events.length(), events.length()))
            else db.execSQL("""INSERT INTO devices
                (class_id,installation_id,last_sync,last_seen,last_accepted,last_rejected)
                VALUES(?,?,0,?,0,0) ON CONFLICT(class_id,installation_id)
                DO UPDATE SET last_seen=excluded.last_seen""", arrayOf(classId, installationId, now))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return IngestResult(accepted, rejected)
    }

    private fun studentName(db: SQLiteDatabase, classId: String, installationId: String,
        profileId: String): String? = db.rawQuery("""SELECT name FROM students
            WHERE class_id=? AND installation_id=? AND profile_id=?""",
            arrayOf(classId, installationId, profileId)).use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    }

    private fun hasStudents(db: SQLiteDatabase, classId: String, installationId: String): Boolean =
        db.rawQuery("SELECT 1 FROM students WHERE class_id=? AND installation_id=? LIMIT 1",
            arrayOf(classId, installationId)).use { it.moveToFirst() }

    private fun ensureGuestRow(db: SQLiteDatabase, classId: String, installationId: String, now: Long): String {
        db.rawQuery("""SELECT profile_id FROM students WHERE class_id=? AND installation_id=?
            AND name GLOB 'Guest-*' ORDER BY first_seen,profile_id LIMIT 1""",
            arrayOf(classId, installationId)).use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0)
        }
        db.execSQL("INSERT INTO students(class_id,installation_id,profile_id,name,first_seen) VALUES(?,?,?,?,?)",
            arrayOf<Any>(classId, installationId, "guest", guestAlias(db, classId), now))
        return "guest"
    }

    private fun removedAt(db: SQLiteDatabase, classId: String, installationId: String,
        profileId: String): Long? = db.rawQuery("""SELECT removed_at FROM students
            WHERE class_id=? AND installation_id=? AND profile_id=? AND removed_at IS NOT NULL""",
            arrayOf(classId, installationId, profileId)).use { cursor ->
        if (cursor.moveToFirst()) cursor.getLong(0) else null
    }

    private fun guestAlias(db: SQLiteDatabase, classId: String): String {
        while (true) {
            val code = CharArray(6) { GUEST_ALPHABET[random.nextInt(GUEST_ALPHABET.length)] }
            val candidate = "Guest-${String(code)}"
            val taken = db.rawQuery("""SELECT 1 FROM students
                WHERE class_id=? AND name=? COLLATE NOCASE LIMIT 1""",
                arrayOf(classId, candidate)).use { it.moveToFirst() }
            if (!taken) return candidate
        }
    }

    /**
     * The students in a class (or on this phone), with their totals. A student the teacher
     * removed is never listed; one whose phone said they left only when [includeLeft] asks.
     */
    fun students(classId: String? = null, includeLeft: Boolean = false): List<StudentRow> {
        val rows = mutableListOf<StudentRow>()
        val conditions = mutableListOf("s.removed_at IS NULL")
        val arguments = mutableListOf<String>()
        if (classId != null) {
            conditions.add("s.class_id=?")
            arguments.add(classId)
        }
        if (!includeLeft) conditions.add("s.left_at IS NULL")
        val where = "WHERE ${conditions.joinToString(" AND ")}"
        readableDatabase.rawQuery("""SELECT s.class_id,s.installation_id,s.profile_id,s.name,
            COALESCE(SUM(e.event_name='card_viewed'),0),
            COALESCE(SUM(e.event_name='quiz_graded'),0),
            COALESCE(SUM(e.event_name='quiz_graded' AND e.correct=1),0),
            COALESCE(SUM(e.event_name IN ('download_failed','model_load_failed','generation_failed')),0),
            COUNT(e.event_id),COALESCE(d.last_sync,0),COALESCE(d.last_seen,0),
            COALESCE(d.last_accepted,0),COALESCE(d.last_rejected,0),COALESCE(s.left_at,0)
            FROM students s
            LEFT JOIN events e ON e.class_id=s.class_id AND e.installation_id=s.installation_id
                AND e.profile_id=s.profile_id
            LEFT JOIN devices d ON d.class_id=s.class_id AND d.installation_id=s.installation_id
            $where GROUP BY s.class_id,s.installation_id,s.profile_id
            ORDER BY lower(s.name),s.profile_id""", arguments.toTypedArray()).use { cursor ->
            while (cursor.moveToNext()) rows.add(StudentRow(
                cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3),
                cursor.getInt(4), cursor.getInt(5), cursor.getInt(6), cursor.getInt(7),
                cursor.getInt(8), cursor.getLong(9), cursor.getLong(10), cursor.getInt(11), cursor.getInt(12),
                cursor.getLong(13)
            ))
        }
        return rows
    }

    /**
     * The class as the teacher sees it: the students still in it, or with [includeLeft] also
     * those who left, for the spreadsheet. Duplicate names are numbered across both, so a
     * student who leaves or comes back never makes a classmate's "-2" move.
     */
    fun classRoster(schoolClass: SchoolClass, includeLeft: Boolean = false): List<RosterCard> =
        rosterCards(schoolClass, students(schoolClass.id, includeLeft = true))
            .filter { includeLeft || it.student.leftAt == 0L }

    /**
     * The teacher's Remove from class. The student's activity on this phone goes, including
     * anything not yet relayed, and they disappear from the class and its spreadsheet. The row
     * itself stays behind as the marker ingest checks: the phone is never told, so it keeps
     * listing the profile and sending its events, and neither may bring the student back.
     */
    fun removeStudent(student: StudentRow) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val key = arrayOf(student.classId, student.installationId, student.profileId)
            db.execSQL("""UPDATE students SET removed_at=? WHERE class_id=? AND installation_id=?
                AND profile_id=? AND removed_at IS NULL""", arrayOf<Any>(System.currentTimeMillis(), *key))
            db.execSQL("""DELETE FROM activity_relay WHERE state='pending' AND class_id=? AND installation_id=?
                AND event_id IN (SELECT event_id FROM events WHERE class_id=? AND installation_id=?
                AND profile_id=?)""", arrayOf(student.classId, student.installationId, *key))
            db.execSQL("DELETE FROM events WHERE class_id=? AND installation_id=? AND profile_id=?", key)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun rosterCards(schoolClass: SchoolClass, students: List<StudentRow>): List<RosterCard> {
        val proposed = RosterIdentity.cards(students)
        if (proposed.isEmpty()) return proposed
        val db = writableDatabase
        val assigned = mutableMapOf<Pair<String, String>, Pair<Int, Int>>()
        db.rawQuery("""SELECT installation_id,profile_id,animal_index,color_index
            FROM student_avatars WHERE class_id=?""", arrayOf(schoolClass.id)).use { cursor ->
            while (cursor.moveToNext()) assigned[cursor.getString(0) to cursor.getString(1)] =
                cursor.getInt(2) to cursor.getInt(3)
        }
        for (card in proposed) {
            val key = card.student.installationId to card.student.profileId
            if (key !in assigned) {
                db.execSQL("""INSERT OR IGNORE INTO student_avatars
                    (class_id,installation_id,profile_id,animal_index,color_index) VALUES(?,?,?,?,?)""",
                    arrayOf(schoolClass.id, key.first, key.second, card.animalIndex, card.colorIndex))
            }
        }
        return proposed.map { card ->
            val saved = db.rawQuery("""SELECT animal_index,color_index FROM student_avatars
                WHERE class_id=? AND installation_id=? AND profile_id=?""",
                arrayOf(schoolClass.id, card.student.installationId, card.student.profileId)).use { cursor ->
                check(cursor.moveToFirst())
                cursor.getInt(0) to cursor.getInt(1)
            }
            card.copy(animalIndex = saved.first, colorIndex = saved.second)
        }
    }

    fun eventSnapshot(classId: String): Long = readableDatabase.rawQuery(
        "SELECT COALESCE(MAX(rowid),0) FROM events WHERE class_id=?", arrayOf(classId)).use {
        it.moveToFirst()
        it.getLong(0)
    }

    fun eventCount(classId: String, throughRowId: Long = Long.MAX_VALUE): Int = readableDatabase.rawQuery(
        "SELECT COUNT(*) FROM events WHERE class_id=? AND rowid<=?",
        arrayOf(classId, throughRowId.toString())).use {
        it.moveToFirst()
        it.getInt(0)
    }

    /**
     * Count activity by its learner-recorded time, rather than a later reconnection time. Like
     * the roster it sits under, it leaves out students who left the class.
     */
    fun eventCountSince(classId: String, since: Long): Int = readableDatabase.rawQuery(
        """SELECT COUNT(*) FROM events e WHERE e.class_id=? AND e.occurred_at>=? AND NOT EXISTS (
            SELECT 1 FROM students s WHERE s.class_id=e.class_id AND s.installation_id=e.installation_id
            AND s.profile_id=e.profile_id AND s.left_at IS NOT NULL)""",
        arrayOf(classId, since.toString())).use {
        it.moveToFirst()
        it.getInt(0)
    }

    /**
     * A student's card views and graded quizzes in [from, until), by the learner-recorded time —
     * so activity that reaches Tala days later still lands on the day it happened.
     */
    fun learningEvents(student: StudentRow, from: Long = Long.MIN_VALUE,
        until: Long = Long.MAX_VALUE): List<LearningEvent> {
        val rows = mutableListOf<LearningEvent>()
        readableDatabase.rawQuery("""SELECT event_name,occurred_at,correct,props FROM events
            WHERE class_id=? AND installation_id=? AND profile_id=?
            AND event_name IN ('card_viewed','quiz_graded') AND occurred_at>=? AND occurred_at<?""",
            arrayOf(student.classId, student.installationId, student.profileId,
                from.toString(), until.toString())).use { cursor ->
            while (cursor.moveToNext()) rows.add(learningEvent(cursor.getString(0), cursor.getLong(1),
                cursor.getInt(2) != 0, cursor.getString(3)))
        }
        return rows
    }

    /**
     * The student's most recent days with any learning before [before], newest first, each with
     * all of that day's events. Days are calendar days in [zone]; a day with nothing is skipped
     * rather than shown empty. Page backwards by passing the start of the oldest day returned.
     */
    fun learningDays(student: StudentRow, before: Long, count: Int,
        zone: ZoneId): List<Pair<LocalDate, List<LearningEvent>>> {
        val days = mutableListOf<Pair<LocalDate, List<LearningEvent>>>()
        var cursor = before
        while (days.size < count) {
            val latest = latestLearningBefore(student, cursor) ?: break
            val date = Instant.ofEpochMilli(latest).atZone(zone).toLocalDate()
            val start = date.atStartOfDay(zone).toInstant().toEpochMilli()
            days.add(date to learningEvents(student, start, date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()))
            cursor = start
        }
        return days
    }

    /** When the student last viewed a card or answered a quiz before [before], if ever. */
    fun latestLearningBefore(student: StudentRow, before: Long): Long? = readableDatabase.rawQuery(
        """SELECT occurred_at FROM events WHERE class_id=? AND installation_id=? AND profile_id=?
        AND event_name IN ('card_viewed','quiz_graded') AND occurred_at<?
        ORDER BY occurred_at DESC LIMIT 1""",
        arrayOf(student.classId, student.installationId, student.profileId, before.toString())).use {
        if (it.moveToFirst()) it.getLong(0) else null
    }

    fun activityTotals(student: StudentRow, from: Long = Long.MIN_VALUE,
        until: Long = Long.MAX_VALUE): ActivityTotals = ActivityTotals.of(learningEvents(student, from, until))

    fun uniqueCards(student: StudentRow): Int = activityTotals(student).unique

    fun forEachEvent(classId: String, throughRowId: Long = Long.MAX_VALUE,
        action: (StoredEvent) -> Unit) {
        readableDatabase.rawQuery("""SELECT installation_id,profile_id,event_id,event_name,
            occurred_at,received_at,correct,props FROM events WHERE class_id=? AND rowid<=?
            ORDER BY received_at,occurred_at,event_id""",
            arrayOf(classId, throughRowId.toString())).use { cursor ->
            while (cursor.moveToNext()) action(eventFrom(cursor))
        }
    }

    private fun eventFrom(cursor: android.database.Cursor): StoredEvent = StoredEvent(
        cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3),
        cursor.getLong(4), cursor.getLong(5), cursor.getInt(6) != 0, cursor.getString(7)
    )

    fun addIssue(category: String, details: String, schoolClass: SchoolClass,
        uris: List<Uri> = emptyList()): String {
        require(category in ISSUE_CATEGORIES && details.isNotBlank() && details.length <= 2000)
        require(uris.size <= 3) { "Choose up to 3 images or videos." }
        val id = UUID.randomUUID().toString()
        val folder = File(context.filesDir, "issue-media/$id")
        val media = mutableListOf<IssueMedia>()
        try {
            if (uris.isNotEmpty()) check(folder.mkdirs())
            var total = 0L
            for (uri in uris) {
                val mime = context.contentResolver.getType(uri)?.lowercase() ?: ""
                val extension = IssueAttachmentValidator.extension(mime)
                    ?: throw IllegalArgumentException("Choose JPG, PNG, WebP or MP4 files.")
                val mediaId = UUID.randomUUID().toString()
                val file = File(folder, "$mediaId.$extension")
                val stream = context.contentResolver.openInputStream(uri)
                    ?: throw IllegalArgumentException("Could not open an attachment.")
                var size = 0L
                stream.use { input ->
                    file.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            size += read
                            total += read
                            require(total <= IssueAttachmentValidator.MAX_TOTAL_BYTES) {
                                "Attachments must total 10 MB or less."
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                }
                require(size > 0) { "An attachment is empty." }
                media.add(IssueMedia(mediaId, "attachment-${media.size + 1}.$extension",
                    mime, size, file.absolutePath))
            }
            val db = writableDatabase
            db.beginTransaction()
            try {
                db.execSQL("""INSERT INTO issues
                    (id,category,details,created_at,class_name,school_name,teacher_name)
                    VALUES(?,?,?,?,?,?,?)""", arrayOf<Any>(id, category, details.trim(),
                    System.currentTimeMillis(), schoolClass.name, schoolClass.schoolName,
                    schoolClass.teacherName))
                for (item in media) db.execSQL("INSERT INTO issue_media VALUES(?,?,?,?,?,?)",
                    arrayOf<Any>(item.id, id, item.name, item.mime, item.size, item.path))
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        } catch (error: Exception) {
            folder.deleteRecursively()
            throw error
        }
        return id
    }

    fun pendingIssueCount(): Int = readableDatabase.rawQuery(
        "SELECT COUNT(*) FROM issues WHERE sent_at=0", null).use {
        it.moveToFirst()
        it.getInt(0)
    }

    fun pendingIssueError(): String = readableDatabase.rawQuery(
        "SELECT last_error FROM issues WHERE sent_at=0 AND last_error!='' ORDER BY created_at DESC LIMIT 1",
        null).use { if (it.moveToFirst()) it.getString(0) else "" }

    fun pendingIssues(): List<IssueReport> {
        val reports = mutableListOf<IssueReport>()
        readableDatabase.rawQuery("""SELECT id,category,details,created_at,class_name,
            school_name,teacher_name FROM issues WHERE sent_at=0 ORDER BY created_at""", null).use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getString(0)
                val media = mutableListOf<IssueMedia>()
                readableDatabase.rawQuery("""SELECT id,name,mime,size,path FROM issue_media
                    WHERE issue_id=? ORDER BY name""", arrayOf(id)).use { attachment ->
                    while (attachment.moveToNext()) media.add(IssueMedia(
                        attachment.getString(0), attachment.getString(1), attachment.getString(2),
                        attachment.getLong(3), attachment.getString(4)))
                }
                reports.add(IssueReport(id, cursor.getString(1), cursor.getString(2), cursor.getLong(3),
                    cursor.getString(4), cursor.getString(5), cursor.getString(6), media))
            }
        }
        return reports
    }

    fun markIssueSent(id: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("UPDATE issues SET sent_at=?,last_error='' WHERE id=?",
                arrayOf<Any>(System.currentTimeMillis(), id))
            db.execSQL("DELETE FROM issue_media WHERE issue_id=?", arrayOf(id))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        File(context.filesDir, "issue-media/$id").deleteRecursively()
    }

    fun markIssueError(id: String, reason: String) {
        writableDatabase.execSQL("UPDATE issues SET last_error=? WHERE id=?",
            arrayOf(reason.take(200), id))
    }

    fun issueCount(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM issues", null).use {
        it.moveToFirst()
        it.getInt(0)
    }

    fun issueText(): String = buildString {
        readableDatabase.rawQuery("SELECT category,details,created_at FROM issues ORDER BY created_at", null).use { cursor ->
            while (cursor.moveToNext()) {
                append("Hiraia Tala issue · ").append(cursor.getString(0))
                append(" · ").append(java.util.Date(cursor.getLong(2))).append('\n')
                append(cursor.getString(1)).append("\n\n")
            }
        }
    }

    companion object {
        fun learningEvent(name: String, occurredAt: Long, correct: Boolean, props: String): LearningEvent {
            val json = JSONObject(props)
            return LearningEvent(name, occurredAt, correct, json.optString("card_id").trim(),
                json.optString("question_id").trim())
        }

        private const val GUEST_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
        private val OPTION_KINDS = setOf("teacher", "school")
        private val ID = Regex("[A-Za-z0-9_-]{16,80}")
        val ISSUE_CATEGORIES = listOf("App problem", "Content concern", "Device problem", "Other")
        private val EVENTS = setOf(
            "first_open", "profile_updated", "session_started", "card_viewed", "quiz_shown",
            "quiz_answer_submitted", "quiz_graded", "download_started", "download_resumed",
            "download_failed", "download_cancelled", "download_installed", "asset_available",
            "model_load_started", "model_ready", "model_load_failed", "generation_started",
            "generation_completed", "generation_failed", "queue_dropped"
        )
    }
}
