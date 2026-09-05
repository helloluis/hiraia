/**
 * Question-cards feed state (v1). App-orchestrated, zero-model, same doctrine as quiz
 * mode: every card/question is pre-verified bundled data; the store is a deterministic
 * walk over the card graph.
 *
 * Flow: card → (choose deep/lateral) → flip → next card … Every 4-5 pages the chosen
 * flip is INTERCEPTED by one question page asking about a recently-read fact (75% of
 * the pool has an exact MCQ). Answering shows a single "continue" note that resumes the
 * walk onto the card the kid originally chose — their choice is honored, never dropped.
 * Counters (pages read / questions correct) persist via the settings table. The seen-set is
 * SESSION-ONLY; across restarts seen-ness lives in the SQLite seen-store as a weight, not a filter.
 * Every draw is weighted by a FeedContext (rag/pipeline/FEED-WEIGHTING.md): the student's
 * grade, the inferred curriculum quarter, and the SQLite seen-store (card + competency).
 */
import { gradeQuiz } from '../telemetry/views';
import { create } from 'zustand';
// `sanitizeCardAnswer` is the guard that trims a model-generated card, strips the prompt's
// own SAGOT:/ANSWER:/TUBAG: cue if it is echoed, and caps the card at the length
// ResponseCard is laid out for. It sits next to the prompt it cleans up after
// (@hiraia/shared prompts/cards.ts) so the web demo's card route applies the same one.
import {
  inferCurriculumQuarter,
  sanitizeCardAnswer,
  type Language,
  type SeenRecord,
} from '@hiraia/shared';

import {
  advanceCurriculum,
  cardTitle,
  cardTitleById,
  choiceLabel,
  competencyKeys,
  curriculumCursor,
  getCard,
  hasServableMagnet,
  jumpCard,
  nextChoices,
  questionForFact,
  searchCards,
  startCard,
  warmPage,
  type CardChoice,
  type CardFact,
  type CardQuestion,
  type CurriculumCursor,
  type FeedContext,
} from '../data/cards';
import { loadTokenIndex } from '../data/cardDb';
import {
  recentTopics,
  sanitizeReward,
  templateReward,
  type RewardContent,
  type ViewLogEntry,
} from '../data/reward';
import { getSetting, loadSeen, recordCardSeen, recordCompetencySeen, setSetting } from '../db/repo';
import { withModelLock } from '../engine/modelLock';
import { useEngineStore } from './engineStore';

// Trail of just-read cards. Two consumers: "ask about something the kid just saw" (quiz
// interjects) and the illustration cooldown in nextChoices (don't reuse a recent picture).
const RECENT_WINDOW = 5;
const VIEWLOG_CAP = 40; // session view-log for the reward recap (topic + timestamp)
// The weak-hit off-domain consult's deadline: past this, serve the match (never let a wedged
// embedder swallow a child's question into a void). Same budget as the web mirror's
// CLASSIFY_TIMEOUT_MS (packages/web/src/store/useCardDemoStore.ts) — keep the two in sync.
const WEAK_CONSULT_TIMEOUT_MS = 4_000;
const REWARD_PREFETCH_AT = 5; // start generating the reward text N cards before it's due
const REWARD_MIN_TOPICS = 3; // don't reward until there's something to celebrate

/**
 * A search result that isn't a straight card navigation. Three shapes:
 *   generated — a model-written fact card, grounded on the fact bank;
 *   abstain   — an in-domain GAP: science, but no page for it yet (offers the nearest topic);
 *   offdomain — not science at all ("roblox"): we say we are only a science tutor, and
 *               deliberately offer NO topic (suggesting a science card to a child who asked
 *               about a game is the behaviour this split exists to remove).
 * (A retrieval HIT navigates directly to the found card with an ActiveMagnet instead — its
 * query is the "you asked" ribbon — no FeedResponse needed.)
 */
export interface FeedResponse {
  query: string;
  kind: 'generated' | 'abstain' | 'offdomain';
  text: string | null; // generated answer (already localized)
  suggestion: string | null; // topic label of the nearest card — the abstain path only
  /**
   * The card's ILLUSTRATION, as a catalog slug — the `generated` shape only, and null far more
   * often than not. RETRIEVAL picked it (engine.answerQuery → resolveFactImage on the grounded
   * fact the card states); the model was never asked what to draw. Null is an ordinary outcome, not a
   * failure: ResponseCard then prints the card as a poster, exactly as a factoid card without
   * art does, rather than reaching for a picture that would be wrong.
   */
  slug: string | null;
}

/**
 * The ACTIVE asked-topic magnet — "You asked 'dinosaur'", holding while the feed lines the
 * topic up (see MagnetPull in data/cards.ts for the pull itself).
 *
 *   query  — what the child typed; it IS the banner copy (the banner lives exactly as long
 *            as the magnet, which is what makes the [x] and the auto-release honest).
 *   idSet  — the magnet set, computed ONCE at ask time from the search's own scoring
 *            (SearchResult.magnet). Per page-turn it is only ever LOOKED UP, never re-scored.
 *   served — how many magnet cards have been served since the ask; the pull's decay clock.
 *
 * Cleared by: the [x] (dismissQuery), auto-release (no unseen servable member left — checked
 * on each ordinary page-turn), a new ask (replaced), and the reroll (an explicit "surprise
 * me"). Quiz/reward interjects never touch it — they are interruptions, not topic changes.
 */
export interface ActiveMagnet {
  query: string;
  idSet: ReadonlySet<string>;
  served: number;
}

