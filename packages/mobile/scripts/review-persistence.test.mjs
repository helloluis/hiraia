import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-review-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
let seq = 0;
const require = createRequire(import.meta.url);
async function launch() {
  const mocks = {
    '../db/repo': `export const getSetting=async k=>globalThis.reviewTest.storage.get(globalThis.reviewTest.profile+':'+k)??null;export const setSetting=async(k,v)=>{if(globalThis.reviewTest.fail)throw Error('disk full');globalThis.reviewTest.storage.set(globalThis.reviewTest.profile+':'+k,v)}`,
    '../data/cardDb': 'export const loadQuestions=async()=>{}',
    '../data/cards': `export const getCard=id=>({id,factId:id,topic:'concept'+Number(id)%4});export const competencyKeys=id=>['concept'+Number(id)%4];export const questionForFact=id=>({f:id,q:{en:'Q'},o:[{en:'A'},{en:'B'}],a:1})`,
    '../telemetry': `export const newId=()=> 'attempt_'+(++globalThis.reviewTest.id);export const telemetryPersona=()=>({profile_id:globalThis.reviewTest.profile,language:'english'});export const track=(name,props,id)=>globalThis.reviewTest.events.push({name,props,id});export const trackMany=items=>globalThis.reviewTest.events.push(...items);`,
  };
  const outfile = path.join(dir, `store-${seq++}.cjs`);
  await build({
    entryPoints: [path.resolve(import.meta.dirname, '../src/reviews/store.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'test',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            a.path in mocks ? { path: a.path, namespace: 'mock' } : null
          );
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({
            contents: mocks[a.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  return require(outfile);
}
test('real review controller resumes attempts, isolates profile/grade, and retries failed saves before grading', async () => {
  const t = (globalThis.reviewTest = {
    storage: new Map(),
    profile: 'ana',
    events: [],
    id: 0,
    fail: false,
  });
  let c = await launch();
  await c.initializeReviews(6);
  c.useReviewStore.setState({ data: { ...c.useReviewStore.getState().data, nextSingleTurn: 100 } });
  for (let i = 0; i < 20; i++)
    assert.equal(
      await c.interceptReview({
        pageKey: i,
        cardId: String(i),
        topic: 'plants',
        title: 'Plants',
        endsTopic: false,
        grade: 6,
        choice: { factId: String(i + 1), label: 'Next', kind: 'deep' },
      }),
      i === 19
    );
  const original = c.useReviewStore.getState().data.queue[0].items[0];
  let grades = 0;
  t.fail = true;
  await c.selectReviewOption(original.order.indexOf(0), () => grades++);
  assert.equal(grades, 0);
  assert.ok(c.useReviewStore.getState().error);
  t.fail = false;
  await c.retryReviewSave();
  assert.equal(grades, 1);
  assert.equal(c.useReviewStore.getState().data.reinforcement.length, 1);
  c = await launch();
  await c.initializeReviews(6);
  assert.equal(c.useReviewStore.getState().open, true);
  assert.equal(c.useReviewStore.getState().data.reinforcement.length, 1);
  let s = c.useReviewStore.getState().data;
  assert.deepEqual(s.queue[0].items[0].order, original.order);
  assert.equal(s.queue[0].items[0].selected, original.order.indexOf(0));
  await c.selectReviewOption(0, () => grades++);
  assert.equal(grades, 1);
  await c.continueReview();
  const second = c.useReviewStore.getState().data.queue[0].items[1];
  c = await launch();
  await c.initializeReviews(6);
  assert.equal(c.useReviewStore.getState().open, true);
  assert.equal(c.useReviewStore.getState().data.queue[0].position, 1);
  assert.deepEqual(c.useReviewStore.getState().data.queue[0].items[1], second);
  await c.selectReviewOption(second.order.indexOf(1), () => grades++);
  const answeredSecond = c.useReviewStore.getState().data.queue[0].items[1];
  c = await launch();
  await c.initializeReviews(6);
  assert.equal(c.useReviewStore.getState().open, true);
  assert.equal(c.useReviewStore.getState().data.queue[0].position, 1);
  assert.deepEqual(c.useReviewStore.getState().data.queue[0].items[1], answeredSecond);
  await c.continueReview();
  while ((s = c.useReviewStore.getState().data).queue[0].position < s.queue[0].items.length) {
    const a = s.queue[0].items[s.queue[0].position];
    await c.selectReviewOption(a.order.indexOf(1), () => grades++);
    await c.continueReview();
  }
  let exit = false;
  await c.leaveReview(false, () => (exit = true));
  assert.ok(exit);
  assert.equal(grades, 3);
  assert.equal(c.useReviewStore.getState().data.queue.length, 0);
  assert.equal(t.events.filter((e) => e.name === 'quiz_graded').length, 3);
  await c.acknowledgeReinforcement(original.card.id);
  assert.equal(c.useReviewStore.getState().data.reinforcement.length, 0);
  await c.initializeReviews(5);
  assert.equal(Object.keys(c.useReviewStore.getState().data.history).length, 0);
  await c.initializeReviews(6);
  assert.equal(Object.keys(c.useReviewStore.getState().data.history).length, 3);
  t.profile = 'ben';
  c = await launch();
  await c.initializeReviews(6);
  assert.equal(Object.keys(c.useReviewStore.getState().data.history).length, 0);
  t.profile = 'ana';
  c = await launch();
  await c.initializeReviews(6);
  assert.equal(Object.keys(c.useReviewStore.getState().data.history).length, 3);
  delete globalThis.reviewTest;
});

test('standalone review resumes with shuffled options and returns directly to the pending card', async () => {
  globalThis.reviewTest = { storage: new Map(), profile: 'single', events: [], id: 0, fail: false };
  let c=await launch();
  for(let i=1;i<=5;i++) await c.interceptReview({pageKey:i,cardId:String(i),topic:'plants',title:'Plants',endsTopic:false,grade:6,choice:{factId:String(i+1),label:'Next',kind:'deep'}});
  const a=c.useReviewStore.getState().data.queue[0].items[0];
  assert.equal(c.useReviewStore.getState().data.queue[0].kind,'single');
  let graded=0;
  await c.selectReviewOption(a.order.indexOf(1),()=>graded++);
  let destination;
  await c.continueReview(choice=>destination=choice);
  assert.equal(destination.factId,'6');
  assert.equal(graded,1);
  assert.equal(c.useReviewStore.getState().open,false);
  c=await launch(); await c.initializeReviews(6);
  assert.equal(c.useReviewStore.getState().data.nextSingleTurn,10);
  assert.equal(c.useReviewStore.getState().data.history[a.card.factId].attempts,1);
  assert.equal(c.useReviewStore.getState().data.queue.length,0);
});

test('existing school-year histories gain standalone cadence without losing past attempts', async () => {
  const state={version:1,grade:6,turns:37,seen:{},recent:[],topic:{key:null,title:'',cards:[]},queue:[],history:{old:{attempts:2}},notBeforeTurn:0};
  globalThis.reviewTest={storage:new Map([['old:cards.reviews.v1.6',JSON.stringify(state)]]),profile:'old',events:[],id:0,fail:false};
  const c=await launch();await c.initializeReviews(6);
  assert.equal(c.useReviewStore.getState().data.nextSingleTurn,42);
  assert.equal(c.useReviewStore.getState().data.history.old.attempts,2);
});
