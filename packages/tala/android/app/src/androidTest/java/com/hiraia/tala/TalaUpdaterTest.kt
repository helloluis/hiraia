package com.hiraia.tala

import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class TalaUpdaterTest {
    private fun release() = JSONObject().put("versionCode", 16).put("versionName", "0.7.6")
        .put("url", "https://assets.hiraia.org/models/tala-v0p7p6.apk")
        .put("bytes", 123456).put("sha256", "a".repeat(64))

    @Test fun invalidReleaseMetadataCannotBecomeAnInstallOffer() {
        assertEquals(16L, TalaUpdater.parse(release()).version)
        for ((field, value) in listOf(
            "url" to "http://assets.hiraia.org/models/tala.apk",
            "url" to "https://another.example/tala.apk",
            "url" to "https://assets.hiraia.org/models/../tala.apk",
            "sha256" to "missing-digest", "bytes" to 0, "bytes" to 200000001,
            "bytes" to 123.5, "versionCode" to -1, "versionCode" to 16.5,
            "versionCode" to "16"
        )) {
            assertTrue("Must reject $field=$value", runCatching { TalaUpdater.parse(release().put(field, value)) }.isFailure)
        }
    }

    @Test fun installerCanReadOnlyTheSharedUpdateCache() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = File(context.cacheDir, "updates").apply { mkdirs() }
        val apk = File(directory, "updater-test.apk")
        val privateFile = File(context.filesDir, "updater-private-test.txt")
        try {
            apk.writeText("fixture")
            privateFile.writeText("private")
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
            assertEquals("content", uri.scheme)
            assertEquals("fixture", context.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() })
            assertTrue(runCatching { FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", privateFile) }.isFailure)
        } finally { apk.delete(); privateFile.delete() }
    }
}