/**
 * CALENDAR MODE — "walk the MATATAG outline for my grade, topic by topic, exhausting each".
 * The cursor (data/cards.ts CurriculumCursor): the grade the outline was opened for, the TOPIC
 * currently held (a CG Content title, by key), the union of its competencies' card sets, and
 * its row index. Held as the store's `curriculum`, and the ribbon under the ask box shows
 * exactly while it is non-null.
 *
 * Unlike the magnet it is a FILTER, not a pull: while held, every draw is confined to `idSet`
 * (FeedContext.curriculum). Advances on each page-turn through `advanceCurriculum` — the same
 * object while the topic still has a servable card, the next non-empty topic in CG order once
 * it is exhausted, null past the end of Q4 (release). Cleared by: the ribbon's [x]
 * (exitCurriculum), that end-of-outline release, and nothing else — an ask serves its card as a
 * one-off and the walk resumes, a reroll jumps within the topic, interjects never touch it.
 * The magnet and the cursor are mutually exclusive by construction: entering either clears the
 * other, and an ask made in calendar mode forms no magnet. Session-only (v1): not persisted.
 */
export type ActiveCurriculum = CurriculumCursor;

interface CardState {
  hydrated: boolean;
  /** Current card on the pad (null until hydrate). */
  current: CardFact | null;
  choices: CardChoice[];
  /** Interject question page — when set, it replaces the card content this page. */
  question: CardQuestion | null;
  /** The choice that was intercepted by the question (resumed on continue). */
  pending: CardChoice | null;
  /** True once the interject question has been answered (gates swipe-to-continue). */
  questionAnswered: boolean;
  /** Interject REWARD page — periodic "you've learned a lot!" recap (LLM or template). */
  reward: RewardContent | null;
  /** Search RESPONSE page — a generated grounded answer or an abstention (see FeedResponse). */
  response: FeedResponse | null;
  /** True while a fallback generation is in flight (retrieval missed, model is answering). */
  asking: boolean;
  /** Card to land on when the kid continues past a generated/abstain response page. */
  responseAnchorId: string | null;
  /**
   * The asked-topic magnet. Its `query` is also the "Ang tanong mo: X" ribbon — the ribbon
   * shows exactly while a magnet is active, so dismissing one dismisses the other.
   */
  magnet: ActiveMagnet | null;
  /** Calendar mode's cursor (see ActiveCurriculum); the curriculum ribbon shows while non-null. */
  curriculum: ActiveCurriculum | null;
  /** Monotonic page number — keys the flip + typewriter remounts. */
  pageKey: number;
  pagesRead: number;
  correctCount: number;
  questionsAsked: number;
  /** Cards shown THIS SESSION — the hard "don't repeat this sitting" filter. Deliberately not
   *  persisted: across restarts the SQLite seen-store only LOWERS a card's weight (never zero). */
  seen: Set<string>;
  recent: string[]; // last few card ids (question sourcing + nextChoices' picture cooldown)
  viewLog: ViewLogEntry[]; // {factId, topic, ts} for the reward recap window
  untilQuestion: number; // pages left until the next interject question
  /**
   * Cards walked since a branch was last OFFERED. Drives the single-path-vs-fork decision
   * in nextChoices (see BRANCH_EVERY). Lives here, not in cards.ts, so the graph module
   * stays pure. Session-only — a fresh launch starts a fresh thread.
   */
  threadDepth: number;
  untilReward: number; // pages left until the next reward card (jittered)
  askedFacts: Set<string>; // don't re-ask the same fact this session
  rewardPrefetch: RewardContent | null; // pre-generated reward text, ready to show
  rewardPrefetching: boolean; // a generation is in flight

  hydrate: () => Promise<void>;
  choose: (choice: CardChoice) => void;
  answerQuestion: (correct: boolean) => void;
  continueAfterQuestion: () => void;
  continueAfterReward: () => void;
  /** Kid typed a query: retrieval-first → found card, else warm-model answer, else abstain. */
  ask: (query: string) => Promise<void>;
  /** The banner's [x]: drop the asked-topic magnet (and with it the ribbon); the feed keeps going. */
  dismissQuery: () => void;
  /**
   * Enter calendar mode at a TOPIC of the CURRENT grade's outline (the sheet's row tap, by
   * OutlineTopic.key): clears any magnet, holds the topic, and lands on its best next unseen
   * card. A key the outline does not list (no cards at this grade) is ignored.
   */
  enterCurriculum: (key: string) => void;
  /** The curriculum ribbon's [x]: leave calendar mode; the feed continues where it is. */
  exitCurriculum: () => void;
  continueAfterResponse: () => void;
  /** Kick a background model warm-up so reward text can be generated (non-blocking). */
  warmModel: () => void;
  /** "Shake to reroll" — teleport to an unrelated fresh topic (escape a deep/stale thread). */
  jumpToRandom: () => void;
}

const nextGap = () => 4 + Math.floor(Math.random() * 2); // question: every 4-5 pages
// reward: jittered 15-25 pages so it lands as a dopamine hit, never on a fixed beat.
// TODO(testing): temporarily 6-10 so the reward is reachable in a short play session —
// restore to `15 + rand(0..10)` before ship.
const nextRewardGap = () => 6 + Math.floor(Math.random() * 5);

function persist(s: { pagesRead: number; correctCount: number }) {
  void setSetting('cards.pages', String(s.pagesRead));
  void setSetting('cards.correct', String(s.correctCount));
}

