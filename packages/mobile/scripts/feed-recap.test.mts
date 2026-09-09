import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { recentTopics, templateReward } from '../src/data/reward';
import { freshReview, observeCard, reviewDue, answerReview, nextQuestion, finishReview } from '../src/reviews/logic';
const source=readFileSync(new URL('../src/store/cardStore.ts',import.meta.url),'utf8');
const start=source.indexOf('  chooseWithoutReview: (choice) => {');
const end=source.indexOf('  answerQuestion:',start);
assert.ok(start>=0 && end>start);
const gapSource=source.match(/const nextRewardGap = (.*);/)![1];
const gap=new Function(`return (${gapSource});`)();
const minTopics=Number(source.match(/const REWARD_MIN_TOPICS = (\d+)/)![1]);
const makeChoose=new Function('get','set','recentTopics','REWARD_MIN_TOPICS','useEngineStore','recapTopics','templateReward','nextRewardGap','advance',`return ({${source.slice(start,end)}}).chooseWithoutReview`);
test('encouraging recaps still interrupt a feed with single quizzes and series, with no model',()=>{
 let state:any={question:null,reward:null,response:null,untilReward:gap(),viewLog:[],pagesRead:0,rewardPrefetch:null,pageKey:0};
 let reviews=freshReview(6), serial=0, recaps=0, singles=0, batches=0;
 const choose=makeChoose(()=>state,(patch:any)=>{state={...state,...patch}},recentTopics,minTopics,{getState:()=>({language:'tagalog'})},(log:any)=>recentTopics(log),templateReward,gap,()=>{state.untilReward--;state.pagesRead++;});
 const question=(id:string):any=>({f:id,q:{tl:'Tanong'},o:[{tl:'A'},{tl:'B'}],a:1});
 for(let turn=1;turn<=80;turn++){
  state.viewLog.push({factId:String(turn),topic:`Topic ${turn}`,ts:Date.now()});
  reviews=observeCard(reviews,{id:String(turn),factId:String(turn),concept:`c${turn%4}`,topic:'Q1.0',subcategories:[]},'Plants',false,question,turn*1000,()=>String(++serial));
  if(reviewDue(reviews)){
   reviews.queue[0].kind==='single'?singles++:batches++;
   while(reviews.queue[0].position<reviews.queue[0].items.length){const a=reviews.queue[0].items[reviews.queue[0].position];reviews=nextQuestion(answerReview(reviews,a.order.indexOf(1),turn*1000));}
   reviews=finishReview(reviews);
   state.untilReward--;state.pagesRead++; // continueAfterReview advances the ordinary card
  }else{
   choose({factId:String(turn+1)});
   if(state.reward){
    recaps++;
    assert.equal(state.reward.source,'template');
    assert.match(state.reward.text,/Ang galing mo/);
    assert.equal(state.reward.topics.length,3);
    assert.ok(state.untilReward>=15&&state.untilReward<=25);
    state.reward=null;state.untilReward--;state.pagesRead++; // continueAfterReward
   }
  }
 }
 assert.ok(singles>=10);assert.equal(batches,4);assert.ok(recaps>=3);
});
