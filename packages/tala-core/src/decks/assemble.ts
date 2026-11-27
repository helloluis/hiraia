/**
 * A multi-grade session's slides, put together from each grade's own lesson slides (pure; Luis, 27 Nov 2026:
 * "Multigrade presentations should be dynamically assembled in the Lesson Plan view").
 *
 * The session plan (template tpl.multigrade.v1) says how the period runs: its time blocks in order, who the teacher is
 * with in each one (one grade, the whole room, or nobody) and what every grade does meanwhile. Each grade's own lesson
 * has its own slides (a copy of a pack's day, or slides made with AI from that lesson). This lays them out in the
 * session's own order, never one deck after another:
 *   - the cover: the session's title and grades; the plan's note for the teacher in its notes;
 *   - a shared block ("Start together", "Finish together"): one slide with each grade's part of it, then each grade's
 *     opening questions (at the start) or summary and exit check (at the end);
 *   - a turn with one grade: a divider (the block and its minutes, and what the others do meanwhile), a
 *     "Meanwhile, Grade n" slide with the task of each grade working on its own or with a partner, then the grade's own
 *     teaching slides;
 *   - at the end, each grade deck's credits (who reviewed it, how it was made), so honest labels travel with the slides.
 * Every slide carries its grade on a chip, and its notes say which block it belongs to and for how long. A grade with
 * no slides gets one plain slide where its slides would be ("No slides yet for Grade 3's lesson").
 *
 * Nothing here is stored: the web recomputes it from the plan and the slides as they are now, and the PowerPoint
 * download is made by the server through this same function from the saved plan, so the two cannot drift apart.
 */
import type { Lang } from '../contracts/common';
import type { MultigradeBlock, RichText } from '../contracts/content';
import type { DeckSlide, SessionPart } from '../contracts/decks';
import type { PackLang } from '../contracts/packs';
import type { Plan, PlanSection } from '../contracts/records';
import { MULTIGRADE_TEMPLATE_ID } from '../plan/combine';
import { richTextPlainText } from '../plan/text';
import { SESSION_WORDS, type SessionMode, type SessionWords } from './assemble-words';
import { cleanLine } from './fit';
import type { DeckLayoutInput, LayoutSlideInput } from './layout';

/** One grade's lesson slides, as the session needs them. */
export interface SessionGradeSlides {
  deckId: string;
  origin: 'pack' | 'lesson';
  language: PackLang;
  /** The pack the copy came from was approved by a named teacher. */
  approved: boolean;
  reviewer: string | null;
  sourcesLine: string;
  /** The deck differs from what was copied or made. */
  edited: boolean;
  /** The lesson's slides, in deck order. */
  slides: DeckSlide[];
}

export interface SessionGradeInput {
  groupId: string;
  grade: string;
  /** Null when no lesson of this grade was found for the session. */
  lessonTitle: string | null;
  /** Null when the grade's lesson has no slides yet. */
  slides: SessionGradeSlides | null;
}

export interface SessionInput {
  title: string;
  language: Lang;
  subject: string;
  minutes: number;
  /** The plan's note for the teacher (multigrade section). */
  note: string;
  blocks: MultigradeBlock[];
  /** In the plan's group order. */
  grades: SessionGradeInput[];
  words?: SessionWords;
}

export type AssembledRole = 'cover' | 'block' | 'meanwhile' | 'open' | 'teach' | 'close' | 'missing' | 'credits';

export interface AssembledSlide extends LayoutSlideInput {
  role: AssembledRole;
  /** The grade the slide is for; null for the cover and shared blocks. */
  groupId: string | null;
  blockId: string | null;
  /** The grade slide this shows, when it is one. */
  from: { deckId: string; slideId: string } | null;
}

export interface AssembledBlock {
  id: string;
  label: string;
  minutes: number;
  teacherWith: string;
  /** Index of the block's first slide and how many it has. */
  first: number;
  count: number;
}

export interface AssembledSession {
  layout: Omit<DeckLayoutInput, 'slides'> & { slides: AssembledSlide[] };
  /** Picture keys used by the slides → the deck and drawing each one is. */
  media: Record<string, { deckId: string; slug: string }>;
  blocks: AssembledBlock[];
  /** Grade groups that have no slides in the session (no lesson found, or a lesson without slides). */
  missing: string[];
}