/**
 * Topic labels for the reward recap, resolved from the card database at display time (the log
 * may have been written before the row was warm) and falling back to whatever was logged.
 */
function recapTopics(log: ViewLogEntry[], language: Language): string[] {
  return recentTopics(log.map((e) => ({ ...e, topic: cardTitleById(e.factId, language) || e.topic })));
}

/**
 * In-memory mirror of the SQLite seen-store (card_seen / competency_seen): loaded once at
 * hydrate, bumped as each card is shown (so in-session draws decay too) and written through
 * fire-and-forget. It is a weight-reduction memory, never a blocklist — the only hard filter is
 * the `seen` set above, which lives for one session.
 */
const seenStore: { cards: Map<string, SeenRecord>; competencies: Map<string, SeenRecord> } = {
  cards: new Map(),
  competencies: new Map(),
};

/**
 * Fresh weighting context for one draw: grade + clock are re-read every time. The magnet rides
 * along as an O(set) overlay in the weigher; the curriculum cursor as the draw's restriction.
 * Callers mid-transition pass the magnet/cursor they are ABOUT to commit (get() would hand
 * back the previous page's); the defaults read the store.
 */
function feedContext(
  magnet: ActiveMagnet | null = useCardStore.getState().magnet,
  curriculum: ActiveCurriculum | null = useCardStore.getState().curriculum
): FeedContext {
  return {
    studentGrade: useEngineStore.getState().grade,
    currentQuarter: inferCurriculumQuarter(new Date()).quarter,
    now: Date.now(),
    cardSeen: seenStore.cards,
    competencySeen: seenStore.competencies,
    magnet: magnet ? { ids: magnet.idSet, served: magnet.served } : undefined,
    curriculum: curriculum ? { ids: curriculum.idSet } : undefined,
  };
}

/** A magnet for this ask, or null when the search head-matched nothing (no set, no pull). */
function formMagnet(query: string, ids: readonly string[]): ActiveMagnet | null {
  return ids.length ? { query, idSet: new Set(ids), served: 0 } : null;
}

/**
 * The magnet after `fact` becomes current on an ORDINARY page-turn: serving one of its own
 * cards advances the decay clock, and exhaustion — no unseen member servable from the new
 * page under nextChoices' own gates — releases it (auto-release, silent). `seen`/`recent`
 * are the post-turn values, i.e. they already include `fact`.
 */
function magnetAfter(
  m: ActiveMagnet | null,
  fact: CardFact,
  seen: ReadonlySet<string>,
  recent: readonly string[]
): ActiveMagnet | null {
  if (!m) return null;
  const served = m.idSet.has(fact.id) ? m.served + 1 : m.served;
  if (!hasServableMagnet(fact.id, m.idSet, seen, recent)) return null;
  return served === m.served ? m : { ...m, served };
}

function bump(map: Map<string, SeenRecord>, key: string, now: number) {
  map.set(key, { times: (map.get(key)?.times ?? 0) + 1, lastSeen: now });
}

/** A card became current: bump its card_seen + competency_seen rows (memory, then SQLite). */
function markSeen(card: CardFact, now: number) {
  // Every code the card serves decays (a card drawn for its secondary cell must dampen THAT competency too).
  const codes = competencyKeys(card.id);
  bump(seenStore.cards, card.id, now);
  for (const code of codes) if (code !== 'off') bump(seenStore.competencies, code, now); // untagged cards are not a group
  recordCardSeen(card.id, codes[0] ?? 'off', now).catch((e) => console.warn('[cards] recordCardSeen failed', e));
  for (const code of codes.slice(1)) {
    recordCompetencySeen(code, now).catch((e) => console.warn('[cards] recordCompetencySeen failed', e));
  }
}

let hydrating: Promise<void> | null = null;

