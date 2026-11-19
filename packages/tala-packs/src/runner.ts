/**
 * Resumable, failure-isolated pack production, in English and Filipino.
 *
 * Per week:
 *   English  — design + teacher guide (deepseek-v4-pro, reasoning) → five days of plans, slides and notes
 *              (deepseek-flash) → review loop (qwen4-max critique ↔ deepseek-v4-pro patches) → illustration checks
 *              (qwen3-vl-plus) → final checks + verbiage → library/<id>/en
 *   Filipino — composed natively from the final English edition (guide: deepseek-v4-pro; days: deepseek-flash)
 *              → review loop (qwen4-max Filipino critique ↔ patches that may change text only) → final checks,
 *              verbiage and structure-equality with English → library/<id>/fil
 *   Render   — per language: PPTX, slide previews, teacher-guide PDF, lesson-plans PDF, manifest.
 * Every stage result is cached under build/work/<id>/ so a rerun continues where it stopped; a failure in one week is
 * recorded and the run moves on.
 *
 * Retry policy (B11 protocol): a provider error is retried once after a pause; the same error twice fails that week.
 * Three consecutive weeks failing with the same error class stop the run.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import {
  PACK_LANGS,
  PackReview,
  WeeklyPackContent,
  type PackIndex,
  type PackIndexEntry,
  type PackLang,
  type PackStatus,
  type PackVariant,
} from '@hiraia/tala-core/contracts';
import { BudgetExceeded, MODELS, Meter, ProviderError, msUntilDeepSeekOffPeak, setDeepSeekOffPeakOnly } from './llm';
import { loadInputs } from './context';
import { draftPack } from './generate';
import { CHECKER_VERSION, checkPack, checkSameStructure, slideStats } from './checks';
import { critique, recheck, revise, type Critique, type Issue, type RevisionReport } from './review';
import { checkIllustrations, type ImageStageReport } from './images';
import { composeFilipino } from './filipino';
import { checkVerbiage } from './verbiage';
import { ARTIFACTS, BUILD, LIBRARY, SOFFICE, WORK } from './paths';
import { targetTopic, type WeekTarget } from './targets';
import { renderDeck } from './render/pptx';
import { checkEditability } from './render/editability';
import { guideHtml, htmlToPdf, lessonPlansHtml, writeHtml } from './render/docs';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
/** Luis, 19 Nov 2026: Hiraia owns the drawings; decks embed them with the Hiraia watermark (render/watermark). */
export const ILLUSTRATION_LICENCE = 'Hiraia-owned illustrations (licence decision by Luis Buenaventura, 2026-11-19); embedded with the Hiraia watermark';
const now = () => new Date().toISOString();
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, v: unknown) => {
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1) + '\n');
};

export interface RunOptions {
  thorough: boolean;
  /** Critique rounds per language (each but the last followed by a revision). */
  rounds: number;
  render: boolean;
  previews: boolean;
  languages: PackLang[];
}

interface PackState {
  packId: string;
  attempts: Array<{ at: string; outcome: string; error?: string; costUsd: number }>;
  lastStatus: Partial<Record<PackLang, PackStatus>>;
}

function batchSpend(ledger: string, batch: string): number {
  if (!existsSync(ledger)) return 0;
  return readFileSync(ledger, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { batch?: string; costUsd?: number })
    .filter((r) => r.batch === batch)
    .reduce((n, r) => n + (r.costUsd ?? 0), 0);
}

function priorSpend(ledger: string): number {
  if (!existsSync(ledger)) return 0;
  return readFileSync(ledger, 'utf8')
    .split('\n')
    .filter(Boolean)
    .reduce((n, l) => n + (JSON.parse(l).costUsd ?? 0), 0);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProviderError && e.retryable) {
      await new Promise((r) => setTimeout(r, 20_000));
      return await fn(); // a second identical failure propagates and fails this week
    }
    throw e;
  }
}

interface LoopResult {
  pack: WeeklyPackContent;
  critiques: Critique[];
  revisions: RevisionReport[];
  open: Issue[];
  /** Earlier issues the critic confirmed fixed / withdrew in verification rounds. */
  verified: number;
  withdrawn: number;
}