const blankSlide = (id: string, day: number, kind: LayoutSlideInput['kind']): LayoutSlideInput => ({
  id, day, kind, title: '', lines: [], choices: [], revealOf: null, correctChoice: null, image: null, notes: '',
});

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A rich text as slide lines: one per paragraph or list item, list markers removed, at most `max`. */
export function richTextLines(blocks: RichText, max = 8): string[] {
  return richTextPlainText(blocks)
    .split('\n')
    .map((l) => cleanLine(l.replace(/^\d+\.\s*/, '')))
    .filter(Boolean)
    .slice(0, max)
    .map((l) => clip(l, 240));
}

/** A grade's slides cut into the parts a session spreads out: opening questions, teaching, summary and exit check. */
export function lessonPhases(slides: DeckSlide[]): { open: DeckSlide[]; teach: DeckSlide[]; close: DeckSlide[] } {
  const content = slides.filter((s) => s.kind !== 'cover' && s.kind !== 'day' && s.kind !== 'credits');
  let a = 0;
  while (a < content.length && a < 2 && content[a]!.kind === 'question') a++;
  // The close: the final check (an exit ticket, or a check with its answer slide), then the summary slides before it.
  let b = content.length;
  const last = content[b - 1];
  const beforeLast = content[b - 2];
  if (b - 2 >= a && last?.kind === 'reveal' && beforeLast?.kind === 'check' && last.revealOf === beforeLast.id) b -= 2;
  else if (b - 1 >= a && last?.kind === 'check') b -= 1;
  while (b > a && content[b - 1]!.kind === 'summary') b--;
  if (b <= a) return { open: [], teach: content, close: [] };
  return { open: content.slice(0, a), teach: content.slice(a, b), close: content.slice(b) };
}

const modeOf = (block: MultigradeBlock, groupId: string): SessionMode => block.groups[groupId]?.mode ?? 'independent';

/** Who has the teacher in a block: the grade she is with and any grade paired with it for direct teaching. */
function directGroups(block: MultigradeBlock, groupIds: string[]): string[] {
  if (block.teacherWith === 'all' || block.teacherWith === 'none') return [];
  return groupIds.filter(
    (id) => id === block.teacherWith || (block.pairedGroupIds.includes(id) && block.pairedGroupIds.includes(block.teacherWith) && modeOf(block, id) === 'direct')
  );
}