export const useCardStore = create<CardState>()((set, get) => ({
  hydrated: false,
  current: null,
  choices: [],
  question: null,
  pending: null,
  questionAnswered: false,
  reward: null,
  response: null,
  asking: false,
  responseAnchorId: null,
  magnet: null,
  curriculum: null,
  pageKey: 0,
  pagesRead: 0,
  correctCount: 0,
  questionsAsked: 0,
  seen: new Set<string>(),
  recent: [],
  viewLog: [],
  untilQuestion: nextGap(),
  untilReward: nextRewardGap(),
  threadDepth: 0,
  askedFacts: new Set<string>(),
  rewardPrefetch: null,
  rewardPrefetching: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrating) return hydrating; // re-entrant call (StrictMode double effect / remount) shares one draw
    hydrating = (async () => {
      let pagesRead = 0;
      let correctCount = 0;
      const seen = new Set<string>(); // session-only (see CardState.seen)
      try {
        pagesRead = Number((await getSetting('cards.pages')) ?? 0) || 0;
        correctCount = Number((await getSetting('cards.correct')) ?? 0) || 0;
        // Cross-session seen-ness is a WEIGHT, not a filter: loadSeen only makes a card (and
        // the competencies it serves) less likely to come up again — see FEED-WEIGHTING.md.
        const stored = await loadSeen();
        seenStore.cards = stored.cards;
        seenStore.competencies = stored.competencies;
      } catch (e) {
        console.warn('[cards] hydrate failed, starting fresh', e);
      }
      const lang = useEngineStore.getState().language ?? 'tagalog';
      const ctx = feedContext();
      const first = startCard(seen, ctx);
      seen.add(first.id);
      markSeen(first, ctx.now);
      // Token index first — it is what the duplicate check reads, so the choices have to be
      // drawn after it, not beside it.
      // Best-effort: a database that will not open must NOT stop the feed from rendering. The
      // first build of this let the rejection escape and the app never left its splash screen.
      await loadTokenIndex().catch(() => undefined);
      // Draw the choices HERE, then warm exactly them. They are what the reader can tap, so
      // they are what must be warm; re-deriving them inside warmPage would pick different
      // cards (the draw is weighted, and the weights move between calls) and the page the
      // reader actually turned to would paint with no body text.
      const choices = nextChoices(first.id, seen, lang, {
        threadDepth: 0,
        recentIds: [first.id],
        ctx,
      });
      // The card's prose lives in the database now, so it has to be here before the page
      // paints — this is the ONE await the feed has, and it covers the first card and the
      // pages it can turn to.
      await warmPage([first.id, ...choices.map((c) => c.factId)]).catch((e) =>
        console.warn('[cards] warm failed:', e)
      );
      set({
        hydrated: true,
        pagesRead,
        correctCount,
        seen,
        current: first,
        choices,
        threadDepth: 0,
        recent: [first.id],
        viewLog: [{ factId: first.id, topic: cardTitle(first, lang) || first.topic, ts: ctx.now }],
        pageKey: 1,
      });
    })().finally(() => {
      hydrating = null;
    });
    return hydrating;
  },

  choose: (choice) => {
    const s = get();
    if (s.question || s.reward || s.response) return; // an interject page is up — resolve it first

    // REWARD due? (jittered 15-25 pages, needs enough distinct topics.) Rarer than the
    // quiz, so check it first; it intercepts the flip and resumes the choice after.
    if (s.untilReward <= 1 && recentTopics(s.viewLog).length >= REWARD_MIN_TOPICS) {
      const lang = useEngineStore.getState().language ?? 'tagalog';
      const topics = recapTopics(s.viewLog, lang);
      const minutes = Math.max(
        1,
        Math.round((Date.now() - (s.viewLog[0]?.ts ?? Date.now())) / 60000)
      );
      // Use the prefetched LLM line if it's ready; else the deterministic template.
      const content = s.rewardPrefetch ?? templateReward(topics, s.pagesRead, minutes, lang);
      set({
        reward: content,
        pending: choice,
        rewardPrefetch: null,
        untilReward: nextRewardGap(),
        pageKey: s.pageKey + 1,
      });
      return;
    }

    // Interject QUESTION due? Ask about a RECENTLY-READ fact (not the one we're heading
    // to) that has an exact MCQ and wasn't asked this session. If nothing qualifies,
    // defer and retry next page.
    if (s.untilQuestion <= 1) {
      const candidates = s.recent
        .filter((id) => id !== choice.factId && !s.askedFacts.has(id))
        .map((id) => questionForFact(id))
        .filter((q): q is CardQuestion => !!q);
      const picked = candidates.length
        ? candidates[Math.floor(Math.random() * candidates.length)]!
        : null;
      if (picked) {
        set({
          question: picked,
          pending: choice,
          questionAnswered: false,
          untilQuestion: nextGap(),
          askedFacts: new Set(s.askedFacts).add(picked.f),
          questionsAsked: s.questionsAsked + 1,
          pageKey: s.pageKey + 1,
        });
        return;
      }
    }
    advance(choice, set, get);
  },

  answerQuestion: (correct) => {
    const s = get();
    if (!s.question || s.questionAnswered) return;
    gradeQuiz(s.pageKey, s.question.f, useEngineStore.getState().language || 'english', correct);
    const correctCount = s.correctCount + (correct ? 1 : 0);
    set({ correctCount, questionAnswered: true }); // enables the corner-swipe-to-continue fallback
    persist({ pagesRead: s.pagesRead, correctCount });
  },

  continueAfterQuestion: () => {
    const s = get();
    if (!s.pending) return;
    const pending = s.pending;
    set({ question: null, pending: null, questionAnswered: false });
    advance(pending, set, get);
  },

  continueAfterReward: () => {
    const s = get();
    const pending = s.pending;
    set({ reward: null, pending: null });
    if (pending) advance(pending, set, get);
  },

  ask: async (query) => {
    const q = query.trim();
    const s = get();
    if (!q || s.asking) return;
    const lang = useEngineStore.getState().language ?? 'tagalog';

    // Retrieval-first: a confident local match navigates straight to that card (instant,
    // zero-model), with a "you asked" banner. The card becomes the new feed anchor.
    // The feed context is passed so that cards which are EQUALLY about the query — same
    // coverage, same aboutness share — are separated by the same curriculum weight every draw
    // uses, rather than by pool ordinal. It never gates a result; see searchCards.
    const res = await searchCards(q, s.current?.id ?? null, feedContext());
    if (res.best) {
      // STRONG hit (the common case): the card is genuinely ABOUT a word the child typed, so it
      // is self-evidently in-domain — serve it instantly, zero-model, exactly as before.
      //
      // WEAK hit (searchCards' weak band, ~6% of gate queries): no card is really ABOUT the
      // words typed. Junk lands here ("kumusta ka" → a hand-wave card) but so do ordinary
      // in-domain phrasings whose aboutness is diluted by function words ("para saan ang
      // ating puso" → the rib-cage card that answers it) — see WEAK_ABOUT in data/cards.ts.
      // So consult the CALIBRATED off-domain gate BEFORE serving (the same judgement the miss
      // path makes, one embed + the in-RAM retrieval scan, no generation, no model lock).
      // Only weak hits pay this round-trip.
      //
      // SAFE DEGRADATION: when the gate cannot judge (embedder still downloading/warming/
      // failed → null), the probe throws, OR it fails to settle within the same ~4s budget
      // the web mirror gives its consult (useCardDemoStore CLASSIFY_TIMEOUT_MS — QVAC embed
      // stalls are a known failure mode and LocalEngine.embed has no internal deadline),
      // SERVE the match — today's behaviour. A missing model must never cost a child a card;
      // the gate can only ever swap a junk serve for the honest "I'm only a science tutor"
      // card, never swap a card for silence.
      //
      // `asking` is held for the duration of the consult so a second tap re-entering `ask`
      // (the guard above) cannot race a consult that is still in flight.
      let weakOff: boolean | null = null;
      if (res.weak) {
        const probe = useEngineStore.getState().engine;
        if (probe?.weakHitOffDomain) {
          set({ asking: true });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            weakOff = await Promise.race([
              probe.weakHitOffDomain(q),
              new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), WEAK_CONSULT_TIMEOUT_MS);
              }),
            ]);
          } catch (e) {
            console.warn('[cards] weak-hit off-domain probe failed; serving the match', e);
          } finally {
            clearTimeout(timer);
            set({ asking: false });
          }
        }
      }
      if (weakOff !== true) {
        // On-topic landing: form the magnet — the query, its aboutness-ranked set (already
        // computed by the search we just paid for), decay clock at zero. It REPLACES any
        // previous magnet: a new ask is a topic change by definition.
        // In CALENDAR MODE no magnet forms: the found card is served as a one-off and the
        // curriculum walk resumes on the next page-turn (navigateTo draws the landing card's
        // choices under the held topic).
        navigateTo(res.best, set, get, { magnet: get().curriculum ? null : formMagnet(q, res.magnet) });
        return;
      }
      // Weak hit AND off-domain: the matched card would have been a wrong answer to a
      // non-science query. Same card as the miss-path off-domain outcome below — no suggestion
      // and no anchor, for the same reason spelled out there. No magnet either (and any old
      // one is dropped): off-domain is not a topic the feed can line up.
      set({
        question: null,
        reward: null,
        magnet: null,
        response: { query: q, kind: 'offdomain', text: null, suggestion: null, slug: null },
        responseAnchorId: null,
        pageKey: get().pageKey + 1,
      });
      return;
    }

    // Miss → try the warm model for a grounded fact card; anything less is an honest miss.
    const suggestion = res.suggestion;
    const es = useEngineStore.getState();
    const engine = es.engine;
    // Set only by answerQuery, and only when the embedder was up to judge it: the query wasn't
    // science, so neither a card nor a science topic is the right answer.
    let offDomain = false;
    if (engine?.isReady() && engine.answerQuery) {
      set({ asking: true });
      try {
        // NOT wrapped in withModelLock: answerQuery takes it itself, around the generation and
        // nothing else. Retrieval and the off-domain judgement are model-free, and holding the
        // lock across them made a static sentence wait for whatever was already generating.
        const ans = await engine.answerQuery!(q, lang);
        offDomain = ans.offDomain === true;
        const clean = sanitizeCardAnswer(ans.text);
        if (ans.grounded && clean && !get().response) {
          set({
            asking: false,
            question: null,
            reward: null,
            // A GROUNDED generated card is an on-topic landing too, so it forms the magnet
            // (from the same ask-time search scoring). Often empty — a true gap head-matches
            // nothing — and then there is no magnet and no ribbon, just the response card.
            // Never in calendar mode: the answer is a one-off there (see the hit path above).
            magnet: get().curriculum ? null : formMagnet(q, res.magnet),
            response: {
              query: q,
              kind: 'generated',
              text: clean,
              suggestion: null,
              // Retrieval's pick, above the measured floor, already checked to be art this
              // device can actually draw — or null, which prints the poster.
              slug: ans.slug ?? null,
            },
            responseAnchorId: suggestion?.id ?? null,
            pageKey: get().pageKey + 1,
          });
          return;
        }
      } catch (e) {
        console.warn('[cards] answerQuery failed; abstaining', e);
      }
      set({ asking: false });
    }

    // Honest miss. In-domain gap → "no page on that yet", offering the nearest topic as a soft
    // landing. Off-domain → "I'm only a science tutor", with NO nearest topic and no anchor:
    // the continue ticket resumes the ordinary walk instead of landing on whichever science
    // card happened to sit closest to a question about a video game.
    // The card's LOCALIZED name, never `topic` — that field is an untranslated English
    // slug-phrase, so printing it raw ended every Tagalog and Cebuano gap card on an English
    // fragment ("Pero subukan natin ito: how geckos blend in with pale color"). The curated
    // title first, then the same label the feed's own choices use. Mirrored in the web demo
    // (packages/web/src/store/useCardDemoStore.ts) — keep the two in sync.
    const nearest = suggestion ? cardTitle(suggestion, lang) || choiceLabel(suggestion, lang) : null;
    set({
      question: null,
      reward: null,
      magnet: null, // a gap/offdomain outcome forms no magnet, and retires any previous one
      response: {
        query: q,
        kind: offDomain ? 'offdomain' : 'abstain',
        text: null,
        suggestion: offDomain ? null : nearest,
        // A miss is not ABOUT anything, so there is nothing to illustrate. The disc-centred
        // layout is the whole card.
        slug: null,
      },
      responseAnchorId: offDomain ? null : (suggestion?.id ?? null),
      pageKey: get().pageKey + 1,
    });
  },

  dismissQuery: () => {
    // The banner's [x]: the topic is boring them. Magnet + ribbon go together; the feed
    // continues from wherever it is — the current page and its choices stand, and the next
    // page-turn simply draws unmagnetized.
    if (get().magnet) set({ magnet: null });
  },

  enterCurriculum: (key) => {
    const s = get();
    const grade = useEngineStore.getState().grade;
    const picked = curriculumCursor(grade, key);
    if (!picked) return; // not on this grade's outline (no cards) — the sheet never offers it
    // A topic already read out this session (the sheet's chip said "0 / n") is entered the
    // way the walk would leave it: at the next topic with something left — the same
    // pre-check the die runs — rather than re-serving one of its cards under a ribbon that
    // already names the next topic. Past the end of the outline it is held as tapped; the
    // landing then releases the mode (navigateTo's exhaustion check), ribbon and all.
    const cursor = advanceCurriculum(picked, s.current?.id ?? null, s.seen) ?? picked;
    // The landing card: the topic's best next unseen card under the ordinary weigher (grade
    // band, seen-decay) — jumpCard confined to the set.
    const dest = jumpCard(s.current?.id ?? null, s.seen, feedContext(null, cursor));
    // Entering clears the magnet (mutually exclusive) and commits the cursor in the same turn.
    navigateTo(dest, set, get, { magnet: null, curriculum: cursor });
  },

  exitCurriculum: () => {
    // The curriculum ribbon's [x]: the cursor and the ribbon go together; the current page and
    // its choices stand, and the next page-turn draws unrestricted.
    if (get().curriculum) set({ curriculum: null });
  },

  continueAfterResponse: () => {
    const s = get();
    const dest = (s.responseAnchorId && getCard(s.responseAnchorId)) || null;
    set({ response: null, responseAnchorId: null });
    if (dest) {
      navigateTo(dest, set, get);
    } else {
      navigateTo(jumpCard(s.current?.id ?? null, s.seen, feedContext()), set, get);
    }
  },

  warmModel: () => {
    // Background, non-blocking: load the model so reward text can be generated. The feed
    // itself never waits on this (zero-model); if it isn't ready when a reward is due, the
    // deterministic template is used instead.
    const es = useEngineStore.getState();
    if (es.engine?.isReady() || es.isReady) return;
    const lang = es.language;
    if (lang) void es.changeLanguage(lang);
  },

  jumpToRandom: () => {
    const s = get();
    const lang = useEngineStore.getState().language ?? 'tagalog';
    // The reroll is an explicit "surprise me", so the magnet is dropped BEFORE the draw —
    // the jump itself must not be pulled back toward the topic being escaped.
    // In CALENDAR MODE it is "another card of this topic" instead: the cursor is kept, and
    // the jump is confined to the held set. If the topic has nothing servable left from the
    // current page, the cursor is moved on FIRST so the die never lands on a repeat.
    const held = s.curriculum && advanceCurriculum(s.curriculum, s.current?.id ?? null, s.seen);
    const ctx = feedContext(null, held);
    const dest = jumpCard(s.current?.id ?? null, s.seen, ctx);
    const seen = new Set(s.seen);
    seen.add(dest.id);
    markSeen(dest, ctx.now);
    // ...and the post-landing exhaustion check, exactly as an ordinary turn runs it, so the
    // choices below come from the topic that will actually be held.
    const curriculum = held && advanceCurriculum(held, dest.id, seen);
    const after = curriculum === held ? ctx : feedContext(null, curriculum);
    const pagesRead = s.pagesRead + 1;
    set({
      current: dest,
      choices: nextChoices(dest.id, seen, lang, { threadDepth: 0, recentIds: [dest.id], ctx: after }),
      threadDepth: 0, // the reroll already switched topic — start the new thread fresh
      question: null,
      pending: null,
      questionAnswered: false,
      response: null,
      magnet: null, // 🎲 = "surprise me": the asked topic is released, ribbon and all
      curriculum,
      seen,
      recent: [dest.id], // fresh trail — the jump is a hard topic switch
      pagesRead,
      untilQuestion: nextGap(), // don't interject right after a jump
      pageKey: s.pageKey + 1,
    });
    persist({ pagesRead, correctCount: s.correctCount });
  },
}));

