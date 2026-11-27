/**
 * A lesson's presentation (Luis, 27 Nov 2026; contracts/decks.ts "a lesson's presentation").
 *
 * - A lesson plan (a synced record, read here through the records service, owner-scoped, always as SAVED now) is
 *   linked to one of the teacher's decks: her copy of the pack the lesson fits (one copy holds the week; the link says
 *   which day is the lesson's), or slides made with AI from the lesson itself (a deck of origin `lesson`).
 * - AI is asked through a job (one at a time per lesson; asking again while one runs answers that one). A job ends in
 *   a PROPOSAL, or a failure that says why; nothing is written into a deck until the teacher applies the proposal.
 *   Applying keeps the deck as it was as an earlier version first (decks_revisions), in the same transaction, and
 *   refuses when the slides it replaces changed after the proposal was made (unless she says to go ahead).
 * - The lesson's hash is kept with the link: when the saved lesson differs later, the presentation is `stale`. That is
 *   a cue only; nothing is ever regenerated or overwritten because of it.
 * - A multi-grade session plan has no deck of its own: each grade's part is that grade's own lesson (found the way the
 *   combine screen picks it, or chosen by the teacher) with its own slides; the web lays them out in block order
 *   (decks/assemble.ts) and the download is put together here by the same function from the saved plan.
 *
 * Every route needs a session and every read and write names the owner. Slide text, notes, prompts and model output
 * are never logged.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BUILTIN_TEMPLATES, DECK_LIMITS, DeckSlide } from '@hiraia/tala-core/contracts';
import type {
  DeckDetail,
  DeckMedia,
  LessonPresentation,
  LessonSlides,
  PackLang,
  Plan,
  PlanSection,
  RouteName,
  SessionPart,
  SlidesAiFailure,
  SlidesJob,
  Template,
} from '@hiraia/tala-core/contracts';
import {
  assembleSession,
  changedSlideCount,
  deckChanges,
  deckDays,
  layoutDeck,
  layoutInputFromDeck,
  lessonDigestSource,
  lessonForSlides,
  lessonIsEmpty,
  lessonSlidesOf,
  sessionInputFromParts,
  sessionSourceFor,
  type SlideLayout,
} from '@hiraia/tala-core/decks';
import { MULTIGRADE_TEMPLATE_ID } from '@hiraia/tala-core/plan';
import { HttpError, requireUser, type BaseDeps, type Ctx, type Handler, type Services } from '../../kernel/types';
import { PPTX_CONTENT_TYPE, writeDeckPptx, type DeckDrawingBytes } from './pptx-write';
import { createLessonStore, publicJob, type LessonStore, type StoredJob, type StoredLink } from './lesson-store';
import { deckRequest, rewrittenSlide, slideIdMaker, slideRequest, toDeckSlides } from './slides-ai';
import { rowToDeck, type DeckRow, type DeckStore } from './store';

const MESSAGES = {
  planNotFound: 'We could not find this lesson.',
  session: "A multi-grade session's slides are put together from each grade's own lesson. Make or choose slides for each grade.",
  notSession: 'Only a multi-grade session has a lesson for each grade.',
  groupNotInSession: 'This grade is not part of this session.',
  sourceNotUsable: 'Choose one of your own lessons for one grade.',
  lessonHasSlides: 'This lesson already has slides made from it. Rewrite them, or remove them first to use other slides.',
  noSlides: 'This lesson has no slides yet.',
  noSuchDay: 'These slides have no such day.',
  chooseDay: "Choose which day of the week's slides is this lesson's first.",
  emptyLesson: 'Write the lesson first (its objectives and steps). Then Tala can make slides from it.',
  notRewritable: 'This slide cannot be rewritten with AI. Choose a slide with words on it.',
  jobNotFound: 'We could not find this request.',
  notReady: 'This suggestion is no longer waiting. Ask again.',
  slidesChanged: 'Your slides changed after this suggestion was made.',
  revisionNotFound: 'We could not find this earlier version.',
  deckNotFound: 'We could not find these slides.',
} as const;

/** What a failed request tells the teacher (the web shows its own words for each reason; these are the server's). */
export const FAILURE_MESSAGES: Record<SlidesAiFailure, string> = {
  disabled: 'AI help is switched off right now. Your slides are unchanged.',
  providers_unavailable: 'The AI service did not answer. Your slides are unchanged. Please try again in a moment.',
  invalid_output: 'The AI answer could not be used. Your slides are unchanged. Please try again.',
  quota_exceeded: "You have used today's AI requests. Your slides are unchanged. Please try again tomorrow.",
  budget_exceeded: "This month's AI budget is used up. Your slides are unchanged.",
  interrupted: 'Tala restarted while it was working on your slides. Nothing was changed. Please ask again.',
  gone: 'This lesson or its slides are no longer there. Nothing was changed.',
};