export function assembleSession(input: SessionInput): AssembledSession {
  const w = input.words ?? SESSION_WORDS[input.language];
  const groupIds = input.grades.map((g) => g.groupId);
  const gradeOf = (groupId: string) => input.grades.find((g) => g.groupId === groupId);
  const label = (groupId: string) => w.gradeLabel(gradeOf(groupId)?.grade ?? '');
  const blocks = input.blocks;
  const rotation = (b: MultigradeBlock) => b.teacherWith !== 'all';
  const firstRotation = blocks.findIndex(rotation);
  const lastRotation = blocks.length - 1 - [...blocks].reverse().findIndex(rotation);
  const hasRotation = firstRotation >= 0;
  // Shared blocks before the first turn open the session; after the last turn they close it.
  const isOpening = (i: number) => !rotation(blocks[i]!) && (hasRotation ? i < firstRotation : i === 0);
  const isClosing = (i: number) => !rotation(blocks[i]!) && (hasRotation ? i > lastRotation : i === blocks.length - 1 && i > 0);
  const openingBlock = blocks.findIndex((_b, i) => isOpening(i));
  const closingBlock = blocks.findIndex((_b, i) => isClosing(i));

  // Where each grade's teaching slides go: its first turn with the teacher; else its first block on its own.
  const teachAt = new Map<string, number>();
  for (const id of groupIds) {
    let at = blocks.findIndex((b) => directGroups(b, groupIds).includes(id));
    if (at < 0) at = blocks.findIndex((b) => rotation(b) && modeOf(b, id) !== 'shared');
    if (at < 0) at = hasRotation ? firstRotation : Math.max(0, openingBlock);
    teachAt.set(id, at);
  }

  const media: AssembledSession['media'] = {};
  const out: AssembledSlide[] = [];
  const outBlocks: AssembledBlock[] = [];
  const missing = new Set<string>();
  const push = (s: AssembledSlide) => out.push(s);

  /** A grade slide, re-keyed for the session: ids, its answer link and its picture are the grade's own. */
  const gradeSlide = (gi: number, s: DeckSlide, role: AssembledRole, day: number, block: MultigradeBlock | null, section: string, lead: string): AssembledSlide => {
    const g = input.grades[gi]!;
    const deckId = g.slides!.deckId;
    let image: LayoutSlideInput['image'] = null;
    if (s.image) {
      const key = `g${gi}:${s.image.slug}`;
      media[key] = { deckId, slug: s.image.slug };
      image = { slug: key, alt: s.image.alt };
    }
    return {
      id: `g${gi}-${s.id}`,
      day,
      kind: s.kind,
      title: s.title,
      lines: s.lines,
      choices: s.choices,
      revealOf: s.revealOf ? `g${gi}-${s.revealOf}` : null,
      correctChoice: s.correctChoice,
      image,
      notes: [lead, s.notes].filter((x) => x.trim()).join('\n\n'),
      tag: w.gradeLabel(g.grade),
      section,
      role,
      groupId: g.groupId,
      blockId: block?.id ?? null,
      from: { deckId, slideId: s.id },
    };
  };

  const phases = input.grades.map((g) => (g.slides ? lessonPhases(g.slides.slides) : { open: [], teach: [], close: [] }));

  /** The plain slide that stands where a grade's slides would be. */
  const missingSlide = (gi: number, bi: number, block: MultigradeBlock, section: string): AssembledSlide => {
    const g = input.grades[gi]!;
    missing.add(g.groupId);
    const lines = richTextLines(block.groups[g.groupId]?.activity ?? [], 7);
    return {
      ...blankSlide(`x${bi}-${gi}`, bi + 1, 'activity'),
      title: g.lessonTitle === null ? w.noLessonTitle(label(g.groupId)) : w.missingTitle(label(g.groupId)),
      lines: lines.length ? lines : [w.missingLead],
      notes: [w.blockNote(block.label, block.minutes), g.lessonTitle === null ? w.noLessonNote(label(g.groupId)) : w.missingNote(label(g.groupId))].join('\n\n'),
      tag: label(g.groupId),
      section,
      role: 'missing',
      groupId: g.groupId,
      blockId: block.id,
      from: null,
    };
  };

  /** A grade's teaching slides (with its opening and closing ones when the session has no shared block for them). */
  const teachSlides = (gi: number, bi: number, block: MultigradeBlock, section: string) => {
    const g = input.grades[gi]!;
    if (!g.slides || !(phases[gi]!.open.length + phases[gi]!.teach.length + phases[gi]!.close.length)) {
      push(missingSlide(gi, bi, block, section));
      return;
    }
    const direct = directGroups(block, groupIds).includes(g.groupId);
    const lead = `${w.blockNote(block.label, block.minutes)} · ${direct ? w.withTeacher(label(g.groupId)) : `${label(g.groupId)}: ${w.mode[modeOf(block, g.groupId)]}.`}`;
    const p = phases[gi]!;
    const list = [...(openingBlock < 0 ? p.open : []), ...p.teach, ...(closingBlock < 0 ? p.close : [])];
    for (const s of list) push(gradeSlide(gi, s, 'teach', bi + 1, block, section, lead));
  };

  // The cover.
  const gradeNames = input.grades.map((g) => w.gradeLabel(g.grade));
  push({
    ...blankSlide('c0', 0, 'cover'),
    title: clip(input.title.trim() || gradeNames.join(' · '), 140),
    lines: [w.coverLine(gradeNames, input.minutes)],
    notes: input.note.trim(),
    section: null,
    role: 'cover',
    groupId: null,
    blockId: null,
    from: null,
  });

  blocks.forEach((block, bi) => {
    const day = bi + 1;
    const section = clip(`${block.label} · ${w.minutes(block.minutes)}`, 60);
    const first = out.length;
    const kicker = w.minutes(block.minutes);
    if (!rotation(block)) {
      // The whole room together: each grade's part, then the grades' opening or closing slides.
      const lines = input.grades
        .map((g) => {
          const first = richTextLines(block.groups[g.groupId]?.activity ?? [], 1)[0];
          return first ? clip(`${w.gradeLabel(g.grade)}: ${first}`, 120) : '';
        })
        .filter(Boolean)
        .slice(0, 4);
      push({
        ...blankSlide(`b${bi}`, day, 'day'),
        title: clip(block.label, 140),
        lines,
        kicker,
        tag: w.allGrades,
        notes: [
          w.blockNote(block.label, block.minutes),
          ...input.grades.map((g) => `${w.gradeLabel(g.grade)}: ${richTextLines(block.groups[g.groupId]?.activity ?? [], 8).join(' ')}`),
        ].join('\n'),
        section,
        role: 'block',
        groupId: null,
        blockId: block.id,
        from: null,
      });
      const lead = w.blockNote(block.label, block.minutes);
      if (bi === openingBlock)
        input.grades.forEach((_g, gi) => phases[gi]!.open.forEach((s) => push(gradeSlide(gi, s, 'open', day, block, section, lead))));
      if (bi === closingBlock)
        input.grades.forEach((_g, gi) => phases[gi]!.close.forEach((s) => push(gradeSlide(gi, s, 'close', day, block, section, lead))));
      // A grade whose teaching has nowhere else to go (a session without turns) is taught here.
      input.grades.forEach((g, gi) => {
        if (teachAt.get(g.groupId) === bi && !hasRotation) teachSlides(gi, bi, block, section);
      });
    } else {
      const direct = directGroups(block, groupIds);
      const others = groupIds.filter((id) => !direct.includes(id));
      const otherParts = others.map((id) => `${label(id)}: ${w.mode[modeOf(block, id)]}`);
      push({
        ...blankSlide(`b${bi}`, day, 'day'),
        title: clip(block.label, 140),
        lines: block.teacherWith === 'none' ? [w.everyoneAlone] : otherParts.length ? [clip(w.meanwhileLine(otherParts), 200)] : [],
        kicker,
        tag: direct.length ? direct.map(label).join(' + ') : w.allGrades,
        notes: [w.blockNote(block.label, block.minutes), ...(direct.length ? [w.withTeacher(direct.map(label).join(' + '))] : []), ...otherParts].join('\n'),
        section,
        role: 'block',
        groupId: direct[0] ?? null,
        blockId: block.id,
        from: null,
      });
      // What every grade without the teacher does now, from the plan's own words for this block.
      for (const id of others) {
        const gi = groupIds.indexOf(id);
        const lines = richTextLines(block.groups[id]?.activity ?? [], 8);
        push({
          ...blankSlide(`m${bi}-${gi}`, day, 'activity'),
          title: w.meanwhileTitle(label(id)),
          lines: lines.length ? lines : [w.missingLead],
          notes: [w.blockNote(block.label, block.minutes), `${label(id)}: ${w.mode[modeOf(block, id)]}.`, ...(direct.length ? [w.withTeacher(direct.map(label).join(' + '))] : [])].join('\n'),
          tag: label(id),
          section,
          role: 'meanwhile',
          groupId: id,
          blockId: block.id,
          from: null,
        });
      }
      // The grade (or paired grades) with the teacher: their own slides, the first time they have her.
      for (const id of groupIds) if (teachAt.get(id) === bi) teachSlides(groupIds.indexOf(id), bi, block, section);
    }
    outBlocks.push({ id: block.id, label: block.label, minutes: block.minutes, teacherWith: block.teacherWith, first, count: out.length - first });
  });

  // Honest labels travel: each grade deck's own credits (reviewed or draft, edited, made with AI, art).
  const aboutDay = blocks.length + 1;
  input.grades.forEach((g, gi) => {
    if (!g.slides) {
      missing.add(g.groupId);
      return;
    }
    const hasArt = g.slides.slides.some((s) => s.image) || g.slides.origin === 'pack';
    push({
      ...blankSlide(`k${gi}`, aboutDay, 'credits'),
      title: w.creditsTitle(w.gradeLabel(g.grade)),
      credits: {
        approved: g.slides.approved && g.slides.origin === 'pack',
        reviewer: g.slides.reviewer,
        sourcesLine: g.slides.sourcesLine,
        personalCopy: g.slides.edited,
        ai: g.slides.origin === 'lesson',
        art: hasArt,
      },
      tag: w.gradeLabel(g.grade),
      section: w.about,
      role: 'credits',
      groupId: g.groupId,
      blockId: null,
      from: null,
    });
  });

  const approved = input.grades.every((g) => g.slides && g.slides.approved && g.slides.origin === 'pack');
  return {
    layout: {
      language: input.language,
      grade: input.grades.map((g) => g.grade).join(', '),
      term: 0,
      week: 0,
      approved,
      reviewer: null,
      sourcesLine: '',
      personalCopy: false,
      slides: out,
      footer: w.footer(
        input.grades.map((g) => g.grade),
        input.subject
      ),
    },
    media,
    blocks: outBlocks,
    missing: groupIds.filter((id) => missing.has(id)),
  };
}