/**
 * The choices the store WILL serve once the card underneath becomes current.
 *
 * The deck prints that card in full on the sheet behind the top one — illustration, type and
 * choice tickets — so the preview has to be drawn from the same inputs `advance` will use: the
 * same seen set, the same trail, the same thread depth and the same weighting context. Drawn
 * with defaults instead (no ctx, a one-element seen set) it names a different deep card on
 * roughly half of pages, and the label the reader had already started reading on the sheet
 * beneath would swap the instant the swipe completed.
 *
 * Only meaningful on a single-path page: a fork shows two blank coloured sheets, never a
 * printed preview, so there is nothing to agree with.
 */
export function previewChoices(language: Language): CardChoice[] {
  const s = useCardStore.getState();
  const choice = s.choices.length === 1 ? s.choices[0] : undefined;
  const next = choice ? getCard(choice.factId) : undefined;
  if (!choice || !next) return [];
  const seen = new Set(s.seen);
  seen.add(next.id);
  const recent = [...s.recent, next.id].slice(-RECENT_WINDOW);
  // The same magnet transition advance() will make — including the auto-release. Previewing
  // with the CURRENT magnet instead would name a different deep card on the page where the
  // magnet expires, and the sheet beneath would swap labels the instant the swipe completed.
  // The curriculum cursor likewise: the sheet on the page where a topic runs out must already
  // be printed from the NEXT topic's cards, because that is what the swipe will serve.
  const choices = nextChoices(next.id, seen, language, {
    threadDepth: choice.kind === 'lateral' ? 0 : s.threadDepth + 1,
    recentIds: recent,
    ctx: feedContext(
      magnetAfter(s.magnet, next, seen, recent),
      s.curriculum && advanceCurriculum(s.curriculum, next.id, seen)
    ),
  });
  // Remember the draw so advance() can ADOPT it instead of paying nextChoices (~21ms of
  // TERM_INDEX walking) again inside the swipe's critical commit — and warm the previewed
  // targets now, during reading time, so the next turn's warmAfter is a cache hit. Adoption
  // also makes the printed preview EXACTLY what the swipe serves: the deep slot was always
  // deterministic (magnetCoin), but the lateral is a weighted random draw, and recomputing
  // it in advance() could legitimately name a different card than the sheet beneath showed.
  previewCache = {
    pageKey: s.pageKey,
    factId: next.id,
    language,
    magnet: s.magnet,
    curriculum: s.curriculum,
    choices,
  };
  void warmPage(choices.map((c) => c.factId));
  return choices;
}

