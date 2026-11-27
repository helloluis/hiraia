/**
 * Saturday and Sunday classes on This Week (Luis, 27 Nov 2026): which dates the week header names, which sessions
 * fall outside the school week (their topic is Tala's suggestion), and where the make-up date starts. Pure: dates
 * are ISO strings in the school's calendar and all arithmetic is data/ids' UTC-noon helpers, so the device's time
 * zone never shifts a weekday. Weeks run Monday to Sunday, as everywhere else in the app.
 */
import { addDays, weekdayOf } from '../../data/ids';

/** The school week when a school year does not say otherwise (`SchoolYear.teachingWeekdays`). */
const SCHOOL_WEEK: readonly number[] = [1, 2, 3, 4, 5];
const schoolWeek = (weekdays?: readonly number[] | null) =>
  weekdays?.length ? weekdays : SCHOOL_WEEK;

/** The days the teacher's active classes meet (their timetable slots), Monday to Sunday. */
export function scheduleWeekdays(ws: {
  classes: ReadonlyArray<{ id: string }>;
  assignments: ReadonlyArray<{ classId: string; slots: ReadonlyArray<{ weekday: number }> }>;
}): number[] {
  const days = new Set<number>();
  for (const a of ws.assignments)
    if (ws.classes.some((c) => c.id === a.classId)) for (const s of a.slots) days.add(s.weekday);
  return [...days].sort((a, b) => a - b);
}

/**
 * A class on a day the school week does not have (normally a Saturday or Sunday). DepEd's weeks run Monday to
 * Friday, so the competency the pacing engine put on that day is Tala's suggestion, and the screen says so.
 */
export const outsideSchoolWeek = (date: string, schoolWeekdays?: readonly number[] | null) =>
  !schoolWeek(schoolWeekdays).includes(weekdayOf(date));

export interface WeekSpan {
  start: string;
  end: string;
}

/**
 * The dates the week header names for the Monday-to-Sunday week starting `monday`. The school week (normally
 * Monday to Friday) as before, stretched to Saturday or Sunday when the teacher's timetable meets then or that week
 * has a class on the day (a make-up). A teacher whose classes are all outside the school week (a Saturday and
 * Sunday school) sees just those days.
 */
export function weekSpan(
  monday: string,
  args: {
    schoolWeekdays?: readonly number[] | null;
    scheduleWeekdays: readonly number[];
    sessionDates: readonly string[];
  }
): WeekSpan {
  const sunday = addDays(monday, 6);
  const school = schoolWeek(args.schoolWeekdays);
  const used = new Set([
    ...args.scheduleWeekdays,
    ...args.sessionDates.filter((d) => d >= monday && d <= sunday).map(weekdayOf),
  ]);
  const meetsInSchoolWeek = used.size === 0 || [...used].some((d) => school.includes(d));
  const days = [...(meetsInSchoolWeek ? school : []), ...used];
  return {
    start: addDays(monday, Math.min(...days) - 1),
    end: addDays(monday, Math.max(...days) - 1),
  };
}

/**
 * Where the "add a make-up class" date starts: the next Saturday, as before, unless the affected subjects already
 * meet on Saturday (a make-up there would only replace that class); then the next Sunday they do not meet on, then
 * the next day of the week they do not meet on. The teacher can pick any other date.
 */
export function nextMakeupDate(today: string, busyWeekdays: readonly number[]): string {
  const ahead = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  const free = (d: string) => !busyWeekdays.includes(weekdayOf(d));
  return (
    ahead.find((d) => weekdayOf(d) === 6 && free(d)) ??
    ahead.find((d) => weekdayOf(d) === 7 && free(d)) ??
    ahead.find(free) ??
    ahead.find((d) => weekdayOf(d) === 6)!
  );
}
