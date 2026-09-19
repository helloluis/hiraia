package com.hiraia.tala

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns

object IssueAttachmentValidator {
    const val MAX_TOTAL_BYTES = 10_000_000L

    private val extensions = mapOf(
        "image/jpeg" to "jpg", "image/png" to "png",
        "image/webp" to "webp", "video/mp4" to "mp4"
    )

    fun extension(mime: String): String? = extensions[mime]

    fun measure(context: Context, uri: Uri, remainingBytes: Long): Long {
        val mime = context.contentResolver.getType(uri)?.lowercase() ?: ""
        require(extension(mime) != null) { "Choose JPG, PNG, WebP or MP4 files." }
        val tooLarge = if (mime == "video/mp4")
            "This video is too large. Choose a shorter clip under the 10 MB total limit."
        else "Attachments must total 10 MB or less."
        require(remainingBytes > 0) { tooLarge }
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) {
                require(cursor.getLong(0) <= remainingBytes) { tooLarge }
            }
        }
        val input = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("Could not open an attachment.")
        var size = 0L
        input.use { stream ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                size += read
                require(size <= remainingBytes) { tooLarge }
            }
        }
        require(size > 0) { "An attachment is empty." }
        if (mime == "video/mp4") {
            val retriever = MediaMetadataRetriever()
            val duration = try {
                retriever.setDataSource(context, uri)
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            } catch (error: RuntimeException) {
                throw IllegalArgumentException("Could not read this video. Choose a different MP4 file.", error)
            } finally {
                retriever.release()
            }
            require(duration != null && duration in 1..60_000L) {
                "Choose a video no longer than 1 minute."
            }
        }
        return size
    }
}