/**
 * Round 1 is a full critique; later rounds VERIFY: the critic marks each earlier issue fixed / open / withdrawn and
 * adds only new blocker or major problems (fresh critiques every round found new polish each time and never
 * converged). An earlier issue the critic forgot to rule on stays open, so nothing is dropped silently.
 */
async function reviewLoop(meter: Meter, draft: WeeklyPackContent, t: WeekTarget, o: RunOptions, extra?: (p: WeeklyPackContent) => string[]): Promise<LoopResult> {
  let pack = draft;
  const critiques: Critique[] = [];
  const revisions: RevisionReport[] = [];
  let verified = 0;
  let withdrawn = 0;
  for (let round = 1; round <= o.rounds; round++) {
    const snapshot = pack;
    // Deterministic failures (checks, structure, hard wording limits) go to the critic as issues it must report.
    const auto = [...checkPack(snapshot, t).failures, ...(extra?.(snapshot) ?? []), ...checkVerbiage(snapshot).failures];
    let c: Critique;
    if (round === 1) {
      // The English first round reasons through the science; Filipino reads without reasoning unless --thorough.
      const thinking = o.thorough || snapshot.language === 'en';
      c = await withRetry(() => critique(meter, snapshot, t, round, auto, { thinking }));
    } else {
      const previous = critiques.at(-1)!.issues;
      const report = revisions.at(-1)!;
      const got = await withRetry(() => recheck(meter, snapshot, t, round, previous, report, auto, { thinking: o.thorough }));
      const ruled = new Map(got.previous.map((p) => [p.id, p] as const));
      const restated = new Set(got.issues.map((i) => i.id));
      const carried = previous
        .filter((i) => i.severity !== 'minor' && !restated.has(i.id) && (ruled.get(i.id)?.status ?? 'open') === 'open')
        .map((i) => {
          const note = ruled.get(i.id)?.note;
          return { ...i, problem: (note ? `Still open: ${note} (Originally: ${i.problem})` : `${i.problem} (not re-verified)`).slice(0, 1200) };
        });
      verified += got.previous.filter((p) => p.status === 'fixed').length;
      withdrawn += got.previous.filter((p) => p.status === 'withdrawn').length;
      c = { ...got, issues: [...got.issues, ...carried] };
    }
    critiques.push(c);
    if (!c.issues.some((i) => i.severity !== 'minor') || round === o.rounds) break;
    const r = await withRetry(() => revise(meter, snapshot, t, c.issues, round, { thinking: false, extraCheck: extra }));
    pack = r.pack;
    revisions.push(r.report);
  }
  const last = critiques.at(-1)!;
  return { pack, critiques, revisions, open: last.issues.filter((i) => i.severity !== 'minor'), verified, withdrawn };
}

