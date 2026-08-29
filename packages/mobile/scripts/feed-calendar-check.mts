// Quarter inference across school years: known DepEd calendar (SY 2026-27) and the generic PH fallback.
// Run: node_modules/.bin/tsx packages/mobile/scripts/feed-calendar-check.mts
import { inferCurriculumQuarter, calendarFor, genericCalendar } from '../../shared/src/curriculum/feedWeighting.ts';
const D = (s: string) => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
for (const s of ['2026-08-27','2027-03-20','2027-05-01','2027-06-10','2027-06-20','2027-09-15','2027-12-01','2028-02-15','2028-04-01','2028-04-20','2029-10-10']) {
  const q = inferCurriculumQuarter(D(s)); const c = calendarFor(D(s));
  console.log(`  ${s} → ${q.quarter === null ? 'summer' : 'Q'+q.quarter} (${(100*q.fraction).toFixed(0)}%)  [${c.schoolYear}: ${c.opens}→${c.closes}${c.source.startsWith('generic') ? ', generic' : ''}]`);
}
console.log('  generic 2027:', JSON.stringify(genericCalendar(2027).terms[0].instruction), '| generic 2026 would open', genericCalendar(2026).opens, '(real DO 009: 2026-06-08)');
