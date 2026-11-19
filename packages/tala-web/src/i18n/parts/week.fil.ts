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
  'wk.upNext.lead': 'Ito ang susunod mong ituturo. Sa bawat lesson, sumulat ng plano o buksan ang handang pack.',
  'wk.noUpcoming': 'Walang klase sa susunod na tatlong linggo.',
  'wk.lessons.one': '1 lesson',
  'wk.lessons.many': '{n} lesson',
  'wk.tomorrow': 'Bukas',

  /* one lesson */
  'wk.minutes': '{n} min',
  'wk.competency': 'DepEd competency',
  'wk.myPlan': 'Plano ko: {title}',
  'wk.openPlan': 'Buksan ang plano ko',
  'wk.mark': 'Markahan ang klase',

  /* Library help */
  'wk.lib.kicker': 'Mula sa Library',
  'wk.lib.calendar': 'Para sa linggong ito sa DepEd calendar',
  'wk.lib.meta': 'Grade {grade} · Term {term} · Week {week}',
  'wk.lib.inEnglish': 'Nasa English',
  'wk.lib.inFilipino': 'Nasa Filipino',
  'wk.lib.lessonDay': 'Lesson plan · Day {day}',
  'wk.lib.lessons': 'Mga lesson plan',
  'wk.lib.slides': 'Slides',
  'wk.lib.guide': 'Teacher guide',
  'wk.lib.none': 'Wala pang handang pack para sa topic na ito.',
  'wk.lib.browseGrade': 'Tingnan ang mga pack ng Grade {grade}',
  'wk.help.title': 'Tulong mula sa Library ngayong linggo',
  'wk.help.titleOther': 'Tulong mula sa Library',
  'wk.help.intro': 'Mga handang lesson plan, slides at teacher guide na tugma sa itinuturo mo.',
  'wk.help.forDay': 'Para sa {date}',
  'wk.help.forDays': 'Para sa {from} – {to}',
  'wk.help.empty': 'Wala pang handang pack na tugma sa mga lesson na ito. Dinadagdagan ang Library habang nabubuo ang mga bagong pack.',
  'wk.help.scienceOnly': 'May mga handang Science pack ang Library para sa Grade 3 hanggang 10.',
  'wk.help.browseAll': 'Tingnan ang buong Library',

  /* the other days */
  'wk.rest.title': 'Iba pang araw ngayong linggo',
  'wk.sum.allPlanned': 'may plano na lahat',
  'wk.sum.notTaught': '{n} ang hindi naituro',
  'wk.sum.partial': '{n} ang bahagyang naituro',
  'wk.sum.allTaught': 'naituro lahat',
  'wk.kind.national_holiday': 'Piyesta opisyal',
  'wk.kind.deped_event': 'Aktibidad ng DepEd',

  /* footer */
  'wk.noClassAction': 'Maglagay ng araw na walang klase',
  'wk.pace.title': 'Nasa tamang bilis ba ako?',
  'wk.pace.hint': 'Ngayong buwan, bawat subject',
  'wk.empty.library': 'O tingnan muna ang Library',
} satisfies Record<keyof typeof weekEn, string>;