function finalize(t: WeekTarget, pack: WeeklyPackContent, loop: LoopResult, extraFailures: string[], detail: Record<string, unknown>): { review: PackReview; status: PackStatus } {
  const fin = checkPack(pack, t, { requireIllustrationChecks: true });
  const failures = [...fin.failures, ...extraFailures];
  const { failures: _wordingFailures, ...verbiage } = checkVerbiage(pack);
  const contentText = JSON.stringify(pack, null, 1) + '\n';
  const review: PackReview = {
    packId: t.targetId,
    language: pack.language,
    contentSha256: sha(contentText),
    autoChecks: { state: failures.length ? 'fail' : 'pass', checkerVersion: CHECKER_VERSION, failures, warnings: fin.warnings, at: now() },
    modelCritique: {
      state: loop.open.length ? 'issues_open' : 'pass',
      model: MODELS.critic.model,
      rounds: loop.critiques.length,
      openIssues: loop.open.map((i) => `[${i.severity}] ${i.category} at ${i.path}: ${i.problem}`.slice(0, 600)),
      // Issues the critic itself confirmed fixed in a verification round (not merely patched).
      resolvedIssues: loop.verified,
      at: now(),
    },
    teacherReview: null,
    expertReview: null,
    verbiage,
    publication: 'draft',
    publicationBy: null,
  };
  const dir = resolve(LIBRARY, t.targetId, pack.language);
  const reviewFile = resolve(dir, 'review.json');
  if (existsSync(reviewFile)) {
    // Keep a human review already recorded for byte-identical content.
    const prev = PackReview.parse(readJson(reviewFile));
    if (prev.contentSha256 === review.contentSha256) {
      review.teacherReview = prev.teacherReview;
      review.expertReview = prev.expertReview;
      review.publication = prev.publication;
      review.publicationBy = prev.publicationBy;
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'pack.json'), contentText);
  writeJson(reviewFile, review);
  writeJson(resolve(dir, 'review-detail.json'), {
    packId: t.targetId,
    language: pack.language,
    note: 'Model critique and revision log. A model critique is not a human review.',
    critique: loop.critiques,
    revisions: loop.revisions,
    verification: { confirmedFixed: loop.verified, withdrawn: loop.withdrawn, open: loop.open.length },
    finalChecks: { failures, warnings: fin.warnings },
    verbiage,
    ...detail,
  });
  const clean = review.autoChecks.state === 'pass' && review.modelCritique.state !== 'issues_open' && verbiage.state !== 'fail';
  const status: PackStatus = clean ? (review.publication === 'approved' ? 'approved' : 'draft') : 'needs_work';
  return { review, status };
}

export async function processTarget(meter: Meter, t: WeekTarget, o: RunOptions): Promise<Partial<Record<PackLang, PackStatus>>> {
  const dir = resolve(WORK, t.targetId);
  mkdirSync(dir, { recursive: true });
  const stateFile = resolve(dir, 'state.json');
  const state: PackState = existsSync(stateFile) ? readJson(stateFile) : { packId: t.targetId, attempts: [], lastStatus: {} };
  if (typeof state.lastStatus !== 'object' || state.lastStatus === null) state.lastStatus = {};
  const spent0 = meter.byPack.get(t.targetId) ?? 0;
  const weekCost = () => Number(((meter.byPack.get(t.targetId) ?? 0) - spent0).toFixed(4));
  try {
    // ---- English ----
    const { content: draft } = await withRetry(() => draftPack(meter, t));
    writeJson(resolve(dir, 'draft.en.json'), draft);
    const enLoop = await reviewLoop(meter, draft, t, o);
    const img = await withRetry(() => checkIllustrations(meter, enLoop.pack, t));
    const en = img.pack;
    const enOut = finalize(t, en, enLoop, [], { images: img.report satisfies ImageStageReport });
    state.lastStatus.en = enOut.status;
    if (o.render) await renderPack(en, enOut.review, o.previews);

    // ---- Filipino ----
    if (o.languages.includes('fil')) {
      // A Filipino edition is derived from one English edition: once the English is rebuilt, the old Filipino files
      // must not stay on disk (or be served) beside it. If the new one fails, the week shows Filipino as failed.
      rmSync(resolve(LIBRARY, t.targetId, 'fil'), { recursive: true, force: true });
      rmSync(resolve(ARTIFACTS, t.targetId, 'fil'), { recursive: true, force: true });
      const filDraft = await withRetry(() => composeFilipino(meter, en, t));
      writeJson(resolve(dir, 'draft.fil.json'), filDraft);
      const same = (p: WeeklyPackContent) => checkSameStructure(en, p);
      const filLoop = await reviewLoop(meter, filDraft, t, o, same);
      const fil = filLoop.pack;
      const filOut = finalize(t, fil, filLoop, same(fil), {
        images: 'Same drawings and slides as the English edition; each drawing was checked against the English text of its slide.',
      });
      state.lastStatus.fil = filOut.status;
      if (o.render) await renderPack(fil, filOut.review, o.previews);
    }
    state.attempts.push({ at: now(), outcome: JSON.stringify(state.lastStatus), costUsd: weekCost() });
    writeJson(stateFile, state);
    return state.lastStatus;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.attempts.push({ at: now(), outcome: 'failed', error: msg.slice(0, 500), costUsd: weekCost() });
    for (const l of o.languages) if (!state.lastStatus[l]) state.lastStatus[l] = 'failed';
    writeJson(stateFile, state);
    if (e instanceof BudgetExceeded) throw e;
    return state.lastStatus;
  }
}