/** A failed request is shown for half an hour after it ended, so a reload still says what happened. */
const FAILED_VISIBLE_MS = 30 * 60_000;
const JOBS_KEPT_MS = 2 * 86_400_000;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** What the decks module (index.ts) lends this file. */
export interface LessonKit {
  storeFor(db: Ctx['db']): DeckStore;
  /** My copy of a pack's deck in a language (made now when I have none), as decks.create makes it. */
  copyOfPack(ctx: Ctx, packId: string, lang: PackLang): DeckRow;
  /** The rules a save enforces (decks.save). */
  normalise(input: DeckSlide[], media: DeckMedia[], base: DeckSlide[]): DeckSlide[];
  detail(ctx: Ctx, row: DeckRow): DeckDetail;
  /** Remove a deck and everything kept for it (decks.delete). */
  removeDeck(db: Ctx['db'], ownerId: string, deckId: string): boolean;
}

const lessonStores = new WeakMap<object, LessonStore>();
export function lessonStoreFor(db: Ctx['db']): LessonStore {
  let s = lessonStores.get(db);
  if (!s) {
    s = createLessonStore(db);
    lessonStores.set(db, s);
  }
  return s;
}
/** The runner of each database, so a new request starts at once instead of at the next tick. */
const kickers = new WeakMap<object, () => void>();

type Who = { services: Services; db: Ctx['db'] };
interface Saved {
  plan: Plan;
  sections: PlanSection[];
  template: Template | null;
}

function savedPlan(who: Who, ownerId: string, planId: string): Saved | null {
  const snap = who.services.records.planSnapshot(ownerId, planId);
  if (!snap || snap.plan.deletedAt) return null;
  const plan = snap.plan.data;
  const template = BUILTIN_TEMPLATES.find((t) => t.id === plan.templateId) ?? who.services.records.get(ownerId, 'template', plan.templateId)?.data ?? null;
  return { plan, sections: snap.sections.filter((s) => !s.deletedAt).map((s) => s.data), template };
}
const isSession = (s: Saved) => s.plan.templateId === MULTIGRADE_TEMPLATE_ID || s.template?.kind === 'multigrade';
export const lessonSha = (s: Saved) => sha256(lessonDigestSource(s.plan, s.sections, s.template));
const publicLink = (l: StoredLink) => ({ planId: l.planId, deckId: l.deckId, day: l.day, linkedAt: l.linkedAt, matchedAt: l.matchedAt });

/** A deck's slides as one lesson uses them. */
export function lessonSlides(row: DeckRow, day: number): LessonSlides {
  const deck = rowToDeck(row);
  const base = JSON.parse(row.base_slides_json) as DeckSlide[];
  const c = deckChanges(deck.slides, base);
  return {
    deckId: deck.id,
    origin: deck.origin,
    packId: deck.packId,
    language: deck.language,
    title: deck.title,
    grade: deck.grade,
    term: deck.term,
    week: deck.week,
    subject: deck.subject,
    sourceApproved: deck.sourceApproved,
    credits: deck.credits,
    slides: lessonSlidesOf(deck.slides, day),
    deckSlideCount: deck.slides.length,
    days: deckDays(deck.slides),
    media: deck.media,
    edited: c.changed + c.added + c.removed > 0 || c.reordered,
    rev: deck.rev,
    updatedAt: deck.updatedAt,
  };
}

