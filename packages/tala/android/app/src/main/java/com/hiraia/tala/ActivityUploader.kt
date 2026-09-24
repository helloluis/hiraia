package com.hiraia.tala

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

data class RelayBatch(val classId: String, val installationId: String,
    val events: JSONArray, val reconstructed: JSONArray)

/** No roster, names, class titles or issue-report text leave the classroom here. */
object ActivityRelay {
    private val id = Regex("[A-Za-z0-9_-]{16,80}")
    private val label = Regex("[A-Za-z0-9_.:-]{1,100}")
    private val labels = setOf("app_version", "build", "android", "abi", "model", "asset",
        "attempt_id", "view_id", "question_id", "card_id", "hiraiapedia_version", "cards_db_version",
        "ota_update_id")
    private val numbers = setOf("duration_ms", "bytes", "expected_bytes", "offset", "attempt", "ram_gb", "count")
    private val enums = mapOf("profile_kind" to setOf("guest", "student"),
        "language" to setOf("english", "tagalog", "cebuano"), "source" to setOf("curated", "generated"),
        "asset_kind" to setOf("model", "images", "vectors", "adapter"),
        "backend" to setOf("cpu", "gpu", "unknown"),
        "error" to setOf("network", "http", "integrity", "storage", "cancelled", "runtime", "unknown"))

    fun event(input: JSONObject, installation: String): JSONObject {
        val props = JSONObject()
        val source = input.getJSONObject("props")
        for (key in source.keys()) {
            val value = source.get(key)
            val allowed = when {
                key == "profile_id" -> value is String && id.matches(value) && source.optString("profile_kind") == "student"
                key in labels -> value is String && label.matches(value)
                key in enums -> value is String && value in enums.getValue(key)
                key == "grade" -> value is Number && value.toDouble() in 3.0..10.0 && value.toDouble() == value.toInt().toDouble()
                key in numbers -> value is Number && value.toDouble().isFinite() && value.toDouble() in 0.0..1e12
                else -> key == "correct" && value is Boolean
            }
            if (allowed) props.put(key, value)
        }
        if (props.optString("profile_kind") == "student" && !props.has("profile_id")) props.remove("profile_kind")
        return JSONObject().put("id", input.getString("id")).put("name", input.getString("name"))
            .put("occurred_at", input.getLong("occurred_at"))
            .put("session_id", input.optString("session_id").takeIf { id.matches(it) } ?: installation)
            .put("props", props)
    }

    fun body(batch: RelayBatch, reporterId: String, version: String): JSONObject = JSONObject()
        .put("schema", 1).put("installation_id", batch.installationId).put("events", batch.events)
        .put("reporter", JSONObject().put("app", "tala").put("installation_id", reporterId).put("version", version))
        .put("reconstructed_ids", batch.reconstructed)

    fun acknowledgments(batch: RelayBatch, response: JSONObject): Map<String, String> {
        // An older server can accept events but silently discard the new provenance.
        // Keep them pending until a server explicitly confirms it stored the label.
        require(response.optBoolean("reporter_recorded"))
        val sent = (0 until batch.events.length()).map { batch.events.getJSONObject(it).getString("id") }.toSet()
        val states = linkedMapOf<String, String>()
        for ((key, state) in listOf("acknowledged" to "accepted", "rejected" to "rejected")) {
            val ids = response.getJSONArray(key)
            for (i in 0 until ids.length()) {
                val eventId = ids.getString(i)
                require(eventId in sent && eventId !in states)
                states[eventId] = state
            }
        }
        require(states.isNotEmpty())
        return states
    }
}

object ActivityUploader {
    private const val JOB_ID = 260920
    private const val RECOVERY_JOB_ID = 260921
    private const val ENDPOINT = "https://hiraia.org/api/telemetry/batch"
    private val active = AtomicBoolean(false)

    fun schedule(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        // Periodic wake closes the small commit/schedule and job-finish/new-event races.
        if (scheduler.getPendingJob(RECOVERY_JOB_ID) == null) scheduler.schedule(
            JobInfo.Builder(RECOVERY_JOB_ID, ComponentName(context, ActivityUploadJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
                .setPeriodic(15 * 60 * 1000L).build())
        if (scheduler.getPendingJob(JOB_ID) == null) scheduler.schedule(
            JobInfo.Builder(JOB_ID, ComponentName(context, ActivityUploadJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
                .setMinimumLatency(5_000).setBackoffCriteria(60_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build())
    }

    fun uploadPending(context: Context, cancelled: () -> Boolean = { false },
        send: (JSONObject) -> JSONObject = { post(context, it) }): Boolean {
        if (!active.compareAndSet(false, true)) return false
        try {
            val prefs = context.getSharedPreferences("activity-upload", Context.MODE_PRIVATE)
            if (prefs.getLong("retry_at", 0) > System.currentTimeMillis()) return false
            TalaDatabase(context).use { database ->
                val version = AppVersion.installed(context).version
                repeat(20) {
                    if (cancelled()) return false
                    val batch = database.pendingActivity() ?: return true
                    database.acknowledgeActivity(batch, send(ActivityRelay.body(batch, database.reporterId(), version)))
                }
                return database.pendingActivity() == null
            }
        } finally { active.set(false) }
    }

    private fun post(context: Context, body: JSONObject): JSONObject {
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        require(bytes.size <= 100_000)
        val connection = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            instanceFollowRedirects = false
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("User-Agent", "HiraiaTala/ActivityRelay")
            setFixedLengthStreamingMode(bytes.size)
        }
        try {
            connection.outputStream.use { it.write(bytes) }
            val code = connection.responseCode
            if (code !in 200..299) {
                val delay = connection.getHeaderField("Retry-After")?.toLongOrNull()?.coerceIn(60, 86400) ?: 300L
                context.getSharedPreferences("activity-upload", Context.MODE_PRIVATE).edit()
                    .putLong("retry_at", System.currentTimeMillis() + delay * 1000).commit()
                error("Activity upload HTTP $code")
            }
            val text = connection.inputStream.bufferedReader().use { reader ->
                val buffer = CharArray(16_001)
                var length = 0
                while (length < buffer.size) {
                    val read = reader.read(buffer, length, buffer.size - length)
                    if (read < 0) break
                    length += read
                }
                require(length <= 16_000)
                String(buffer, 0, length)
            }
            return JSONObject(text)
        } finally { connection.disconnect() }
    }
}

class ActivityUploadJob : JobService() {
    private val cancellations = java.util.concurrent.ConcurrentHashMap<Int, AtomicBoolean>()
    override fun onStartJob(params: JobParameters): Boolean {
        val cancelled = AtomicBoolean(false)
        cancellations[params.jobId] = cancelled
        Thread {
            val complete = runCatching { ActivityUploader.uploadPending(this, { cancelled.get() }) }.getOrDefault(false)
            if (!cancelled.get()) jobFinished(params, !complete)
            cancellations.remove(params.jobId, cancelled)
        }.start()
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        cancellations.remove(params.jobId)?.set(true)
        return true
    }
}
