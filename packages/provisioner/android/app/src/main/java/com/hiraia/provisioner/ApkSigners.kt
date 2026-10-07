package com.hiraia.provisioner

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The signing certificates an APK names, read straight from its APK Signature Block rather than
 * through PackageManager. On Android 13, PackageManager.getPackageArchiveInfo only collects
 * certificates when asked for GET_SIGNATURES (android13-release PackageManager.java; Android 14
 * changed that), and the JP1 returned no usable signing info for Hiraia's genuine APK, so the one
 * check that matters most does not depend on it alone.
 *
 * This reads what the APK claims; it verifies no signature. Android does that when it installs the
 * file and refuses one not really signed by the key its signature names. That only protects us if
 * this reads exactly the block Android verifies. So the block is found the way Android 13 finds it
 * (frameworks/base core/java/android/util/apk/ZipUtils.java and ApkSigningBlockUtils.java), and
 * anything Android would read differently is refused: an end record whose comment length does not
 * fit (a decoy in the comment), ZIP64, a central directory not followed by the end record, block
 * sizes that disagree, and a scheme present twice (Android reads the first). Where Android would find
 * no v2 or v3 block at all it may fall back to a v1 JAR signature, which this does not read; this then
 * finds no block either, and the caller refuses the file.
 *
 * Every scheme present (v3.1, v3, v2) must name the expected certificate: Android 13 takes the
 * signer from v3.1 when there is one meant for it, then v3, then v2, so when all agree it does not
 * matter which it picks. An APK with a rotated key (v3.1 naming a newer certificate) is refused;
 * Hiraia's key has never rotated, and rotating it means changing the expected certificate too.
 */
object ApkSigners {
    private const val V2 = 0x7109871A
    private val V3 = 0xF05368C0.toInt()
    private const val V31 = 0x1B93AD61
    private val SCHEMES = listOf(V31, V3, V2)
    private val MAGIC = "APK Sig Block 42".toByteArray(Charsets.US_ASCII)
    private const val END_RECORD = 0x06054B50
    private const val END_RECORD_SIZE = 22
    private const val ZIP64_LOCATOR = 0x07064B50
    private const val ZIP64_LOCATOR_SIZE = 20
    /** A real signature block is kilobytes; anything near this is not one. */
    private const val MAX_BLOCK = 16 * 1024 * 1024

    /** The DER certificate each signature scheme present names, v3.1 first. Empty when unsigned. */
    fun certificates(apk: File): List<ByteArray> = RandomAccessFile(apk, "r").use { file ->
        val length = file.length()
        val tailSize = minOf(length, (END_RECORD_SIZE + 0xFFFF).toLong()).toInt()
        val tail = read(file, length - tailSize, tailSize)
        // The end record nearest the end whose comment runs exactly to the end of the file.
        var eocd = -1
        for (at in tailSize - END_RECORD_SIZE downTo 0) {
            if (tail.getInt(at) == END_RECORD && (tail.getShort(at + 20).toInt() and 0xFFFF) == tailSize - END_RECORD_SIZE - at) {
                eocd = at
                break
            }
        }
        if (eocd < 0) throw IOException("not a zip file")
        val eocdOffset = length - tailSize + eocd
        if (eocdOffset >= ZIP64_LOCATOR_SIZE && read(file, eocdOffset - ZIP64_LOCATOR_SIZE, 4).getInt(0) == ZIP64_LOCATOR) {
            throw IOException("ZIP64 APKs are not supported")
        }
        val centralDirectorySize = tail.getInt(eocd + 12).toLong() and 0xFFFFFFFFL
        val centralDirectory = tail.getInt(eocd + 16).toLong() and 0xFFFFFFFFL
        if (centralDirectory > eocdOffset || centralDirectory + centralDirectorySize != eocdOffset) {
            throw IOException("the central directory is not where the end record says")
        }
        if (centralDirectory < 32) return@use emptyList()
        val footer = read(file, centralDirectory - 24, 24)
        val magic = ByteArray(16).also { footer.position(8); footer.get(it) }
        if (!magic.contentEquals(MAGIC)) return@use emptyList()
        val size = footer.getLong(0)
        if (size < 24 || size > MAX_BLOCK || size > centralDirectory - 8) throw IOException("bad signature block size")
        val block = read(file, centralDirectory - size - 8, (size + 8).toInt())
        if (block.getLong(0) != size) throw IOException("signature block sizes disagree")
        block.position(8)
        val pairs = slice(block, (size - 24).toInt())

        val blocks = HashMap<Int, ByteBuffer>()
        while (pairs.remaining() > 0) {
            if (pairs.remaining() < 12) throw IOException("truncated signature block")
            val pairLength = pairs.long
            if (pairLength < 4 || pairLength > pairs.remaining()) throw IOException("bad signature block entry")
            val id = pairs.int
            val value = slice(pairs, (pairLength - 4).toInt())
            if (id in SCHEMES && id in blocks) throw IOException("a signature scheme is present twice")
            blocks[id] = value
        }
        SCHEMES.mapNotNull { blocks[it] }.map(::certificate)
    }

    /** v2, v3 and v3.1 alike: signers -> one signer -> signed data -> (digests, certificates, ...). */
    private fun certificate(block: ByteBuffer): ByteArray {
        val signers = sequence(field(block))
        if (signers.size != 1) throw IOException("expected one signer, found ${signers.size}")
        val signedData = field(signers[0])
        field(signedData) // the digests
        val certificates = sequence(field(signedData))
        if (certificates.isEmpty()) throw IOException("a signer with no certificate")
        return ByteArray(certificates[0].remaining()).also { certificates[0].get(it) }
    }

    /** One u32-length-prefixed field from the buffer's position; the position moves past it. */
    private fun field(buffer: ByteBuffer): ByteBuffer {
        if (buffer.remaining() < 4) throw IOException("truncated signature block")
        val size = buffer.int
        if (size < 0 || size > buffer.remaining()) throw IOException("truncated signature block")
        return slice(buffer, size)
    }

    private fun sequence(buffer: ByteBuffer): List<ByteBuffer> {
        val items = mutableListOf<ByteBuffer>()
        while (buffer.remaining() > 0) items += field(buffer)
        return items
    }

    private fun slice(buffer: ByteBuffer, size: Int): ByteBuffer {
        val part = buffer.slice().order(ByteOrder.LITTLE_ENDIAN)
        part.limit(size)
        buffer.position(buffer.position() + size)
        return part
    }

    private fun read(file: RandomAccessFile, at: Long, size: Int): ByteBuffer {
        if (at < 0 || size < 0) throw IOException("bad offset")
        val bytes = ByteArray(size)
        file.seek(at)
        file.readFully(bytes)
        return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    }
}