/**
 * The last preview, keyed on everything that could invalidate it: the page it was drawn on
 * (pageKey — every navigation bumps it, so seen/recent/threadDepth are covered), the card it
 * was drawn FOR, the language, and the magnet OBJECT (dismissQuery can null the magnet without
 * turning a page, and a preview drawn under the pull must not be served after the [x]) — and
 * the curriculum cursor OBJECT for the same reason (exitCurriculum nulls it without a turn).
 * Module-scope on purpose: it is a memo of a pure derivation, not state, and the store's
 * public API is unchanged.
 */
let previewCache: {
  pageKey: number;
  factId: string;
  language: Language;
  magnet: ActiveMagnet | null;
  curriculum: ActiveCurriculum | null;
  choices: CardChoice[];
} | null = null;

type Set_ = (partial: Partial<CardState>) => void;
type Get_ = () => CardState;

/**
 * Navigate to an explicit card (from a search hit or a response-continue). Records it like a
 * normal page turn, commits the ask's magnet when one was just formed (its query is the
 * "you asked" ribbon), and resets the interject counter so a question/reward doesn't fire on
 * the very page after a topic jump.
 */
/**
 * Warm the page that was just committed and the ones it leads to.
 *
 * Deliberately NOT awaited: the card being shown was warmed a page ago, so this is preparing
 * the NEXT turn while the reader is still on this one. A page turn therefore never waits on
 * the database.
 *
 * It warms `s.choices` — the store's OWN targets, the two cards the reader can actually tap —
 * and never lets warmPage re-derive them. The draw is weighted (grade, quarter, seen-decay)
 * and the weights move on every page, so a second `nextChoices` call would name a different
 * card; the page the reader turned to would then be cold, and `textOf` is a synchronous cache
 * read with no subscription, so it would stay blank for the whole dwell.
 */
