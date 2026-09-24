package com.hiraia.tala

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

class SchoolPeriodsTest {
    private val manila = ZoneId.of("Asia/Manila")

    private fun around(date: String) = SchoolPeriods.around(LocalDate.parse(date), manila, Locale.ENGLISH)

    private fun day(date: String) = LocalDate.parse(date).atStartOfDay(manila).toInstant().toEpochMilli()

    @Test
    fun midweekLooksBackOneDayAndAtTheWeekBefore() {
        val (today, lastDay, lastWeek) = around("2026-09-24") // Thursday
        assertEquals(SchoolPeriod("Today", "Thu 24", day("2026-09-24"), day("2026-09-25")), today)
        assertEquals(SchoolPeriod("Last school day", "Wed 23", day("2026-09-23"), day("2026-09-24")), lastDay)
        assertEquals(SchoolPeriod("Last school week", "14–18 Sep", day("2026-09-14"), day("2026-09-19")), lastWeek)
    }

    @Test
    fun mondaySkipsTheWeekendBackToFriday() {
        val (_, lastDay, lastWeek) = around("2026-09-21")
        assertEquals("Fri 18", lastDay.dates)
        assertEquals(day("2026-09-18"), lastDay.start)
        assertEquals("14–18 Sep", lastWeek.dates)
    }

    @Test
    fun onAWeekendTheWeekJustFinishedIsTheLastSchoolWeek() {
        for (weekend in listOf("2026-09-26", "2026-09-27")) {
            val (_, lastDay, lastWeek) = around(weekend)
            assertEquals("Fri 25", lastDay.dates)
            assertEquals("21–25 Sep", lastWeek.dates)
            assertEquals(day("2026-09-21"), lastWeek.start)
            assertEquals(day("2026-09-26"), lastWeek.end)
        }
    }

    @Test
    fun aWeekAcrossTwoMonthsNamesBoth() {
        assertEquals("28 Sep–2 Oct", around("2026-10-06")[2].dates)
    }
}
