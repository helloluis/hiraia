package com.hiraia.provisioner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

class ApkSignersTest {
    private val hiraia = "40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35"
    private val v2 = 0x7109871A
    private val v31 = 0x1B93AD61

    @get:Rule val temporary = TemporaryFolder()

    private fun fixture(name: String) = File(javaClass.classLoader!!.getResource("apk-signers/$name")!!.toURI())

    private fun signers(file: File) = ApkSigners.certificates(file).map { cert ->
        MessageDigest.getInstance("SHA-256").digest(cert).joinToString("") { "%02x".format(it) }
    }

    private fun home(path: String) = File(System.getProperty("user.home"), path)

    @Test
    fun readsHiraiasKeyFromTheRealSignedApk() {
        // The exact APK the JP1's Android 13 refused: every scheme it carries must name Hiraia's key.
        val apk = home(".hiraia/builds/hiraia-v0p4p25.apk")
        assumeTrue("needs the signed Hiraia 0.4.25 APK", apk.exists())
        val found = signers(apk)
        assertTrue(found.isNotEmpty())
        assertTrue(found.all { it == hiraia })
    }

    @Test
    fun readsAnotherKeyFromAReSignedFake() {
        val apk = File("/tmp/fake-test/fake-hiraia.apk")
        assumeTrue("needs the re-signed fake from the rehearsal", apk.exists())
        val found = signers(apk)
        assertTrue(found.isNotEmpty())
        assertTrue(found.none { it == hiraia })
    }

    @Test
    fun readsTheProvisionerKeyFromThisDpcsOwnRelease() {
        val apk = File("build/outputs/apk/release/app-release.apk")
        assumeTrue("needs a release build of this DPC", apk.exists())
        assertEquals(listOf("321aad0ae3ee615ba30aa7ba514be6f1f7bcdb2c4aaec1dc9aa8d02dba304fed"), signers(apk).distinct())
    }

    @Test
    fun readsAV2OnlySignature() {
        assertEquals(listOf(hiraia), signers(fixture("v2-hiraia.apk")))
    }

    @Test
    fun reportsEverySchemeSoADisagreeingV31IsCaught() {
        // v3 names Hiraia, v3.1 another key: Android 13 would take the v3.1 signer.
        val found = signers(fixture("v3-hiraia-v31-other.apk"))
        assertEquals(2, found.size)
        assertEquals(hiraia, found[1])
        assertTrue(found[0] != hiraia)
    }

    @Test
    fun anUnsignedZipNamesNoSigner() {
        assertEquals(emptyList<String>(), signers(fixture("unsigned.apk")))
    }

    @Test(expected = IOException::class)
    fun somethingThatIsNotAZipIsRefused() {
        ApkSigners.certificates(fixture("not-a-zip.apk"))
    }

    // Rebuilt APKs: the unsigned fixture's one entry and central directory, with signing blocks made
    // from the fixtures' own scheme blocks. Each attack below reads Hiraia's key from a block Android
    // never looks at, so Android would verify some other signature (or fall back to v1) and install it.

    private val hiraiaV2 by lazy { schemeBlocks(fixture("v2-hiraia.apk").readBytes()).single { it.first == v2 }.second }
    private val otherKey by lazy { schemeBlocks(fixture("v3-hiraia-v31-other.apk").readBytes()).single { it.first == v31 }.second }

    @Test
    fun aRebuiltApkReadsLikeTheOriginal() {
        // The check on the helpers: without it the refusals below could be the helpers' fault.
        assertEquals(listOf(hiraia), signers(apk(signingBlock(v2 to hiraiaV2))))
        assertEquals(listOf(hiraia), signers(apk(signingBlock(v2 to hiraiaV2), comment = "a real comment".toByteArray())))
    }

    @Test
    fun aDecoyEndRecordInTheCommentIsNotRead() {
        // Android takes the end record whose comment length fits, which points at a central directory
        // with no signing block before it. The decoy after Hiraia's copied block must not be read.
        val decoyBlock = signingBlock(v2 to hiraiaV2)
        val commentStart = unsigned.size.toLong()
        val decoyEnd = endRecord(centralDirectorySize = 0, centralDirectory = commentStart + decoyBlock.size, commentLength = 0)
        val comment = decoyBlock + decoyEnd + byteArrayOf(1, 2, 3)
        assertEquals(emptyList<String>(), signers(apk(block = null, comment = comment)))
    }

