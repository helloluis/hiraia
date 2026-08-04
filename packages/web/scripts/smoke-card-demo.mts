/**
 * Headless smoke test for the web question-cards demo store: hydrates a session,
 * walks 40 pages (answering interject questions, continuing past rewards), then
 * exercises the search box (hit + miss) and the reroll. Run from packages/web:
 *
 *   npx tsx scripts/smoke-card-demo.mts
 */
import { useCardDemoStore } from '../src/store/useCardDemoStore';

const s = () => useCardDemoStore.getState();
const lang = 'english' as const;

s().hydrate(lang);
console.log('hydrated →', s().current?.topic, '| choices:', s().choices.map((c) => c.label));

let questions = 0;
let rewards = 0;
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
    const c = st.choices[i % 2 === 0 ? 0 : 1] ?? st.choices[0];
    if (!c) break;
    st.choose(c, lang);
  }
}
console.log(
  `walk: pagesRead=${s().pagesRead} questionsSeen=${questions} rewardsSeen=${rewards} correct=${s().correctCount}`
);

// search hit → straight to a card with a "you asked" banner
s().ask('volcano', lang);
console.log('ask hit → banner:', JSON.stringify(s().queryBanner), '| card:', s().current?.topic);

// search miss → spinner beat, then the abstention card with a suggestion
s().ask('quantum entanglement', lang);
console.log('asking (spinner up):', s().asking);
await new Promise((r) => setTimeout(r, 900));
console.log('miss → response:', s().response?.kind, '| suggestion:', s().response?.suggestion);
s().continueAfterResponse(lang);
console.log('after continue → card:', s().current?.topic);

// reroll teleports to an unrelated topic
s().jumpToRandom(lang);
console.log('reroll → card:', s().current?.topic);
