import type { weekEn } from './week.en';

/** Filipino strings: week (teacher-portal rework). Plain teacher-facing Filipino; Taglish where teachers say it that way. */
export const weekFil = {
  /* header */
  'wk.termWeek': 'Term {term} · Week {week}',
  'wk.pager': 'Ibang linggo',
  'wk.backToThisWeek': 'Bumalik sa linggong ito',

  /* up next */
  'wk.upNext.today': 'Susunod na klase · Ngayon',
  'wk.upNext.tomorrow': 'Susunod na klase · Bukas',
  'wk.upNext.day': 'Susunod na klase · {weekday}',
  'wk.upNext.lead': 'Ito ang susunod mong ituturo. Puwede kang gumawa ng lesson plan o magbukas ng pack para sa bawat aralin.',
  'wk.noUpcoming': 'Walang klase sa susunod na tatlong linggo.',
  'wk.lessons.one': '1 aralin',
  'wk.lessons.many': '{n} aralin',
  'wk.tomorrow': 'Bukas',

  /* one lesson */
  'wk.minutes': '{n} min',
  'wk.competency': 'DepEd competency',
  'wk.myPlan': 'Plano ko: {title}',
  'wk.openPlan': 'Buksan ang plano ko',
  'wk.mark': 'Markahan ang klase',

  /* Library help */
  'wk.lib.kicker': 'Mula sa Library',
  'wk.lib.calendar': 'Para sa linggong ito sa kalendaryo ng DepEd',
  'wk.lib.meta': 'Grade {grade} · Term {term} · Week {week}',
  'wk.lib.inEnglish': 'Nasa English',
  'wk.lib.inFilipino': 'Nasa Filipino',
  'wk.lib.lessonDay': 'Lesson plan · Day {day}',
  'wk.lib.lessons': 'Mga lesson plan',
  'wk.lib.slides': 'Slides',
  'wk.lib.guide': 'Teacher guide',
  'wk.lib.none': 'Wala pang pack para sa paksang ito.',
  'wk.lib.browseGrade': 'Tingnan ang mga pack ng Grade {grade}',
  'wk.help.title': 'Tulong mula sa Library ngayong linggo',
  'wk.help.titleOther': 'Tulong mula sa Library',
  'wk.help.intro': 'Mga lesson plan, slides at teacher guide na tugma sa itinuturo mo.',
  'wk.help.forDay': 'Para sa {date}',
  'wk.help.forDays': 'Para sa {from} – {to}',
  'wk.help.empty': 'Wala pang pack na tugma sa mga araling ito. May mga bagong pack na idinaragdag sa Library habang natatapos ang mga ito.',
  'wk.help.scienceOnly': 'May mga Science pack sa Library para sa Grade 3 hanggang 10.',
  'wk.help.browseAll': 'Tingnan ang buong Library',

  /* the other days */
  'wk.rest.title': 'Iba pang araw ngayong linggo',
  'wk.sum.allPlanned': 'may plano na ang lahat',
  'wk.sum.notTaught': '{n} ang hindi naituro',
  'wk.sum.partial': '{n} ang bahagyang naituro',
  'wk.sum.allTaught': 'naituro na ang lahat',
  'wk.kind.national_holiday': 'Pambansang holiday',
  'wk.kind.deped_event': 'Aktibidad ng DepEd',

  /* footer */
  'wk.noClassAction': 'Maglagay ng araw na walang klase',
  'wk.pace.title': 'Nakasunod ba ako sa iskedyul?',
  'wk.pace.hint': 'Bawat asignatura ngayong buwan',
  'wk.empty.library': 'O tingnan muna ang Library',
} satisfies Record<keyof typeof weekEn, string>;