function warmAfter(get: Get_) {
  const s = get();
  const recentFactIds = s.recent.map((id) => getCard(id)?.factId).filter((x): x is string => !!x);
  void warmPage([s.current?.id, ...s.choices.map((c) => c.factId)], recentFactIds);
}

/**
 * What a navigation commits alongside the card. `magnet` is the just-formed magnet of an ask
 * (absent = keep the store's, as a response-continue does); `curriculum` is the cursor being
 * entered (absent = keep the store's).
 */
interface NavigateOpts {
  magnet?: ActiveMagnet | null;
  curriculum?: ActiveCurriculum | null;
}

function navigateTo(fact: CardFact, set: Set_, get: Get_, opts: NavigateOpts = {}) {
  const s = get();
  const lang = useEngineStore.getState().language ?? 'tagalog';
  const seen = new Set(s.seen);
  seen.add(fact.id);
  const recent = [...s.recent, fact.id].slice(-RECENT_WINDOW);
  // The magnet override is the just-formed magnet of an ask (undefined = keep the store's, as
  // a response-continue does). Landing on one of its own cards advances the decay clock, but
  // the exhaustion check deliberately does NOT run here: a just-asked one-card topic still
  // gets its "You asked" ribbon on the very page that answered it. The release fires on the
  // next ordinary turn (advance), where an exhausted set has no pull anyway.
  const base = opts.magnet === undefined ? s.magnet : opts.magnet;
  const magnet = base && base.idSet.has(fact.id) ? { ...base, served: base.served + 1 } : base;
  // The curriculum cursor DOES run its exhaustion check here, unlike the magnet: a topic
  // entered from the sheet whose only servable card is the one just landed on has been
  // exhausted by that landing, and "attempt to exhaust, then move on" means the ribbon should
  // already name the next topic the swipe will serve. An ask's one-off landing (off-set) leaves
  // the cursor where it was unless the held topic has genuinely nothing left from here.
  const held = opts.curriculum === undefined ? s.curriculum : opts.curriculum;
  const curriculum = held && advanceCurriculum(held, fact.id, seen);
  const ctx = feedContext(magnet, curriculum);
  markSeen(fact, ctx.now);
  const viewLog = [
    ...s.viewLog,
    { factId: fact.id, topic: cardTitle(fact, lang) || fact.topic, ts: ctx.now },
  ].slice(-VIEWLOG_CAP);
  const pagesRead = s.pagesRead + 1;
  set({
    current: fact,
    choices: nextChoices(fact.id, seen, lang, { threadDepth: 0, recentIds: recent, ctx }),
    threadDepth: 0, // a search/topic jump starts a new thread
    seen,
    recent,
    viewLog,
    pagesRead,
    question: null,
    reward: null,
    response: null,
    pending: null,
    questionAnswered: false,
    magnet,
    curriculum,
    untilQuestion: nextGap(), // don't interject right after a search / topic jump
    untilReward: s.untilReward - 1,
    pageKey: s.pageKey + 1,
  });
  persist({ pagesRead, correctCount: s.correctCount });
  warmAfter(get);
}