export async function renderPack(pack: WeeklyPackContent, review: PackReview, previews: boolean) {
  const out = resolve(ARTIFACTS, pack.packId, pack.language);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(resolve(out, 'previews'), { recursive: true });
  const base = `tala-g${pack.grade}-t${pack.term}-w${String(pack.week).padStart(2, '0')}-${pack.language}`;
  const pptx = resolve(out, `${base}-slides.pptx`);
  const deck = await renderDeck(pack, review, pptx);
  // Teachers edit these decks: every learner-facing word must be editable text (recorded; a failure is a builder bug).
  const editability = await checkEditability(pptx, pack);
  if (editability.state === 'fail') console.log(`${now()} ${pack.packId} ${pack.language}: deck editability FAIL — ${editability.findings.slice(0, 3).join('; ')}`);
  const slideImages: Record<string, string> = {};
  if (previews) {
    execFileSync(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', out, pptx], {
      stdio: 'pipe',
      timeout: 300_000,
      env: { ...process.env, LO_PROFILE_DIR: resolve(BUILD, 'lo-profile', `${pack.packId}-${pack.language}`) },
    });
    const pdf = resolve(out, `${base}-slides.pdf`);
    execFileSync('pdftoppm', ['-r', '96', '-png', pdf, resolve(out, 'previews', 'slide')], { stdio: 'pipe', timeout: 300_000 });
    const files = readdirSync(resolve(out, 'previews')).filter((f) => f.endsWith('.png')).sort();
    if (files.length !== pack.slides.length) throw new Error(`rendered ${files.length} slide images for ${pack.slides.length} slides`);
    for (const [i, f] of files.entries()) {
      slideImages[pack.slides[i]!.id] = resolve(out, 'previews', f);
      // Light thumbnails for the web preview (phones on paid data): 640 px wide WebP.
      await sharp(resolve(out, 'previews', f))
        .resize({ width: 640 })
        .webp({ quality: 72 })
        .toFile(resolve(out, 'previews', `thumb-${String(i + 1).padStart(2, '0')}.webp`));
    }
  }
  const label = pack.language === 'fil' ? 'Gabay ng guro' : 'Teacher guide';
  const plansLabel = pack.language === 'fil' ? 'Mga lesson plan' : 'Lesson plans';
  const guideFile = resolve(out, `${base}-teacher-guide.html`);
  writeHtml(guideFile, guideHtml(pack, review, Object.fromEntries(Object.entries(slideImages).map(([k, v]) => [k, `previews/${v.split('/').pop()}`]))));
  await htmlToPdf(guideFile, resolve(out, `${base}-teacher-guide.pdf`), `${pack.title} — ${label} · Grade ${pack.grade}, Term ${pack.term}, Week ${pack.week}`);
  const plansFile = resolve(out, `${base}-lesson-plans.html`);
  writeHtml(plansFile, lessonPlansHtml(pack, review));
  await htmlToPdf(plansFile, resolve(out, `${base}-lesson-plans.pdf`), `${pack.title} — ${plansLabel} · Grade ${pack.grade}, Term ${pack.term}, Week ${pack.week}`);
  const manifest = {
    packId: pack.packId,
    language: pack.language,
    contentSha256: review.contentSha256,
    builtAt: now(),
    renderWarnings: deck.fitWarnings,
    files: [
      { kind: 'slides', name: `${base}-slides.pptx` },
      { kind: 'guide', name: `${base}-teacher-guide.pdf` },
      { kind: 'plans', name: `${base}-lesson-plans.pdf` },
    ].map((f) => {
      const b = readFileSync(resolve(out, f.name));
      return { ...f, bytes: b.length, sha256: sha(b) };
    }),
    previews: Object.keys(slideImages).length,
    images: deck.images,
    editability,
    illustrationLicence: ILLUSTRATION_LICENCE,
  };
  writeJson(resolve(out, 'manifest.json'), manifest);
  return manifest;
}

