import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { validateGeneratedSections, type DraftInput } from '@hiraia/tala-core/generation';
import { GeneratedSection, type GenerationJob } from '@hiraia/tala-core';
import { createTestServer } from '../src/testing';
import { generationModule } from '../src/modules/generation';
import { createLlmGateway, directProvider, llmModule, type AttemptDiagnostic, type ProviderCall } from '../src/modules/llm';
import { evaluationCases, objectivesFor } from './cases';
import { fakeCompactRaw } from './fixtures';
const live=process.argv.includes('--live');
if(live){try{const env=parseEnv(readFileSync('/home/b11/code/hiraia/.env.local','utf8'));for(const key of ['DEEPSEEK_API_KEY','DASHSCOPE_API_KEY','ALIBABACLOUD_API_KEY'])if(!process.env[key]&&env[key])process.env[key]=env[key];}catch{/* Only authorized source. */}}
const root=dirname(fileURLToPath(import.meta.url));
const rows:unknown[]=[];
let paidCalls=0,failures=0;
const filter=process.env.TALA_EVAL_CASE;
const cases=evaluationCases.filter(c=>!filter||c.id===filter);
for(const provider of (live?['qwen']:['deepseek','qwen']) as ('deepseek'|'qwen')[]) {
  if(live&&!process.env.DASHSCOPE_API_KEY&&!process.env.ALIBABACLOUD_API_KEY){console.log(JSON.stringify({provider,status:'skipped',reason:'missing_key'}));continue;}
  for(const fixture of cases){
    const input={...fixture.input,resolvedObjectives:objectivesFor(fixture.input)};
    const attempts:AttemptDiagnostic[]=[];
    const fake:ProviderCall=async p=>{if(p!==provider)throw Error('Unavailable fixture provider.');return {content:JSON.stringify(fakeCompactRaw(input)),inputTokens:100,outputTokens:200,costUsd:0,httpStatus:200,finishReason:'stop',latencyMs:1};};
    const liveCall:ProviderCall=async (p,config,prompt,signal,maxTokens)=>{
      if(p==='qwen'&&++paidCalls>40)throw Error('Evaluation call limit exceeded.');
      const reply=await directProvider(p,config,prompt,signal,maxTokens);
      if(process.env.TALA_EVAL_SHAPE==='1') {try{const raw=JSON.parse(reply.content);console.log(JSON.stringify({case:fixture.id,shape:(raw.sections??[]).map((s:Record<string,unknown>)=>({key:['objectives','materials','multigrade','assessment','reflection','procedure','content','assignment','differentiation','weekgrid'].includes(String(s.key))?s.key:'other',fields:Object.keys(s).filter(k=>['text','targets','items','groups','blocks','steps','days','content'].includes(k)),targetCount:Array.isArray(s.targets)?s.targets.length:0,groups:Array.isArray(s.groups)?s.groups.map((g:Record<string,unknown>)=>({grade:/^[1-9]$/.test(String(g.grade))?g.grade:'other',targetCount:Array.isArray(g.targets)?g.targets.length:0,itemCount:Array.isArray(g.items)?g.items.length:0})):[],minutes:Array.isArray(s.blocks)?s.blocks.map((b:Record<string,unknown>)=>b.minutes):[]}))}));}catch{/* No content logged. */}}
      return reply;
    };
    const module={...llmModule,services:(deps:Parameters<NonNullable<typeof llmModule.services>>[0])=>({llm:createLlmGateway(deps,{...(live?(process.env.TALA_EVAL_SHAPE==='1'?{call:liveCall}:{}):{call:fake}),onAttempt:event=>{attempts.push(event);if(live&&process.env.TALA_EVAL_SHAPE!=='1'&&event.provider==='qwen'&&event.attempt>0)paidCalls++;console.log(JSON.stringify({case:fixture.id,...event}));}})})};
    const t=createTestServer({modules:[module,generationModule],config:{features:{generation:true},llm:{primary:{apiKeyEnv:'TALA_EVAL_NO_PRIMARY_KEY',model:'unused',baseUrl:'https://api.deepseek.com',timeoutMs:120000,pricing:{inputUsdPerMillion:.05,outputUsdPerMillion:.4}},fallback:{apiKeyEnv:'DASHSCOPE_API_KEY',model:process.env.TALA_LLM_FALLBACK_MODEL||'qwen-flash',baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',timeoutMs:120000,pricing:{inputUsdPerMillion:.05,outputUsdPerMillion:.4}},budget:{monthlyUsd:2,alertAtUsd:1.5},quotas:{fullPerDay:50,sectionPerDay:50},cacheSeconds:0}},services:{curriculum:{getCompetencies:(_version,ids)=>ids.map(id=>({id,text:fixture.input.language==='fil'?'Ilarawan ang mga halaman.':'Describe plants.'})) as never,versionFor:()=>null}},quiet:true});
    const started=Date.now();
    try{
      const teacher=await t.registerUser();
      const created=await t.ok('generation.create',{body:fixture.input,token:teacher.token});
      let job:GenerationJob=created;
      while(job.status==='queued'||job.status==='running'){
        if(Date.now()-started>260000)throw Error('Job wait exceeded.');
        await new Promise(r=>setTimeout(r,100));
        job=await t.ok('generation.get',{params:{jobId:created.id},token:teacher.token});
      }
      const errors=job.result?validateGeneratedSections(input,job.result.sections):['generation_failed'];
      const schema=!!job.result&&job.result.sections.every(s=>GeneratedSection.safeParse(s).success);
      const validity=(pattern:RegExp)=>schema&&!errors.some(e=>pattern.test(e));
      const result={provider,case:fixture.id,mode:live?'live':'fake',status:job.status,schema,teacherFocus:validity(/unpaired|teacher|focus|Shared/i),everyGroupActive:validity(/activity/),competencyPresence:validity(/objectives|assessment/),timeBudget:validity(/minutes|budget|Transition|Weekly|weekday/),materials:validity(/materials|resources/i),issues:errors.map(e=>e==='generation_failed'?e:/minutes|budget|Transition|Weekly|weekday/.test(e)?'time_budget':/objectives|assessment/.test(e)?'competency_presence':/materials|resources/i.test(e)?'materials':'structure'),inputTokens:attempts.reduce((n,a)=>n+a.inputTokens,0),outputTokens:attempts.reduce((n,a)=>n+a.outputTokens,0),latencyMs:Date.now()-started,retried:attempts.filter(a=>a.provider===provider&&a.attempt>0).length>1,deterministicConversion:true,repair:!!job.result?.warnings.length,repairNotes:job.result?.warnings??[],costUsd:(t.db.prepare('SELECT COALESCE(SUM(cost),0) AS n FROM llm_usage').get() as {n:number}).n,passed:schema&&!errors.length};
      rows.push(result);console.log(JSON.stringify(result));
      if(!result.passed)failures++;
      if(live&&result.passed&&['g2-g4-en','three-group-fil','weekly-dll-fil'].includes(fixture.id)){mkdirSync(resolve(root,'samples'),{recursive:true});writeFileSync(resolve(root,'samples',`${fixture.id}.json`),JSON.stringify({input:fixture.input,plan:job.result,review:'Teacher quality review pending; structural checks do not establish scientific or pedagogical quality.'},null,2)+'\n');}
    }finally{t.close();}
  }
}
if(live)writeFileSync(resolve(root,'live-results.json'),JSON.stringify({model:process.env.TALA_LLM_FALLBACK_MODEL||'qwen-flash',paidCalls,results:rows},null,2)+'\n');
process.exitCode=failures?1:0;