/** Advance the walk onto the chosen card (the normal page-turn). */
function advance(choice: CardChoice, set: Set_, get: Get_) {
  const s = get();
  const nextFact = getCard(choice.factId);
  if (!nextFact) return;
  const lang = useEngineStore.getState().language ?? 'tagalog';

  const seen = new Set(s.seen);
  seen.add(nextFact.id);
  const recent = [...s.recent, nextFact.id].slice(-RECENT_WINDOW);
  // The magnet after this turn: decay clock advanced if a magnet card was just served,
  // AUTO-RELEASED (null, ribbon gone, silently) once no unseen member is servable from here.
  // The choices below are drawn with the post-turn magnet, so the pull and the release both
  // take effect on the page where they happened.
  const magnet = magnetAfter(s.magnet, nextFact, seen, recent);
  // The curriculum cursor after this turn: the same object while the held topic still has a
  // servable card from here, the next non-empty competency in CG order once it is exhausted,
  // null (released, ribbon gone) past the end of the outline — see advanceCurriculum.
  const curriculum = s.curriculum && advanceCurriculum(s.curriculum, nextFact.id, seen);
  const ctx = feedContext(magnet, curriculum);
  markSeen(nextFact, ctx.now);
  const viewLog = [
    ...s.viewLog,
    { factId: nextFact.id, topic: cardTitle(nextFact, lang) || nextFact.topic, ts: ctx.now },
  ].slice(-VIEWLOG_CAP);
  const pagesRead = s.pagesRead + 1;
  const untilReward = s.untilReward - 1;

  // Taking the lateral fork is itself a topic switch, so it restarts the thread; otherwise
  // the counter walks up until nextChoices forks, then resets on the page that offered it.
  const depth = choice.kind === 'lateral' ? 0 : s.threadDepth + 1;
  // Adopt the preview's draw when it is provably this exact turn (see previewCache): the
  // sheet beneath already printed those tickets, and this is the single biggest cost inside
  // the swipe commit. Fork picks, interject resumes, rerolls and asks all miss the key and
  // pay the ordinary compute path.
  const cached = previewCache;
  const choices =
    cached &&
    cached.pageKey === s.pageKey &&
    cached.factId === nextFact.id &&
    cached.language === lang &&
    cached.magnet === s.magnet &&
    cached.curriculum === s.curriculum
      ? cached.choices
      : nextChoices(nextFact.id, seen, lang, { threadDepth: depth, recentIds: recent, ctx });

  set({
    current: nextFact,
    choices,
    threadDepth: choices.length > 1 ? 0 : depth,
    seen,
    recent,
    viewLog,
    pagesRead,
    untilQuestion: s.untilQuestion - 1,
    untilReward,
    magnet, // persists across ordinary turns until [x] / auto-release / new ask / reroll
    curriculum, // persists across ordinary turns until [x] / end-of-outline release
    pageKey: s.pageKey + 1,
  });
  persist({ pagesRead, correctCount: s.correctCount });

  // Prefetch the LLM reward line a few cards ahead so it's fully rendered before it's due
  // (hides the on-device generation latency behind dwell time).
  if (untilReward <= REWARD_PREFETCH_AT) void prefetchReward(get, set);
  warmAfter(get);
}

/**
 * Generate the reward line in the background (once) if the model is warm. Grounded on the
 * kid's real recent topics; sanitized + fell back to a template by the caller on any doubt.
 */
async function prefetchReward(get: Get_, set: Set_) {
  const s = get();
  if (s.rewardPrefetch || s.rewardPrefetching) return;
  const es = useEngineStore.getState();
  const engine = es.engine;
  if (!engine?.isReady() || !engine.generateReward) return;
  const lang = es.language ?? 'tagalog';
  const topics = recapTopics(s.viewLog, lang);
  if (topics.length < REWARD_MIN_TOPICS) return;
  const minutes = Math.max(1, Math.round((Date.now() - (s.viewLog[0]?.ts ?? Date.now())) / 60000));

  set({ rewardPrefetching: true });
  try {
    const raw = await withModelLock(() => engine.generateReward!(topics, get().pagesRead, lang));
    const clean = sanitizeReward(raw);
    // Only accept if still un-shown and valid; otherwise the template covers it.
    if (clean && !get().reward) {
      set({
        rewardPrefetch: {
          text: clean,
          topics: topics.slice(0, 3),
          count: get().pagesRead,
          source: 'llm',
          minutes,
        },
      });
    }
  } catch (e) {
    console.warn('[cards] reward prefetch failed; template will be used', e);
  } finally {
    set({ rewardPrefetching: false });
  }
}