const RANK: Record<PackStatus, number> = { approved: 4, draft: 3, needs_work: 2, failed: 1, not_built: 0 };

function variantFor(t: WeekTarget, lang: PackLang, reviewerView: boolean, state: PackState | null): PackVariant {
  const dir = resolve(LIBRARY, t.targetId, lang);
  const has = existsSync(resolve(dir, 'pack.json')) && existsSync(resolve(dir, 'review.json'));
  const review = has ? PackReview.parse(readJson(resolve(dir, 'review.json'))) : null;
  const content = has ? WeeklyPackContent.parse(readJson(resolve(dir, 'pack.json'))) : null;
  const manifestFile = resolve(ARTIFACTS, t.targetId, lang, 'manifest.json');
  const manifest = existsSync(manifestFile)
    ? readJson<{ contentSha256: string; files: Array<{ kind: 'slides' | 'guide' | 'plans'; bytes: number; sha256: string }> }>(manifestFile)
    : null;
  let status: PackStatus = 'not_built';
  if (review && content) {
    const clean = review.autoChecks.state === 'pass' && review.modelCritique.state !== 'issues_open' && review.verbiage?.state !== 'fail';
    status = review.publication === 'approved' && clean ? 'approved' : clean ? 'draft' : 'needs_work';
  } else if (state?.lastStatus?.[lang] === 'failed') status = 'failed';
  const stats = content ? slideStats(content.slides) : null;
  return {
    language: lang,
    status,
    title: content?.title ?? null,
    viewable: status === 'approved' || (reviewerView && (status === 'draft' || status === 'needs_work')),
    files: manifest && review && manifest.contentSha256 === review.contentSha256 ? manifest.files : [],
    slideCount: stats?.total ?? null,
    illustratedSlides: stats?.illustrated ?? null,
    review: review
      ? { autoChecks: review.autoChecks.state, modelCritique: review.modelCritique.state, teacherReview: Boolean(review.teacherReview), expertReview: Boolean(review.expertReview) }
      : null,
  };
}

export function buildIndex(reviewerView = true): PackIndex {
  const { targets } = loadInputs();
  const packs: PackIndexEntry[] = targets.map((t) => {
    const stateFile = resolve(WORK, t.targetId, 'state.json');
    const state = existsSync(stateFile) ? readJson<PackState>(stateFile) : null;
    const variants = { en: variantFor(t, 'en', reviewerView, state), fil: variantFor(t, 'fil', reviewerView, state) };
    const best = [variants.en, variants.fil].sort((a, b) => RANK[b.status] - RANK[a.status])[0]!;
    return {
      packId: t.targetId,
      grade: t.grade,
      term: t.term,
      week: t.week,
      topic: targetTopic(t),
      competencyIds: t.competencies.map((c) => c.id),
      status: best.status,
      viewable: variants.en.viewable || variants.fil.viewable,
      variants,
    };
  });
  const all = packs.flatMap((p) => [p.variants.en, p.variants.fil]);
  const count = (s: PackStatus) => all.filter((v) => v.status === s).length;
  return {
    curriculumVersion: 'science-bow-2026',
    libraryVersion: now().slice(0, 10),
    reviewerView,
    counts: { targets: all.length, approved: count('approved'), draft: count('draft'), needsWork: count('needs_work'), failed: count('failed'), notBuilt: count('not_built') },
    packs,
  };
}


