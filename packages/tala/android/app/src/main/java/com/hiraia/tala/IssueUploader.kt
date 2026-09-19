package com.hiraia.tala

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

object IssueUploader {
    private const val ENDPOINT = "https://hiraia.org/admin/api/tala/reports"
    private const val JOB_ID = 260918
    private const val PREFS = "tala-report-upload"

    fun schedule(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (scheduler.getPendingJob(JOB_ID) != null) return
        val info = JobInfo.Builder(JOB_ID, ComponentName(context, IssueUploadJob::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setBackoffCriteria(30L * 60 * 1000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .build()
        scheduler.schedule(info)
    }

    @Synchronized
    fun uploadPending(context: Context): Boolean {
        TalaDatabase(context).use { database ->
            for (report in database.pendingIssues()) {
                try {
                    upload(context, report)
                    database.markIssueSent(report.id)
                } catch (error: Exception) {
                    database.markIssueError(report.id, error.message ?: "Could not send")
                    return false
                }
            }
            return true
        }
    }

    private fun upload(context: Context, report: IssueReport) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val deviceId = preferences.getString("device_id", null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString("device_id", it).commit()
        }
        val media = JSONArray()
        for (item in report.media) {
            val file = File(item.path)
            require(file.isFile && file.length() == item.size &&
                item.size <= IssueAttachmentValidator.MAX_TOTAL_BYTES)
            media.put(JSONObject().put("id", item.id).put("name", item.name)
                .put("mime", item.mime)
                .put("data", Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)))
        }
        val body = JSONObject().put("id", report.id).put("device_id", deviceId)
            .put("category", report.category).put("details", report.details)
            .put("created_at", report.createdAt).put("class_name", report.className)
            .put("school_name", report.schoolName).put("teacher_name", report.teacherName)
            .put("attachments", media).toString().toByteArray(Charsets.UTF_8)
        repeat(3) { attempt ->
            val connection = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15_000
                readTimeout = 90_000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("User-Agent", "HiraiaTala/0.7.4 (Android)")
                setFixedLengthStreamingMode(body.size)
            }
            try {
                connection.outputStream.use { it.write(body) }
                val code = connection.responseCode
                if (code == 429 && attempt < 2) {
                    val seconds = connection.getHeaderField("Retry-After")?.toLongOrNull()
                        ?.coerceIn(1, 60) ?: 30L
                    connection.disconnect()
                    Thread.sleep(seconds * 1000)
                    return@repeat
                }
                if (code !in 200..299) throw IllegalStateException("Server returned $code")
                val response = connection.inputStream.bufferedReader().use { it.readText() }
                val result = JSONObject(response)
                require(result.optBoolean("ok") && result.optString("id") == report.id)
                return
            } finally {
                connection.disconnect()
            }
        }
    }
}

class IssueUploadJob : JobService() {
    @Volatile private var stopped = false

    override fun onStartJob(params: JobParameters): Boolean {
        stopped = false
        Thread {
            val complete = runCatching { IssueUploader.uploadPending(this) }.getOrDefault(false)
            if (!stopped) jobFinished(params, !complete)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        stopped = true
        return true
    }
}