/**
 * The session's input from a session plan and its parts (contracts/decks.ts SessionPart). The web calls this with the
 * plan as it is on the device right now, the server with the plan as saved (for the download): the same function, so
 * the two show the same slides for the same plan. Grades follow the plan's own groups; a group without a part has no
 * lesson and no slides.
 */
export function sessionInputFromParts(args: { plan: Plan; sections: PlanSection[]; parts: SessionPart[] }): SessionInput {
  const { plan } = args;
  const mg = args.sections.find((s) => s.planId === plan.id && s.key === 'multigrade')?.content;
  const groupIds = plan.gradeGroupIds.length ? plan.gradeGroupIds : args.parts.map((p) => p.groupId);
  return {
    title: plan.title,
    language: plan.language,
    subject: plan.subjectName,
    minutes: plan.durationMinutes,
    note: mg?.type === 'multigrade' ? (mg.note ?? '') : '',
    blocks: mg?.type === 'multigrade' ? mg.blocks : [],
    grades: groupIds.map((groupId, i): SessionGradeInput => {
      const part = args.parts.find((p) => p.groupId === groupId);
      const grade = part?.grade ?? plan.grades[i] ?? plan.grades[0] ?? '';
      const s = part?.slides ?? null;
      return {
        groupId,
        grade,
        lessonTitle: part?.source ? part.source.title : null,
        slides: s
          ? {
              deckId: s.deckId,
              origin: s.origin,
              language: s.language,
              approved: s.sourceApproved,
              reviewer: s.credits.reviewer,
              sourcesLine: s.credits.sourcesLine,
              edited: s.edited,
              slides: s.slides,
            }
          : null,
      };
    }),
  };
}