export async function runCli(cmd: string, args: string[]) {
  const opt = (name: string, dflt?: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const flag = (name: string) => args.includes(`--${name}`);
  if (cmd === 'index') {
    const index = buildIndex(true);
    writeJson(resolve(LIBRARY, '..', 'index.json'), index);
    console.log(JSON.stringify(index.counts));
    return;
  }
  if (cmd === 'render') {
    // Re-render built packs from the library only (no model calls, no stage cache): after a renderer change.
    const ids = (opt('targets') ?? '').split(',').filter(Boolean);
    if (!ids.length) throw new Error('render needs --targets');
    for (const id of ids)
      for (const l of PACK_LANGS) {
        const dir = resolve(LIBRARY, id, l);
        if (!existsSync(resolve(dir, 'pack.json'))) continue;
        const pack = WeeklyPackContent.parse(readJson(resolve(dir, 'pack.json')));
        const review = PackReview.parse(readJson(resolve(dir, 'review.json')));
        await renderPack(pack, review, !flag('no-previews'));
        console.log(`${now()} rendered ${id} ${l}`);
      }
    writeJson(resolve(LIBRARY, '..', 'index.json'), buildIndex(true));
    return;
  }
  if (cmd === 'approve') {
    const id = args[0]!;
    const lang = opt('lang') as PackLang | undefined;
    const by = opt('by');
    const role = opt('role');
    if (!lang || !(PACK_LANGS as readonly string[]).includes(lang)) throw new Error('approve needs --lang en|fil (each language is reviewed on its own).');
    if (!by || !role) throw new Error('approve needs --by "<person>" and --role "<their role>"; models cannot approve packs.');
    const file = resolve(LIBRARY, id, lang, 'review.json');
    const review = PackReview.parse(readJson(file));
    if (review.autoChecks.state !== 'pass') throw new Error('this pack has failing automatic checks; fix them before approval');
    const entry = { reviewer: by, role, verdict: 'approve' as const, notes: opt('notes', '') ?? '', at: now() };
    if (flag('expert')) review.expertReview = entry;
    else review.teacherReview = entry;
    if (flag('publish')) {
      if (!review.teacherReview) throw new Error('publication needs a recorded teacher review');
      review.publication = 'approved';
      review.publicationBy = by;
    }
    writeJson(file, review);
    writeJson(resolve(LIBRARY, '..', 'index.json'), buildIndex(true));
    console.log(`recorded ${flag('expert') ? 'expert' : 'teacher'} review by ${by} for ${id} (${lang})${flag('publish') ? ' and publication' : ''}`);
    return;
  }
  // run
  const { targets } = loadInputs();
  let selected = targets;
  const ids = opt('targets');
  const grades = opt('grades');
  if (ids) selected = targets.filter((t) => ids.split(',').includes(t.targetId));
  else if (grades) selected = targets.filter((t) => grades.split(',').includes(t.grade));
  else if (!flag('all')) throw new Error('run needs --targets, --grades or --all');
  // Optional narrowing, e.g. the term schools are about to teach: --terms 3, or --terms 2 --min-week 10.
  const terms = opt('terms');
  if (terms) selected = selected.filter((t) => terms.split(',').map(Number).includes(t.term));
  const minWeek = Number(opt('min-week', '0'));
  if (minWeek) selected = selected.filter((t) => t.week >= minWeek);
  const languages = (opt('languages', 'en,fil')!.split(',') as PackLang[]).filter((l) => (PACK_LANGS as readonly string[]).includes(l));
  if (flag('pending')) selected = selected.filter((t) => languages.some((l) => !existsSync(resolve(LIBRARY, t.targetId, l, 'pack.json'))));
  const ledger = resolve(BUILD, 'calls.jsonl');
  // A named batch has a hard cap on its own spend, summed from the ledger, so it holds across restarts:
  //   --batch priority-2026-11-19 --cap 90
  const batch = opt('batch');
  const cap = opt('cap');
  if (batch && !cap) throw new Error('--batch needs --cap <usd>');
  const meter = batch
    ? new Meter(Number(cap), ledger, batchSpend(ledger, batch), { batch })
    : new Meter(Number(opt('budget', '10')) + priorSpend(ledger), ledger, priorSpend(ledger));
  const budget = batch ? Number(cap) - meter.spentUsd : Number(opt('budget', '10'));
  const o: RunOptions = {
    thorough: flag('thorough'),
    rounds: Number(opt('rounds', '3')),
    render: !flag('no-render'),
    previews: !flag('no-previews'),
    languages,
  };
  const concurrency = Math.max(1, Number(opt('concurrency', '2')));
  const offPeak = flag('off-peak');
  if (offPeak) setDeepSeekOffPeakOnly(true);
  console.log(
    batch
      ? `run: batch ${batch}: ${selected.length} weeks × [${languages.join(', ')}], cap $${Number(cap).toFixed(2)}, batch spend so far $${meter.spentUsd.toFixed(2)}, concurrency ${concurrency}${offPeak ? ', DeepSeek off-peak only' : ''}`
      : `run: ${selected.length} weeks × [${languages.join(', ')}], budget $${budget} on top of $${meter.spentUsd.toFixed(2)} already spent, concurrency ${concurrency}${offPeak ? ', DeepSeek off-peak only' : ''}`
  );
  const results: Record<string, Partial<Record<PackLang, PackStatus>>> = {};
  let streak = { cls: '', n: 0 };
  let stop = false;
  // Workers take a whole grade-term at a time, in week order, so a multi-week topic is designed in sequence.
  const groups = new Map<string, WeekTarget[]>();
  for (const t of selected) groups.set(`${t.grade}-${t.term}`, [...(groups.get(`${t.grade}-${t.term}`) ?? []), t]);
  // Urgent first: the earliest term in the selection (e.g. Term 2 weeks 10-11) before the next, then by grade.
  const termQueue = [...groups.values()]
    .map((ws) => ws.sort((a, b) => a.week - b.week))
    .sort((a, b) => a[0]!.term - b[0]!.term || Number(a[0]!.grade) - Number(b[0]!.grade));
  let done = 0;
  const queue: WeekTarget[] = [];
  const nextTarget = (mine: WeekTarget[]) => {
    if (!mine.length) mine.push(...(termQueue.shift() ?? []));
    return mine.shift();
  };
  const worker = async () => {
    const mine: WeekTarget[] = [];
    while ((mine.length || termQueue.length) && !stop) {
      if (offPeak) {
        const wait = msUntilDeepSeekOffPeak();
        if (wait) {
          console.log(`${now()} waiting ${Math.round(wait / 60000)} min for DeepSeek off-peak pricing`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      const t = nextTarget(mine);
      if (!t) break;
      const s = await processTarget(meter, t, o).catch((e) => {
        if (e instanceof BudgetExceeded) {
          stop = true;
          console.log(`budget stop: ${e.message}`);
        }
        return { en: 'failed' } as Partial<Record<PackLang, PackStatus>>;
      });
      results[t.targetId] = s;
      const st = existsSync(resolve(WORK, t.targetId, 'state.json')) ? readJson<PackState>(resolve(WORK, t.targetId, 'state.json')) : null;
      const failed = Object.values(s).includes('failed');
      const cls = failed ? (st?.attempts.at(-1)?.error ?? 'unknown').replace(/[0-9]+/g, '#').slice(0, 60) : '';
      streak = cls && cls === streak.cls ? { cls, n: streak.n + 1 } : { cls, n: cls ? 1 : 0 };
      if (streak.n >= 3) {
        stop = true;
        console.log(`circuit breaker: three weeks in a row failed with "${cls}"; stopping for review`);
      }
      done += 1;
      const cost = st?.attempts.at(-1)?.costUsd ?? 0;
      console.log(
        `${now()} ${t.targetId} → ${JSON.stringify(s)}  week $${cost.toFixed(2)} · ${batch ? `batch $${meter.spentUsd.toFixed(2)} of $${Number(cap).toFixed(2)}` : `spent $${meter.spentUsd.toFixed(2)}`} · ${done}/${selected.length} weeks`
      );
      if (batch)
        appendFileSync(
          resolve(BUILD, `batch-${batch}.jsonl`),
          JSON.stringify({ at: now(), packId: t.targetId, status: s, weekUsd: cost, batchUsd: Number(meter.spentUsd.toFixed(4)), done, of: selected.length }) + '\n'
        );
      writeJson(resolve(LIBRARY, '..', 'index.json'), buildIndex(true));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const index = buildIndex(true);
  writeJson(resolve(LIBRARY, '..', 'index.json'), index);
  console.log('results:', JSON.stringify(results));
  console.log('library (language versions):', JSON.stringify(index.counts));
  const left = termQueue.reduce((n, g) => n + g.length, 0) + queue.length;
  if (left) console.log(`not attempted this run: ${left} weeks`);
}
