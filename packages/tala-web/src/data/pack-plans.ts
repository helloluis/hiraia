/**
 * Pure conversion of a Hiraia teaching pack into the teacher's own records (no React, no I/O): one editable DLP plan
 * per day, tagged with the day's curriculum ids and linked to the pack it came from.
 */
import { BUILTIN_TEMPLATES } from '@hiraia/tala-core/contracts';
import type { Block, ClassRecord, DayPlan, Plan, PlanSection, WeeklyPackContent } from '@hiraia/tala-core/contracts';

const WORDS = {
  en: {
    phase: {
      activating_prior_knowledge: 'Activating prior knowledge',
      lesson_purpose: 'Establishing lesson purpose',
      developing_understanding: 'Developing and deepening understanding',
      generalization: 'Making generalizations',
      evaluating_learning: 'Evaluating learning',
    } as Record<string, string>,
    teacher: 'Teacher',
    learners: 'Learners',
    bigIdea: 'Big idea',
    exit: 'Exit ticket',
    answer: 'Answer',
    support: 'Support',
    extension: 'Extension',
    longer: 'Longer period',
    deck: (title: string, range: string) => `Week deck "${title}" (${range})`,
    slide: 'Slide',
    slides: 'Slides',
    heading: (p: WeeklyPackContent, day: number) => `${p.title} — Grade ${p.grade} Science, Term ${p.term}, Week ${p.week}, Day ${day}.`,
  },
  fil: {
    phase: {
      activating_prior_knowledge: 'Pagkuha ng Dating Kaalaman',
      lesson_purpose: 'Paglalahad ng Layunin',
      developing_understanding: 'Paglinang at Pagpapalalim',
      generalization: 'Paglalahat',
      evaluating_learning: 'Pagtataya',
    } as Record<string, string>,
    teacher: 'Guro',
    learners: 'Mga mag-aaral',
    bigIdea: 'Big idea',
    exit: 'Exit ticket',
    answer: 'Sagot',
    support: 'Tulong',
    extension: 'Dagdag na hamon',
    longer: 'Para sa mas mahabang klase',
    deck: (title: string, range: string) => `Deck ng linggo na "${title}" (${range})`,
    slide: 'Slide',
    slides: 'Slides',
    heading: (p: WeeklyPackContent, day: number) => `${p.title} — Grade ${p.grade} Science, Term ${p.term}, Week ${p.week}, Araw ${day}.`,
  },
} as const;

const p = (text: string, b = false): Block => ({ t: 'p', spans: [{ text: text.slice(0, 4000), ...(b ? { b: true } : {}) }] });
const labelled = (label: string, text: string): Block => ({ t: 'p', spans: [{ text: `${label}: `, b: true }, { text: text.slice(0, 3900) }] });

/** Short, stable id for the content a plan was copied from (lineage.versionId must fit the 64-char Id). */
export function packVersion(review: { contentSha256: string }) {
  return review.contentSha256.slice(0, 16);
}

/**
 * One editable DLP plan for one day of a pack. Pure; the caller writes it through the sync engine.
 * Competency tags are the pack day's curriculum ids, so the plan sits on the teacher's timeline like any other.
 */
export function planFromPackDay(args: {
  pack: WeeklyPackContent;
  review: { contentSha256: string; publication: string };
  day: DayPlan;
  cls: ClassRecord;
  gradeGroupId: string;
  assignmentId: string | null;
  date: string | null;
  newId: () => string;
}): { plan: Plan; sections: PlanSection[] } {
  const { pack, day, cls, gradeGroupId } = args;
  const template = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.dlp.v1')!;
  const planId = args.newId();
  const deck = pack.slides;
  const W = WORDS[pack.language];
  const slideNo = (id: string) => deck.findIndex((s) => s.id === id) + 1;
  const range = (ids: string[]) => {
    const n = ids.map(slideNo).filter((x) => x > 0);
    return n.length ? (n.length === 1 ? `${W.slide} ${n[0]}` : `${W.slides} ${n[0]}–${n[n.length - 1]}`) : '';
  };
  const grade = cls.gradeGroups.find((g) => g.id === gradeGroupId)?.grade ?? pack.grade;
  const plan: Plan = {
    id: planId,
    title: `Day ${day.day}: ${day.title}`.slice(0, 200),
    templateId: template.id,
    language: pack.language,
    subjectName: 'Science',
    learningAreaId: 'science',
    grades: [grade],
    gradeGroupIds: [gradeGroupId],
    competencies: { [gradeGroupId]: day.competencyIds },
    curriculumVersion: pack.curriculumVersion,
    customObjectives: [],
    durationMinutes: day.minutes,
    placements: [{ classId: cls.id, assignmentId: args.assignmentId, dates: args.date ? [args.date] : [] }],
    state: 'draft',
    lock: null,
    submitted: null,
    aiDraft: args.review.publication !== 'approved',
    aiAssisted: true,
    lineage: {
      artifactId: `pack.${pack.packId}`,
      versionId: packVersion(args.review),
      title: pack.title.slice(0, 200),
      authorDisplayName: 'Hiraia teaching pack',
    },
    unitId: null,
    conflictCopyOf: null,
  } as Plan;
  const content: Record<string, PlanSection['content']> = {
    objectives: { type: 'list', items: [day.objective] },
    content: {
      type: 'text',
      blocks: [
        p(W.heading(pack, day.day)),
        p(`${W.bigIdea}: ${pack.guide.bigIdea}`),
      ],
    },
    materials: {
      type: 'list',
      items: [...day.materials, W.deck(pack.title, range(day.flow.flatMap((f) => f.slideIds)))].map((m) => m.slice(0, 1000)),
    },
    procedure: {
      type: 'procedure',
      steps: day.flow.map((f) => ({
        id: args.newId(),
        title: W.phase[f.phase] ?? f.phase,
        minutes: f.minutes,
        body: [labelled(W.teacher, f.teacher), labelled(W.learners, f.learners), ...(f.slideIds.length ? [p(range(f.slideIds))] : [])],
      })),
    },
    assessment: {
      type: 'text',
      blocks: [labelled(W.exit, day.check.question), labelled(W.answer, `${day.check.answer} ${day.check.why}`)],
    },
    differentiation: {
      type: 'text',
      blocks: [labelled(W.support, day.support), labelled(W.extension, day.extension), labelled(W.longer, day.longerPeriod)],
    },
  };
  const sections: PlanSection[] = template.sections.map((s) => ({
    id: args.newId(),
    planId,
    key: s.key,
    content:
      content[s.key] ??
      (s.contentType === 'list'
        ? { type: 'list', items: [] }
        : s.contentType === 'procedure'
          ? { type: 'procedure', steps: [] }
          : { type: 'text', blocks: [] }),
    origin: content[s.key] ? 'copied' : 'manual',
    editedByTeacher: false,
    gen: null,
  }));
  return { plan, sections };
}

/** School days Monday–Friday of the week that contains `date` (ISO). */
export function weekdaysFrom(date: string): string[] {
  const [y, m, d] = date.split('-').map(Number);
  const base = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const monday = new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * 86400_000);
  return [0, 1, 2, 3, 4].map((i) => new Date(monday.getTime() + i * 86400_000).toISOString().slice(0, 10));
}