/* ---------------- finding each grade's own lesson ---------------- */

/** Where and when a session plan is taught (its first placement). */
const placementOf = (session: Pick<Plan, 'placements'>) => ({
  classId: session.placements[0]?.classId ?? null,
  date: session.placements[0]?.dates[0] ?? null,
});

const sameSet = (a: string[] | undefined, b: string[] | undefined) =>
  !!a && !!b && a.length > 0 && a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * The teacher's saved lessons that could be one grade's part of a session, as the "All grades together" screen offers
 * them: a single-grade lesson of that grade group, or of the same grade in another class. Session plans and archived
 * lessons are never offered. The lesson placed on the session's class and day comes first.
 */
export function sessionSourceChoices(args: { session: Plan; groupId: string; grade: string; plans: Plan[] }): Plan[] {
  const { session, groupId, grade } = args;
  const sessionGroups = new Set(session.gradeGroupIds);
  const where = placementOf(session);
  const onDate = (p: Plan) => !!where.date && p.placements.some((pl) => pl.classId === where.classId && pl.dates.includes(where.date!));
  return args.plans
    .filter((p) => p.id !== session.id && p.state !== 'archived' && p.templateId !== MULTIGRADE_TEMPLATE_ID && p.grades.length === 1)
    .filter((p) => (p.gradeGroupIds.length === 1 && p.gradeGroupIds[0] === groupId) || (!p.gradeGroupIds.some((id) => sessionGroups.has(id)) && p.grades[0] === grade))
    .sort(
      (a, b) =>
        Number(onDate(b)) - Number(onDate(a)) ||
        Number(b.gradeGroupIds[0] === groupId) - Number(a.gradeGroupIds[0] === groupId) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
    );
}

/**
 * The grade's own lesson for the session, when there is exactly one clear answer: the grade group's lesson placed on
 * the session's class and day (what the combine screen picks), else the grade group's lesson with exactly the
 * competencies the session lists for that grade (combining copies them). Otherwise none: the teacher chooses.
 */
export function sessionSourceFor(args: { session: Plan; groupId: string; grade: string; plans: Plan[] }): Plan | null {
  const { session, groupId } = args;
  const where = placementOf(session);
  const own = sessionSourceChoices(args).filter((p) => p.gradeGroupIds.length === 1 && p.gradeGroupIds[0] === groupId);
  if (where.date) {
    const onDate = own.filter((p) => p.placements.some((pl) => pl.classId === where.classId && pl.dates.includes(where.date!)));
    if (onDate.length === 1) return onDate[0]!;
  }
  const wanted = session.competencies[groupId];
  const same = own.filter((p) => sameSet(p.competencies[groupId], wanted));
  return same.length === 1 ? same[0]! : null;
}