    @Test(expected = IOException::class)
    fun aSchemePresentTwiceIsRefused() {
        // Android reads the first v2 block (another key); Hiraia's copy after it must not pass.
        ApkSigners.certificates(apk(signingBlock(v2 to otherKey, v2 to hiraiaV2)))
    }

    @Test(expected = IOException::class)
    fun zip64IsRefused() {
        // Android ignores the signing block of an APK with a ZIP64 locator, and may fall back to v1.
        val locator = ByteArray(20).also { le(it).putInt(0, 0x07064B50) }
        ApkSigners.certificates(apk(signingBlock(v2 to hiraiaV2), beforeEnd = locator, beforeEndInDirectory = true))
    }

    @Test(expected = IOException::class)
    fun signingBlockSizesThatDisagreeAreRefused() {
        val block = signingBlock(v2 to hiraiaV2)
        le(block).putLong(0, le(block).getLong(0) - 8)
        ApkSigners.certificates(apk(block))
    }

    @Test(expected = IOException::class)
    fun aCentralDirectoryNotFollowedByTheEndRecordIsRefused() {
        ApkSigners.certificates(apk(signingBlock(v2 to hiraiaV2), beforeEnd = ByteArray(5)))
    }

    private val unsigned by lazy { fixture("unsigned.apk").readBytes() }

    private fun le(bytes: ByteArray): ByteBuffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

    /** The (id, value) pairs of a fixture's APK Signing Block. The fixtures carry no zip comment. */
    private fun schemeBlocks(apk: ByteArray): List<Pair<Int, ByteArray>> {
        val buffer = le(apk)
        val centralDirectory = buffer.getInt(apk.size - 22 + 16)
        val size = buffer.getLong(centralDirectory - 24).toInt()
        var at = centralDirectory - size
        val found = mutableListOf<Pair<Int, ByteArray>>()
        while (at < centralDirectory - 24) {
            val length = buffer.getLong(at).toInt()
            found += buffer.getInt(at + 8) to apk.copyOfRange(at + 12, at + 8 + length)
            at += 8 + length
        }
        return found
    }

    private fun signingBlock(vararg pairs: Pair<Int, ByteArray>): ByteArray {
        val size = pairs.sumOf { 12L + it.second.size } + 24
        val out = le(ByteArray((size + 8).toInt()))
        out.putLong(size)
        for ((id, value) in pairs) out.putLong(4L + value.size).putInt(id).put(value)
        out.putLong(size).put("APK Sig Block 42".toByteArray(Charsets.US_ASCII))
        return out.array()
    }

    private fun endRecord(centralDirectorySize: Long, centralDirectory: Long, commentLength: Int): ByteArray {
        val record = unsigned.copyOfRange(unsigned.size - 22, unsigned.size)
        le(record).putInt(12, centralDirectorySize.toInt()).putInt(16, centralDirectory.toInt())
            .putShort(20, commentLength.toShort())
        return record
    }

    /**
     * The unsigned fixture's entry, then [block], its central directory, [beforeEnd] (counted as part
     * of the central directory when [beforeEndInDirectory]), the end record and [comment].
     */
    private fun apk(block: ByteArray?, comment: ByteArray = ByteArray(0), beforeEnd: ByteArray = ByteArray(0),
                    beforeEndInDirectory: Boolean = false): File {
        val centralDirectory = le(unsigned).getInt(unsigned.size - 22 + 16)
        val entry = unsigned.copyOfRange(0, centralDirectory)
        val directory = unsigned.copyOfRange(centralDirectory, unsigned.size - 22)
        val signed = entry + (block ?: ByteArray(0))
        val directorySize = directory.size + if (beforeEndInDirectory) beforeEnd.size else 0
        val end = endRecord(directorySize.toLong(), signed.size.toLong(), comment.size)
        return temporary.newFile().apply { writeBytes(signed + directory + beforeEnd + end + comment) }
    }
}