export function createLessons(kit: LessonKit) {
  const planOr404 = (ctx: Ctx, planId: string): Saved => {
    const s = savedPlan(ctx, requireUser(ctx).id, planId);
    if (!s) throw new HttpError('not_found', MESSAGES.planNotFound, { reason: 'plan_not_found' });
    return s;
  };
  /** The lesson's link and deck, or nulls; a link whose deck is gone is dropped. */
  const linkedDeck = (db: Ctx['db'], ownerId: string, planId: string): { link: StoredLink | null; row: DeckRow | null } => {
    const ls = lessonStoreFor(db);
    const link = ls.link(ownerId, planId);
    if (!link) return { link: null, row: null };
    const row = kit.storeFor(db).get(ownerId, link.deckId);
    if (!row) {
      ls.unlink(ownerId, planId);
      return { link: null, row: null };
    }
    return { link, row };
  };

  /** Each grade's part of a session: its own lesson (her choice, else found) and that lesson's slides. */
  const sessionParts = (who: Who, ownerId: string, s: Saved): SessionPart[] => {
    const plans = who.services.records
      .list(ownerId, 'plan')
      .filter((e) => !e.deletedAt)
      .map((e) => e.data);
    const chosen = lessonStoreFor(who.db).sources(ownerId, s.plan.id);
    return s.plan.gradeGroupIds.map((groupId, i): SessionPart => {
      const grade = s.plan.grades[i] ?? s.plan.grades[0] ?? '';
      const pick = chosen.get(groupId);
      const picked = pick ? plans.find((p) => p.id === pick && p.templateId !== MULTIGRADE_TEMPLATE_ID) : undefined;
      const source = picked ?? sessionSourceFor({ session: s.plan, groupId, grade, plans });
      if (!source) return { groupId, grade, source: null, link: null, slides: null, stale: false };
      const { link, row } = linkedDeck(who.db, ownerId, source.id);
      const saved = link && row ? savedPlan(who, ownerId, source.id) : null;
      return {
        groupId,
        grade,
        source: { planId: source.id, title: source.title.slice(0, 200), chosen: picked ? 'teacher' : 'auto' },
        link: link && row ? publicLink(link) : null,
        slides: link && row ? lessonSlides(row, link.day) : null,
        stale: Boolean(link && row && saved && link.planSha256 !== lessonSha(saved)),
      };
    });
  };

  const visibleJob = (j: StoredJob | null, now: Date): SlidesJob | null => {
    if (!j) return null;
    if (j.status === 'failed' && (!j.finishedAt || now.getTime() - Date.parse(j.finishedAt) > FAILED_VISIBLE_MS)) return null;
    return publicJob(j);
  };

  const presentation = (ctx: Ctx, planId: string): LessonPresentation => {
    const user = requireUser(ctx);
    const s = planOr404(ctx, planId);
    const job = visibleJob(lessonStoreFor(ctx.db).openJob(user.id, planId), ctx.now());
    if (isSession(s)) return { planId, kind: 'session', link: null, slides: null, stale: false, parts: sessionParts(ctx, user.id, s), job };
    const { link, row } = linkedDeck(ctx.db, user.id, planId);
    return {
      planId,
      kind: 'lesson',
      link: link ? publicLink(link) : null,
      slides: link && row ? lessonSlides(row, link.day) : null,
      stale: Boolean(link && link.planSha256 !== lessonSha(s)),
      parts: [],
      job,
    };
  };

  /* ---------------- the download ---------------- */

  /** Drawing bytes for the pictures the laid-out slides show, from the owner's own decks only. */
  const drawingsFor = (db: Ctx['db'], ownerId: string, layouts: SlideLayout[], keyToDrawing: (key: string) => { deckId: string; slug: string } | null) => {
    const store = kit.storeFor(db);
    const mediaOf = new Map<string, DeckMedia[] | null>();
    const out = new Map<string, DeckDrawingBytes>();
    for (const l of layouts)
      for (const item of l.items) {
        if (item.type !== 'image' || item.source.kind !== 'drawing' || out.has(item.source.slug)) continue;
        const ref = keyToDrawing(item.source.slug);
        if (!ref) continue;
        if (!mediaOf.has(ref.deckId)) mediaOf.set(ref.deckId, store.media(ownerId, ref.deckId));
        const sha = mediaOf.get(ref.deckId)?.find((m) => m.slug === ref.slug)?.sha256;
        const stored = sha ? store.getMedia(sha) : null;
        if (stored) out.set(item.source.slug, { bytes: stored.bytes, width: stored.width, height: stored.height });
      }
    return out;
  };

  const fileName = (title: string, lang: PackLang) =>
    `tala-${
      title
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60) || 'lesson'
    }-${lang}-slides.pptx`;

  /* ---------------- AI ---------------- */

  const failWith = (ls: LessonStore, id: string, reason: SlidesAiFailure, now: Date) =>
    ls.setJob(id, ['running'], { status: 'failed', failure: { reason, message: FAILURE_MESSAGES[reason] }, finishedAt: now.toISOString() });

  const gatewayReason = (reason: string): SlidesAiFailure =>
    reason === 'disabled' || reason === 'rules_only'
      ? 'disabled'
      : reason === 'invalid_output' || reason === 'quota_exceeded' || reason === 'budget_exceeded'
        ? reason
        : 'providers_unavailable';

  /** The slides a slide-rewrite works on: the slide itself (a check with its answer slide). */
  const rewriteTarget = (slides: DeckSlide[], slideId: string): { slide: DeckSlide; reveal: DeckSlide | null } | null => {
    let slide = slides.find((s) => s.id === slideId);
    if (!slide) return null;
    if (slide.kind === 'reveal') slide = slides.find((s) => s.id === slide!.revealOf) ?? slide;
    if (slide.kind === 'cover' || slide.kind === 'day' || slide.kind === 'credits' || slide.kind === 'reveal') return null;
    const reveal = slide.kind === 'check' ? (slides.find((s) => s.kind === 'reveal' && s.revealOf === slide!.id) ?? null) : null;
    return { slide, reveal };
  };
  /** A lesson's own content slides (what "rewrite all" replaces): not the cover, day openers or credits. */
  const contentOf = (slides: DeckSlide[]) => slides.filter((s) => s.kind !== 'cover' && s.kind !== 'day' && s.kind !== 'credits');

  async function runJob(deps: BaseDeps & { services: Services }, job: StoredJob): Promise<void> {
    const ls = lessonStoreFor(deps.db);
    if (!ls.setJob(job.id, ['queued'], { status: 'running' })) return;
    try {
      const saved = savedPlan(deps, job.ownerId, job.planId);
      if (!saved) return void failWith(ls, job.id, 'gone', deps.now());
      if (!deps.config.features.generation) return void failWith(ls, job.id, 'disabled', deps.now());
      const { plan } = saved;
      const store = kit.storeFor(deps.db);
      const row = job.deckId ? store.get(job.ownerId, job.deckId) : null;
      if (job.deckId && !row) return void failWith(ls, job.id, 'gone', deps.now());
      const link = ls.link(job.ownerId, job.planId);
      const day = link && row && link.deckId === row.id ? link.day : 0;
      const ids = Object.values(plan.competencies).flat();
      const competencies = plan.curriculumVersion ? deps.services.curriculum.getCompetencies(plan.curriculumVersion, ids).map((c) => ({ code: c.code, text: c.text })) : [];
      const lesson = lessonForSlides({ plan, sections: saved.sections, template: saved.template, date: plan.placements[0]?.dates[0] ?? null, competencies });
      const versionOf = (id: string) => deps.config.llm.promptVersions[id];
      const planSha256 = lessonSha(saved);
      let proposal: NonNullable<SlidesJob['proposal']>;
      let before: DeckSlide[] | null = null;
      if (job.scope === 'new') {
        const language: PackLang = plan.language;
        const result = await deps.services.llm.complete(
          deckRequest({ language, lesson, pictures: [], current: [], instruction: job.instruction, attempt: job.id }, { userId: job.ownerId, version: versionOf('slides/deck') })
        );
        if (!result.ok) return void failWith(ls, job.id, gatewayReason(result.reason), deps.now());
        const newId = slideIdMaker([]);
        const coverId = newId();
        const cover: DeckSlide = {
          id: coverId, day: 0, kind: 'cover', title: (plan.title.trim() || plan.subjectName.trim() || lesson.subject).slice(0, DECK_LIMITS.title), lines: [], choices: [],
          revealOf: null, correctChoice: null, image: null, notes: '', sourceId: coverId,
        };
        proposal = { language, slides: [cover, ...toDeckSlides(result.data.slides, { day: 0, media: [], newId, original: true })], replaces: [] };
      } else {
        const deck = rowToDeck(row!);
        const mine = lessonSlidesOf(deck.slides, day);
        if (job.scope === 'lesson') {
          const current = contentOf(mine);
          const result = await deps.services.llm.complete(
            deckRequest({ language: deck.language, lesson, pictures: deck.media, current, instruction: job.instruction, attempt: job.id }, { userId: job.ownerId, version: versionOf('slides/deck') })
          );
          if (!result.ok) return void failWith(ls, job.id, gatewayReason(result.reason), deps.now());
          const newId = slideIdMaker(deck.slides.map((s) => s.id));
          proposal = {
            language: deck.language,
            slides: toDeckSlides(result.data.slides, { day, media: deck.media, newId, original: deck.origin === 'lesson' }),
            replaces: current.map((s) => s.id),
          };
          before = current;
        } else {
          const target = rewriteTarget(mine, job.slideId ?? '');
          if (!target) return void failWith(ls, job.id, 'gone', deps.now());
          const around = mine.filter((s) => s.kind !== 'reveal');
          const k = around.findIndex((s) => s.id === target.slide.id);
          const result = await deps.services.llm.complete(
            slideRequest(
              {
                language: deck.language, lesson, pictures: deck.media, slide: target.slide, reveal: target.reveal,
                before: around[k - 1] ?? null, after: around[k + 1] ?? null, instruction: job.instruction, attempt: job.id,
              },
              { userId: job.ownerId, version: versionOf('slides/slide') }
            )
          );
          if (!result.ok) return void failWith(ls, job.id, gatewayReason(result.reason), deps.now());
          const replaced = rewrittenSlide(target.slide, target.reveal, result.data.slide, deck.media);
          proposal = { language: deck.language, slides: replaced, replaces: replaced.map((s) => s.id) };
          before = [target.slide, ...(target.reveal ? [target.reveal] : [])];
        }
      }
      // The proposal must be slides a save would take as they are; an empty one is no proposal.
      const checked = z.array(DeckSlide).min(1).max(DECK_LIMITS.slides).safeParse(proposal.slides);
      if (!checked.success || !proposal.slides.some((s) => s.kind !== 'cover' && (s.title.trim() || s.lines.length)))
        return void failWith(ls, job.id, 'invalid_output', deps.now());
      ls.setJob(job.id, ['running'], { status: 'ready', proposal: { ...proposal, slides: checked.data }, before, planSha256, finishedAt: deps.now().toISOString() });
      deps.log.info('slides_ai_ready', { jobId: job.id, scope: job.scope, slides: proposal.slides.length });
    } catch (err) {
      deps.log.error('slides_ai_failed', { jobId: job.id, scope: job.scope, error: err instanceof Error ? err.name : 'unknown' });
      failWith(ls, job.id, 'providers_unavailable', deps.now());
    }
  }

  /** Put the proposal into the deck (or make the lesson's deck), keeping the deck as it was first. */
  const apply = (ctx: Ctx, job: StoredJob, force: boolean) => {
    const user = requireUser(ctx);
    const store = kit.storeFor(ctx.db);
    const ls = lessonStoreFor(ctx.db);
    const now = ctx.now().toISOString();
    const proposal = job.proposal!;
    const saved = planOr404(ctx, job.planId);
    if (job.scope === 'new') {
      const { row: existing } = linkedDeck(ctx.db, user.id, job.planId);
      if (existing) throw new HttpError('conflict', MESSAGES.lessonHasSlides, { reason: 'lesson_has_slides' });
      const id = ctx.newId();
      const plan = saved.plan;
      ctx.db.transaction(() => {
        store.insert({
          id,
          ownerId: user.id,
          packId: '',
          language: proposal.language,
          seed: {
            title: (plan.title.trim() || plan.subjectName.trim() || 'Slides').slice(0, DECK_LIMITS.deckTitle),
            grade: plan.grades[0] ?? '',
            term: 0,
            week: 0,
            sourceApproved: false,
            baseContentSha256: job.planSha256 ?? lessonSha(saved),
            credits: { reviewer: null, sourcesLine: '' },
            // The slides as made are the deck's own originals (its "as made" base), so later edits show as changes.
            slides: kit.normalise(proposal.slides, [], proposal.slides),
            media: [],
          },
          now,
          lesson: { subject: plan.subjectName.trim().slice(0, 120), planId: plan.id },
        });
        ls.putLink({ ownerId: user.id, planId: job.planId, deckId: id, day: 0, planSha256: job.planSha256 ?? lessonSha(saved), now });
        if (!ls.setJob(job.id, ['ready'], { status: 'applied', finishedAt: now })) throw new HttpError('conflict', MESSAGES.notReady, { reason: 'not_ready' });
      })();
      ctx.log.info('slides_ai_applied', { jobId: job.id, scope: job.scope, deckId: id });
      return;
    }
    const row = job.deckId ? store.get(user.id, job.deckId) : null;
    if (!row) throw new HttpError('not_found', MESSAGES.deckNotFound, { reason: 'deck_not_found' });
    const deck = rowToDeck(row);
    const base = JSON.parse(row.base_slides_json) as DeckSlide[];
    const replaced = new Set(proposal.replaces);
    if (!force) {
      // Only the slides the proposal replaces must be as they were: other changes (autosave of another slide) are fine.
      const nowById = new Map(deck.slides.map((s) => [s.id, s]));
      const same = (job.before ?? []).every((b) => JSON.stringify(nowById.get(b.id) ?? null) === JSON.stringify(b));
      const link = ls.link(user.id, job.planId);
      const lessonNow = job.scope === 'lesson' ? contentOf(lessonSlidesOf(deck.slides, link?.deckId === deck.id ? link.day : 0)).map((s) => s.id) : null;
      const sameSet = !lessonNow || (lessonNow.length === replaced.size && lessonNow.every((id) => replaced.has(id)));
      if (!same || !sameSet) throw new HttpError('conflict', MESSAGES.slidesChanged, { reason: 'slides_changed' });
    }
    let next: DeckSlide[];
    if (job.scope === 'slide') {
      const byId = new Map(proposal.slides.map((s) => [s.id, s]));
      if (!proposal.slides.every((s) => deck.slides.some((d) => d.id === s.id))) throw new HttpError('conflict', MESSAGES.slidesChanged, { reason: 'slides_changed' });
      next = deck.slides.map((s) => byId.get(s.id) ?? s);
    } else {
      const first = deck.slides.findIndex((s) => replaced.has(s.id));
      const kept = deck.slides.filter((s) => !replaced.has(s.id));
      // Where the lesson's slides were; else after its day opener; else before the credits.
      let at = first >= 0 ? deck.slides.slice(0, first).filter((s) => !replaced.has(s.id)).length : -1;
      if (at < 0) {
        const link = ls.link(user.id, job.planId);
        const day = link?.deckId === deck.id ? link.day : 0;
        const opener = kept.findIndex((s) => s.kind === 'day' && s.day === day);
        const credits = kept.findIndex((s) => s.kind === 'credits');
        at = opener >= 0 ? opener + 1 : credits >= 0 ? credits : kept.length;
      }
      next = [...kept.slice(0, at), ...proposal.slides, ...kept.slice(at)];
    }
    if (next.length > DECK_LIMITS.slides) throw new HttpError('invalid_input', MESSAGES.notRewritable, { reason: 'too_many_slides' });
    const lessonDeck = row.origin === 'lesson' && job.scope === 'lesson';
    const slides = kit.normalise(next, deck.media, lessonDeck ? next : base);
    ctx.db.transaction(() => {
      ls.addRevision({ id: ctx.newId(), ownerId: user.id, deckId: row.id, reason: 'ai', title: row.title, slides: deck.slides, deckRev: row.rev, now });
      const ok = lessonDeck
        ? store.rebase({ ownerId: user.id, id: row.id, slides, rev: row.rev + 1, now, expectRev: row.rev })
        : store.save({ ownerId: user.id, id: row.id, title: row.title, slides, changedSlides: changedSlideCount(slides, base), rev: row.rev + 1, now, expectRev: row.rev });
      if (!ok) throw new HttpError('conflict', MESSAGES.slidesChanged, { reason: 'slides_changed' });
      // A whole lesson rewritten from the lesson: its slides now match the lesson as it was when asked.
      if (job.scope === 'lesson' && job.planSha256) ls.matched(user.id, job.planId, job.planSha256, now);
      if (!ls.setJob(job.id, ['ready'], { status: 'applied', finishedAt: now })) throw new HttpError('conflict', MESSAGES.notReady, { reason: 'not_ready' });
    })();
    ctx.log.info('slides_ai_applied', { jobId: job.id, scope: job.scope, deckId: row.id });
  };

  const handlers: { [K in RouteName]?: Handler<K> } = {
    'decks.lesson.get': (ctx, { params }) => presentation(ctx, params.planId),

    'decks.lesson.link': (ctx, { params, body }) => {
      const user = requireUser(ctx);
      const s = planOr404(ctx, params.planId);
      if (isSession(s)) throw new HttpError('invalid_input', MESSAGES.session, { reason: 'session_plan' });
      const { row: existing } = linkedDeck(ctx.db, user.id, params.planId);
      if (existing?.origin === 'lesson') throw new HttpError('conflict', MESSAGES.lessonHasSlides, { reason: 'lesson_has_slides' });
      const row = kit.copyOfPack(ctx, body.packId, body.lang);
      if (body.day && !deckDays(rowToDeck(row).slides).includes(body.day)) throw new HttpError('invalid_input', MESSAGES.noSuchDay, { reason: 'no_such_day' });
      lessonStoreFor(ctx.db).putLink({ ownerId: user.id, planId: params.planId, deckId: row.id, day: body.day, planSha256: lessonSha(s), now: ctx.now().toISOString() });
      ctx.log.info('lesson_slides_linked', { deckId: row.id, day: body.day });
      return presentation(ctx, params.planId);
    },

    'decks.lesson.unlink': (ctx, { params }) => {
      const user = requireUser(ctx);
      planOr404(ctx, params.planId);
      const { link, row } = linkedDeck(ctx.db, user.id, params.planId);
      if (!link) throw new HttpError('not_found', MESSAGES.noSlides, { reason: 'no_slides' });
      // Slides made from this lesson belong to it alone; a copy of a pack stays among my copies.
      if (row?.origin === 'lesson') kit.removeDeck(ctx.db, user.id, row.id);
      else lessonStoreFor(ctx.db).unlink(user.id, params.planId);
      return { ok: true as const };
    },

    'decks.lesson.checked': (ctx, { params }) => {
      const user = requireUser(ctx);
      const s = planOr404(ctx, params.planId);
      const { link } = linkedDeck(ctx.db, user.id, params.planId);
      if (!link) throw new HttpError('not_found', MESSAGES.noSlides, { reason: 'no_slides' });
      lessonStoreFor(ctx.db).matched(user.id, params.planId, lessonSha(s), ctx.now().toISOString());
      return presentation(ctx, params.planId);
    },

    'decks.lesson.source': (ctx, { params, body }) => {
      const user = requireUser(ctx);
      const s = planOr404(ctx, params.planId);
      if (!isSession(s)) throw new HttpError('invalid_input', MESSAGES.notSession, { reason: 'not_session' });
      if (!s.plan.gradeGroupIds.includes(params.groupId)) throw new HttpError('not_found', MESSAGES.groupNotInSession, { reason: 'group_not_in_session' });
      if (body.planId !== null) {
        const source = savedPlan(ctx, user.id, body.planId);
        if (!source) throw new HttpError('not_found', MESSAGES.planNotFound, { reason: 'plan_not_found' });
        if (isSession(source) || source.plan.grades.length !== 1 || source.plan.id === s.plan.id)
          throw new HttpError('invalid_input', MESSAGES.sourceNotUsable, { reason: 'source_not_usable' });
      }
      lessonStoreFor(ctx.db).setSource({ ownerId: user.id, planId: params.planId, groupId: params.groupId, sourcePlanId: body.planId, now: ctx.now().toISOString() });
      return presentation(ctx, params.planId);
    },

    'decks.lesson.pptx': (ctx, { params }) => {
      const user = requireUser(ctx);
      const s = planOr404(ctx, params.planId);
      if (isSession(s)) {
        const parts = sessionParts(ctx, user.id, s);
        const assembled = assembleSession(sessionInputFromParts({ plan: s.plan, sections: s.sections, parts }));
        const layouts = layoutDeck(assembled.layout);
        const drawings = drawingsFor(ctx.db, user.id, layouts, (key) => assembled.media[key] ?? null);
        const at = ctx.now().toISOString();
        return {
          binary: writeDeckPptx({ title: (s.plan.title.trim() || 'Multi-grade session').slice(0, 200), language: s.plan.language, slides: layouts, drawings, createdAt: at, modifiedAt: at }),
          contentType: PPTX_CONTENT_TYPE,
          filename: fileName(s.plan.title || 'session', s.plan.language),
        };
      }
      const { link, row } = linkedDeck(ctx.db, user.id, params.planId);
      if (!link || !row) throw new HttpError('not_found', MESSAGES.noSlides, { reason: 'no_slides' });
      const deck = rowToDeck(row);
      const input = layoutInputFromDeck(deck, { baseSlides: JSON.parse(row.base_slides_json) as DeckSlide[] });
      const mine = new Set(lessonSlidesOf(deck.slides, link.day).map((x) => x.id));
      const layouts = layoutDeck({ ...input, slides: input.slides.filter((x) => mine.has(x.id)) });
      const drawings = drawingsFor(ctx.db, user.id, layouts, (slug) => ({ deckId: deck.id, slug }));
      const day = link.day ? ` — ${deck.language === 'fil' ? 'Araw' : 'Day'} ${link.day}` : '';
      return {
        binary: writeDeckPptx({ title: `${deck.title}${day}`.slice(0, 200), language: deck.language, slides: layouts, drawings, createdAt: deck.createdAt, modifiedAt: deck.updatedAt }),
        contentType: PPTX_CONTENT_TYPE,
        filename: fileName(s.plan.title || deck.title, deck.language),
      };
    },

    'decks.ai.start': (ctx, { params, body }) => {
      const user = requireUser(ctx);
      const s = planOr404(ctx, params.planId);
      if (isSession(s)) throw new HttpError('invalid_input', MESSAGES.session, { reason: 'session_plan' });
      const ls = lessonStoreFor(ctx.db);
      // One request at a time per lesson: asking again while one is being worked on answers that one.
      const active = ls.activeJob(user.id, params.planId);
      if (active) return publicJob(active);
      if (!ctx.config.features.generation) throw new HttpError('unavailable', FAILURE_MESSAGES.disabled, { reason: 'disabled' });
      const { link, row } = linkedDeck(ctx.db, user.id, params.planId);
      let slideId: string | null = null;
      if (body.scope === 'new') {
        if (row) throw new HttpError('conflict', MESSAGES.lessonHasSlides, { reason: 'lesson_has_slides' });
      } else {
        if (!row || !link) throw new HttpError('not_found', MESSAGES.noSlides, { reason: 'no_slides' });
        const mine = lessonSlidesOf(rowToDeck(row).slides, link.day);
        if (body.scope === 'lesson' && row.origin === 'pack' && !link.day) throw new HttpError('invalid_input', MESSAGES.chooseDay, { reason: 'choose_day' });
        if (body.scope === 'slide') {
          const target = rewriteTarget(mine, body.slideId ?? '');
          if (!target) throw new HttpError('invalid_input', MESSAGES.notRewritable, { reason: 'slide_not_rewritable' });
          slideId = target.slide.id;
        }
      }
      const ids = Object.values(s.plan.competencies).flat();
      const competencies = s.plan.curriculumVersion ? ctx.services.curriculum.getCompetencies(s.plan.curriculumVersion, ids).map((c) => ({ code: c.code, text: c.text })) : [];
      if (lessonIsEmpty(lessonForSlides({ plan: s.plan, sections: s.sections, template: s.template, competencies })))
        throw new HttpError('invalid_input', MESSAGES.emptyLesson, { reason: 'empty_lesson' });
      const id = ctx.newId();
      const now = ctx.now().toISOString();
      ctx.db.transaction(() => {
        ls.supersede(user.id, params.planId, now);
        ls.insertJob({ id, ownerId: user.id, planId: params.planId, deckId: row?.id ?? null, scope: body.scope, slideId, instruction: body.instruction.trim(), now });
      })();
      ctx.log.info('slides_ai_requested', { jobId: id, scope: body.scope });
      kickers.get(ctx.db)?.();
      return publicJob(ls.job(user.id, params.planId, id)!);
    },

    'decks.ai.get': (ctx, { params }) => {
      const job = lessonStoreFor(ctx.db).job(requireUser(ctx).id, params.planId, params.jobId);
      if (!job) throw new HttpError('not_found', MESSAGES.jobNotFound, { reason: 'job_not_found' });
      return publicJob(job);
    },

    'decks.ai.apply': (ctx, { params, body }) => {
      const user = requireUser(ctx);
      const job = lessonStoreFor(ctx.db).job(user.id, params.planId, params.jobId);
      if (!job) throw new HttpError('not_found', MESSAGES.jobNotFound, { reason: 'job_not_found' });
      if (job.status !== 'applied') {
        if (job.status !== 'ready' || !job.proposal) throw new HttpError('conflict', MESSAGES.notReady, { reason: 'not_ready' });
        apply(ctx, job, body.force);
      }
      return presentation(ctx, params.planId);
    },

    'decks.ai.discard': (ctx, { params }) => {
      const user = requireUser(ctx);
      const ls = lessonStoreFor(ctx.db);
      const job = ls.job(user.id, params.planId, params.jobId);
      if (!job) throw new HttpError('not_found', MESSAGES.jobNotFound, { reason: 'job_not_found' });
      ls.setJob(job.id, ['queued', 'running', 'ready', 'failed'], { status: 'discarded', finishedAt: ctx.now().toISOString() });
      return publicJob(ls.job(user.id, params.planId, params.jobId)!);
    },

    'decks.revisions': (ctx, { params }) => {
      const user = requireUser(ctx);
      if (!kit.storeFor(ctx.db).media(user.id, params.deckId)) throw new HttpError('not_found', MESSAGES.deckNotFound, { reason: 'deck_not_found' });
      return { revisions: lessonStoreFor(ctx.db).revisions(user.id, params.deckId) };
    },

    'decks.restore': (ctx, { params }) => {
      const user = requireUser(ctx);
      const store = kit.storeFor(ctx.db);
      const ls = lessonStoreFor(ctx.db);
      const row = store.get(user.id, params.deckId);
      if (!row) throw new HttpError('not_found', MESSAGES.deckNotFound, { reason: 'deck_not_found' });
      const rev = ls.revision(user.id, params.deckId, params.revisionId);
      if (!rev) throw new HttpError('not_found', MESSAGES.revisionNotFound, { reason: 'revision_not_found' });
      const deck = rowToDeck(row);
      const base = JSON.parse(row.base_slides_json) as DeckSlide[];
      const slides = kit.normalise(rev.slides, deck.media, base);
      const now = ctx.now().toISOString();
      ctx.db.transaction(() => {
        // Putting a version back is undoable too: the deck as it is now becomes an earlier version first.
        ls.addRevision({ id: ctx.newId(), ownerId: user.id, deckId: row.id, reason: 'restore', title: row.title, slides: deck.slides, deckRev: row.rev, now });
        const ok = store.save({ ownerId: user.id, id: row.id, title: rev.title || row.title, slides, changedSlides: changedSlideCount(slides, base), rev: row.rev + 1, now, expectRev: row.rev });
        if (!ok) throw new HttpError('conflict', MESSAGES.slidesChanged, { reason: 'deck_changed_elsewhere' });
      })();
      ctx.log.info('deck_restored', { deckId: row.id });
      return kit.detail(ctx, store.get(user.id, row.id)!);
    },
  };

  return {
    handlers,
    /** The AI runner: one request at a time, in order; a restart says so for anything left half done. */
    start(deps: BaseDeps & { services: Services }): () => void {
      const ls = lessonStoreFor(deps.db);
      ls.interruptRunning(deps.now().toISOString(), FAILURE_MESSAGES.interrupted);
      ls.purge(new Date(deps.now().getTime() - JOBS_KEPT_MS).toISOString());
      let busy = false;
      let stopped = false;
      const tick = async () => {
        if (busy || stopped) return;
        busy = true;
        try {
          for (let job = ls.nextQueued(); job && !stopped; job = ls.nextQueued()) await runJob(deps, job);
        } catch {
          deps.log.error('slides_ai_runner_failed');
        } finally {
          busy = false;
        }
      };
      const timer = setInterval(() => void tick(), 1000);
      timer.unref?.();
      kickers.set(deps.db, () => {
        setTimeout(() => void tick(), 0);
      });
      return () => {
        stopped = true;
        clearInterval(timer);
        kickers.delete(deps.db);
      };
    },
  };
}
