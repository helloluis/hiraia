package com.hiraia.tala

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/** A half-open [start, end) span of the teacher's calendar, in epoch milliseconds. */
data class SchoolPeriod(val label: String, val dates: String, val start: Long, val end: Long)

/**
 * The windows a teacher reads a student's activity in: today, the last school day, and the
 * last school week. School days are Monday to Friday. There is no holiday calendar, so a
 * holiday or a term break still counts as a school day; the dates are shown with every
 * window so a teacher can tell when that is what they are looking at.
 */
object SchoolPeriods {
    fun around(today: LocalDate, zone: ZoneId, locale: Locale = Locale.getDefault()): List<SchoolPeriod> {
        val day = DateTimeFormatter.ofPattern("EEE d", locale)
        var lastDay = today.minusDays(1)
        while (weekend(lastDay)) lastDay = lastDay.minusDays(1)
        // The Monday-to-Friday week that most recently FINISHED: on a weekend that is the week
        // just gone; on a school day it is the one before, since this week is still under way.
        var monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        if (!weekend(today)) monday = monday.minusWeeks(1)
        val friday = monday.plusDays(4)
        return listOf(
            SchoolPeriod("Today", today.format(day), millis(today, zone), millis(today.plusDays(1), zone)),
            SchoolPeriod("Last school day", lastDay.format(day), millis(lastDay, zone),
                millis(lastDay.plusDays(1), zone)),
            SchoolPeriod("Last school week", span(monday, friday, locale), millis(monday, zone),
                millis(friday.plusDays(1), zone))
        )
    }

    private fun weekend(date: LocalDate): Boolean =
        date.dayOfWeek == DayOfWeek.SATURDAY || date.dayOfWeek == DayOfWeek.SUNDAY

    private fun millis(date: LocalDate, zone: ZoneId): Long = date.atStartOfDay(zone).toInstant().toEpochMilli()

    private fun span(first: LocalDate, last: LocalDate, locale: Locale): String {
        val full = DateTimeFormatter.ofPattern("d MMM", locale)
        return if (first.month == last.month) "${first.dayOfMonth}–${last.format(full)}"
        else "${first.format(full)}–${last.format(full)}"
    }
}
