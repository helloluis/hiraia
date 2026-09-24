package com.hiraia.tala

import android.content.Context
import java.io.File
import java.io.OutputStreamWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

object ClassWorkbook {
    const val MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    private const val MAX_DATA_ROWS = 1_048_575

    fun export(context: Context, database: TalaDatabase, schoolClass: SchoolClass): File {
        val directory = File(context.cacheDir, "exports")
        check(directory.isDirectory || directory.mkdirs())
        directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000 }
            ?.forEach { it.delete() }
        val file = File.createTempFile("hiraia-tala-class-", ".xlsx", directory)
        try {
            write(file, database, schoolClass, CardCatalog.get(context))
        } catch (error: Exception) {
            file.delete()
            throw error
        }
        return file
    }

    private fun write(file: File, database: TalaDatabase, schoolClass: SchoolClass, catalog: CardCatalog) {
        // Students who left stay in the export, marked as such; removed ones are gone for good.
        val roster = database.classRoster(schoolClass, includeLeft = true)
        val leftCount = roster.count { it.student.leftAt > 0 }
        val names = roster.associate { (it.student.installationId to it.student.profileId) to it.displayName }
        val snapshot = database.eventSnapshot(schoolClass.id)
        val eventCount = database.eventCount(schoolClass.id, snapshot)
        val eventSheets = maxOf(1, (eventCount.toLong() + MAX_DATA_ROWS - 1)
            .div(MAX_DATA_ROWS).toInt())
        ZipOutputStream(file.outputStream().buffered()).use { zip ->
            val writer = OutputStreamWriter(zip, Charsets.UTF_8)
            entry(zip, writer, "[Content_Types].xml") {
                writer.write("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                    <Default Extension="xml" ContentType="application/xml"/>
                    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>""".trimIndent())
                for (sheet in 1..eventSheets + 2) writer.write(
                    "<Override PartName=\"/xl/worksheets/sheet$sheet.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>")
                writer.write("</Types>")
            }
            entry(zip, writer, "_rels/.rels") {
                writer.write("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                    </Relationships>""".trimIndent())
            }
            entry(zip, writer, "xl/workbook.xml") {
                writer.write("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>""".trimIndent())
                listOf("Class", "Students").forEachIndexed { index, name ->
                    writer.write("<sheet name=\"$name\" sheetId=\"${index + 1}\" r:id=\"rId${index + 1}\"/>")
                }
                for (number in 1..eventSheets) {
                    val sheet = number + 2
                    val name = if (number == 1) "Events" else "Events $number"
                    writer.write("<sheet name=\"$name\" sheetId=\"$sheet\" r:id=\"rId$sheet\"/>")
                }
                writer.write("</sheets></workbook>")
            }
            entry(zip, writer, "xl/_rels/workbook.xml.rels") {
                writer.write("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">""".trimIndent())
                for (sheet in 1..eventSheets + 2) writer.write(
                    "<Relationship Id=\"rId$sheet\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet$sheet.xml\"/>")
                writer.write("<Relationship Id=\"rId${eventSheets + 3}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>")
                writer.write("</Relationships>")
            }
            entry(zip, writer, "xl/styles.xml") {
                writer.write("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                    <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>
                    <font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
                    <fills count="2"><fill><patternFill patternType="none"/></fill>
                    <fill><patternFill patternType="gray125"/></fill></fills>
                    <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
                    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
                    <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
                    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs>
                    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
                    </styleSheet>""".trimIndent())
            }
            entry(zip, writer, "xl/worksheets/sheet1.xml") {
                startSheet(writer, listOf(25, 45), 10)
                row(writer, 1, listOf("Field", "Value"), true)
                listOf(
                    "Class" to schoolClass.name,
                    "Teacher" to schoolClass.teacherName,
                    "School" to schoolClass.schoolName,
                    "Grade" to schoolClass.gradeLevel,
                    "School year" to schoolClass.schoolYear,
                    "Exported" to timestamp(System.currentTimeMillis()),
                    "Students" to (roster.size - leftCount).toString(),
                    "Students who left" to leftCount.toString(),
                    "Stored events" to eventCount.toString()
                ).forEachIndexed { index, (key, value) -> row(writer, index + 2, listOf(key, value)) }
                endSheet(writer)
            }
            entry(zip, writer, "xl/worksheets/sheet2.xml") {
                startSheet(writer, listOf(25, 25, 18, 16, 16, 16, 16, 18, 16, 26, 26, 22, 22), roster.size + 1)
                row(writer, 1, listOf("Student", "Profile name", "Status", "Cards viewed", "Unique cards",
                    "Quiz answers", "Correct answers", "Device failures", "Stored events",
                    "Last connection", "Last transfer", "Last batch accepted", "Last batch rejected"), true)
                roster.forEachIndexed { index, card ->
                    val student = card.student
                    val status = if (student.leftAt > 0) "Left ${day(student.leftAt)}" else "In class"
                    row(writer, index + 2, listOf(card.displayName, student.name, status, student.cards,
                        database.uniqueCards(student), student.quizzes, student.correct,
                        student.failures, student.events, timestamp(student.lastSeen),
                        timestamp(student.lastSync), student.lastAccepted, student.lastRejected))
                }
                endSheet(writer)
            }
            var sheetNumber = 3
            var dataRows = 0
            fun startEvents() {
                zip.putNextEntry(ZipEntry("xl/worksheets/sheet$sheetNumber.xml"))
                val rows = minOf(MAX_DATA_ROWS, eventCount - (sheetNumber - 3) * MAX_DATA_ROWS)
                startSheet(writer, listOf(25, 24, 27, 27, 16, 40, 65, 42, 42, 42), rows + 1)
                row(writer, 1, listOf("Student", "Activity", "Occurred", "Received by Tala",
                    "Quiz result", "Subcategories", "Properties JSON", "Event ID", "Installation ID",
                    "Profile ID"), true)
            }
            startEvents()
            database.forEachEvent(schoolClass.id, snapshot) { event ->
                if (dataRows == MAX_DATA_ROWS) {
                    endSheet(writer)
                    writer.flush()
                    zip.closeEntry()
                    sheetNumber++
                    dataRows = 0
                    startEvents()
                }
                dataRows++
                row(writer, dataRows + 1, listOf(
                    names[event.installationId to event.profileId] ?: "Unassigned",
                    event.name, timestamp(event.occurredAt), timestamp(event.receivedAt),
                    if (event.name == "quiz_graded") if (event.correct) "Correct" else "Incorrect" else "",
                    if (event.name != "card_viewed" && event.name != "quiz_graded") ""
                    else catalog.subcategories(TalaDatabase.learningEvent(event.name, event.occurredAt,
                        event.correct, event.props)).joinToString("; ") { catalog.label(it) },
                    event.props, event.eventId, event.installationId, event.profileId
                ))
            }
            endSheet(writer)
            writer.flush()
            zip.closeEntry()
        }
    }

    private fun entry(zip: ZipOutputStream, writer: OutputStreamWriter, name: String, body: () -> Unit) {
        zip.putNextEntry(ZipEntry(name))
        body()
        writer.flush()
        zip.closeEntry()
    }

    private fun startSheet(writer: OutputStreamWriter, widths: List<Int>, rows: Int) {
        writer.write("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">""".trimIndent())
        writer.write("<dimension ref=\"A1:${column(widths.lastIndex)}$rows\"/>")
        writer.write("""<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
            <sheetFormatPr defaultRowHeight="15"/><cols>""".trimIndent())
        widths.forEachIndexed { index, width ->
            writer.write("<col min=\"${index + 1}\" max=\"${index + 1}\" width=\"$width\" customWidth=\"1\"/>")
        }
        writer.write("</cols><sheetData>")
    }

    private fun endSheet(writer: OutputStreamWriter) {
        writer.write("</sheetData></worksheet>")
    }

    private fun row(writer: OutputStreamWriter, number: Int, values: List<Any?>, header: Boolean = false) {
        writer.write("<row r=\"$number\">")
        values.forEachIndexed { index, value ->
            val column = column(index)
            val cell = "$column$number"
            val style = if (header) " s=\"1\"" else ""
            if (value is Number) writer.write("<c r=\"$cell\"$style><v>$value</v></c>")
            else writer.write("<c r=\"$cell\"$style t=\"inlineStr\"><is><t xml:space=\"preserve\">${xml(value?.toString() ?: "")}</t></is></c>")
        }
        writer.write("</row>")
    }

    private fun column(index: Int): String {
        var remaining = index + 1
        val result = StringBuilder()
        while (remaining > 0) {
            remaining--
            result.insert(0, ('A'.code + remaining % 26).toChar())
            remaining /= 26
        }
        return result.toString()
    }

    private fun xml(value: String): String = buildString {
        var index = 0
        while (index < value.length) {
            val point = Character.codePointAt(value, index)
            when {
                point == '&'.code -> append("&amp;")
                point == '<'.code -> append("&lt;")
                point == '>'.code -> append("&gt;")
                point == '"'.code -> append("&quot;")
                point == '\''.code -> append("&apos;")
                point == 9 || point == 10 || point == 13 ||
                    point in 32..0xD7FF || point in 0xE000..0xFFFD ||
                    point in 0x10000..0x10FFFF -> appendCodePoint(point)
            }
            index += Character.charCount(point)
        }
    }

    private fun timestamp(value: Long): String = if (value > 0) SimpleDateFormat(
        "yyyy-MM-dd HH:mm:ss Z", Locale.ROOT).format(Date(value)) else "Never"

    private fun day(value: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date(value))
}
