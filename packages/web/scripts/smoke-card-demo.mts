/**
 * Headless smoke test for the web question-cards demo store: hydrates a session, walks 40
 * pages (answering interject questions, continuing past rewards), then exercises the ask box
 * on all FOUR of its outcomes and the reroll. Run from packages/web:
 *
 *   npx tsx scripts/smoke-card-demo.mts
 *
 * `fetch` is stubbed, so this needs no llama-server and no network: the three MISS shapes are
 * driven by a scripted /api/demo/card response. What is being smoke-tested here is the STORE's
 * handling of each shape (which card is set, whether a nearest topic and an anchor are kept),
 * not the server's classification — that lives in server/rag.ts and is the phone's own gate.
 */
import { useCardDemoStore } from '../src/store/useCardDemoStore';

const s = () => useCardDemoStore.getState();
const lang = 'english' as const;

/** Next reply /api/demo/card will give. */
let cardReply: { kind: string; text: string | null } = { kind: 'abstain', text: null };
globalThis.fetch = (async (url: string) => {
  if (String(url).includes('/api/demo/card')) {
    return new Response(JSON.stringify(cardReply), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('{}', { status: 200 }); // the transcript logger, fire-and-forget
}) as typeof fetch;

s().hydrate(lang);
console.log('hydrated →', s().current?.topic, '| choices:', s().choices.map((c) => c.label));

let questions = 0;
let rewards = 0;
let forks = 0;
for (let i = 0; i < 40; i++) {
  const st = s();
  if (st.question) {
    questions++;
    st.answerQuestion(true);
    st.continueAfterQuestion(lang);
  } else if (st.reward) {
    rewards++;
    st.continueAfterReward(lang);
  } else {
    if (st.choices.length > 1) forks++;
    const c = st.choices[i % 2 === 0 ? 0 : 1] ?? st.choices[0];
    if (!c) break;
    st.choose(c, lang);
  }
}
console.log(
  `walk: pagesRead=${s().pagesRead} questionsSeen=${questions} rewardsSeen=${rewards} ` +
    `forks=${forks} correct=${s().correctCount}`
);

// 1. search HIT → straight to a card with a "you asked" banner (never touches the server)
await s().ask('volcano', lang);
console.log('ask hit → banner:', JSON.stringify(s().queryBanner), '| card:', s().current?.topic);

// 2. miss → GENERATED fact card. The query has to be one the LOCAL search genuinely misses
// (5% of the deck is still 2,321 cards), or it navigates and never reaches the server.
cardReply = { kind: 'generated', text: 'A narwhal\u2019s tusk is a spiral tooth that can grow three metres long.' };
await s().ask('narwhal tusk', lang, 5);
console.log('generated →', s().response?.kind, '|', JSON.stringify(s().response?.text));
s().continueAfterResponse(lang);

// 3. miss → in-domain GAP: keeps the nearest topic as a soft landing
cardReply = { kind: 'abstain', text: null };
await s().ask('quantum entanglement', lang, 5);
console.log('gap →', s().response?.kind, '| suggestion:', s().response?.suggestion);
s().continueAfterResponse(lang);

// 4. miss → OFF-DOMAIN: no suggestion, no anchor (the ticket resumes the ordinary walk)
cardReply = { kind: 'offdomain', text: null };
await s().ask('roblox', lang, 5);
console.log(
  'offdomain →',
  s().response?.kind,
  '| suggestion:',
  s().response?.suggestion,
  '| anchor:',
  s().responseAnchorId
);
s().continueAfterResponse(lang);
console.log('after continue → card:', s().current?.topic);

// reroll teleports to an unrelated topic
s().jumpToRandom(lang);
console.log('reroll → card:', s().current?.topic);
