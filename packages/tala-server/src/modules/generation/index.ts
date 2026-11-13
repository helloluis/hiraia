import { lessonRequest } from './compact';
import { BUILTIN_TEMPLATES, type GenerationInput, type GenerationJob, type Template } from '@hiraia/tala-core';
import { validateGeneratedSections } from '@hiraia/tala-core/generation';
import { HttpError, requireUser, type BaseDeps, type Ctx, type ServerModule } from '../../kernel/types';
export const migrations = [{ id:'generation:001_jobs',sql:`CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, input TEXT NOT NULL, job TEXT NOT NULL, status TEXT NOT NULL); CREATE INDEX generation_pending ON generation_jobs(status);` }];
const controllers = new WeakMap<object,Map<string,AbortController>>();
function controls(db:object) {let value=controllers.get(db);if(!value){value=new Map();controllers.set(db,value);}return value;}
function read(ctx:Ctx,id:string) { const row=ctx.db.prepare('SELECT * FROM generation_jobs WHERE id=? AND owner_id=?').get(id,requireUser(ctx).id) as {job:string;input:string}|undefined;if(!row)throw new HttpError('not_found','Generation request not found.');return {job:JSON.parse(row.job) as GenerationJob,input:JSON.parse(row.input) as GenerationInput}; }
function save(deps:BaseDeps,job:GenerationJob) {deps.db.prepare('UPDATE generation_jobs SET job=?,status=? WHERE id=?').run(JSON.stringify(job),job.status,job.id);}
function resolveInput(ctx:Ctx,input:GenerationInput) {
  const template:Template|undefined=BUILTIN_TEMPLATES.find(t=>t.id===input.templateId) ?? ctx.services.records.get(requireUser(ctx).id,'template',input.templateId)?.data;
  if(!template)throw new HttpError('invalid_input','Choose a supported template.');
  if(input.gradeGroups.length>1 && template.kind!=='multigrade')throw new HttpError('invalid_input','Choose the multi-grade template.');
  if(input.kind==='section'&&(!input.sectionKey||!template.sections.some(s=>s.key===input.sectionKey)))throw new HttpError('invalid_input','Choose a section.');
  if(input.kind==='translate'&&!input.targetLanguage)throw new HttpError('invalid_input','Choose Filipino or English for the translation.');
  if(input.kind!=='full'&&!input.planId)throw new HttpError('invalid_input','Choose a source plan.');
  const resolvedObjectives:Record<string,string[]>={};
  for(const g of input.gradeGroups) {const ids=input.competencies[g.id]??[]; const records=input.curriculumVersion?ctx.services.curriculum.getCompetencies(input.curriculumVersion,ids):[]; if(records.length!==new Set(ids).size)throw new HttpError('invalid_input','Download the curriculum or enter your own objectives.');resolvedObjectives[g.id]=records.map(c=>`${c.id}: ${c.text}`);}
  if(!Object.values(resolvedObjectives).flat().length&&!input.customObjectives.length)throw new HttpError('invalid_input','Select competencies or enter your own objectives.');
  const snapshot=input.planId?ctx.services.records.planSnapshot(requireUser(ctx).id,input.planId):null;
  if(input.planId&&!snapshot)throw new HttpError('not_found','Source plan not found.');
  const source=snapshot?.sections.map(s=>({key:s.data.key,content:s.data.content}))??[];
  const prior=input.priorPlanId?ctx.services.records.planSnapshot(requireUser(ctx).id,input.priorPlanId):null;
  if(input.priorPlanId&&!prior)throw new HttpError('not_found','Previous plan not found.');
  return {template,resolvedObjectives,source,prior:prior?.sections.map(s=>({key:s.data.key,content:s.data.content}))??[]};
}
export async function runJob(ctx:Ctx,id:string):Promise<void> {
  const {job,input}=read(ctx,id); if(job.status!=='queued')return;
  const controller=new AbortController();controls(ctx.db).set(id,controller);
  job.status='running';save(ctx,job);
  try {
    if(!ctx.config.features.generation){job.status='failed';job.failure={reason:'disabled',message:'Generation is disabled. Use the pre-filled draft.'};return;}
    const resolved=resolveInput(ctx,input);
    const promptId=`lesson/${input.kind==='full'?(input.gradeGroups.length>1?'multigrade':resolved.template.span==='week'?'week':'single'):input.kind}`;
    const result=await ctx.services.llm.complete(lessonRequest({...input,template:resolved.template,resolvedObjectives:resolved.resolvedObjectives},{userId:requireUser(ctx).id,newId:ctx.newId,source:resolved.source,prior:resolved.prior,signal:controller.signal,version:ctx.config.llm.promptVersions[promptId]??2}));
    if(read(ctx,id).job.status==='cancelled')return;
    if(result.ok) {job.status='done';job.result={title:result.data.title,sections:result.data.sections.map(s=>({...s,gen:{provider:result.provider,model:result.model,promptId:result.promptId,promptVersion:result.promptVersion,curriculumVersion:input.curriculumVersion,at:ctx.now().toISOString()}})),provider:result.provider,model:result.model,warnings:result.data.warnings??[]};}
    else if(result.reason==='cancelled')job.status='cancelled';
    else {job.status='failed';job.failure={reason:result.reason==='rules_only'?'disabled':result.reason,message:result.message};}
  } catch {job.status='failed';job.failure={reason:'invalid_input',message:'Check your inputs. You can continue with the pre-filled draft.'};}
  finally {controls(ctx.db).delete(id);if(read(ctx,id).job.status!=='cancelled'){job.finishedAt=ctx.now().toISOString();save(ctx,job);}}
}
export const generationModule:ServerModule={name:'generation',migrations,handlers:{
  'generation.create':(ctx,{body})=> {const user=requireUser(ctx);resolveInput(ctx,body);const job:GenerationJob={id:ctx.newId(),status:'queued',kind:body.kind,planId:body.planId??null,createdAt:ctx.now().toISOString(),finishedAt:null,result:null,failure:null};ctx.db.prepare('INSERT INTO generation_jobs VALUES(?,?,?,?,?)').run(job.id,user.id,JSON.stringify(body),JSON.stringify(job),job.status);return job;},
  'generation.get':(ctx,{params})=>read(ctx,params.jobId).job,
  'generation.cancel':(ctx,{params})=>{const {job}=read(ctx,params.jobId);if(job.status==='queued'||job.status==='running'){job.status='cancelled';job.finishedAt=ctx.now().toISOString();save(ctx,job);controls(ctx.db).get(job.id)?.abort();}return job;},
  'generation.allowance':ctx=>{const user=requireUser(ctx),day=ctx.now().toISOString().slice(0,10);const used=(bucket:string)=>(ctx.db.prepare('SELECT used FROM llm_quota WHERE day=? AND user_id=? AND bucket=?').get(day,user.id,bucket) as {used:number}|undefined)?.used??0;const spent=(ctx.db.prepare('SELECT COALESCE(SUM(cost),0) AS cost FROM llm_usage WHERE month=?').get(day.slice(0,7)) as {cost:number}).cost;return {fullRemainingToday:Math.max(0,ctx.config.llm.quotas.fullPerDay-used('full')),sectionRemainingToday:Math.max(0,ctx.config.llm.quotas.sectionPerDay-used('section')),degraded:spent>=ctx.config.llm.budget.monthlyUsd};}
},start:deps=>{
  deps.db.prepare("UPDATE generation_jobs SET status='queued',job=json_set(job,'$.status','queued') WHERE status='running'").run();
  let stopped=false,busy=false;
  const tick=async()=>{if(stopped||busy)return;busy=true;try {const row=deps.db.prepare("SELECT id,owner_id FROM generation_jobs WHERE status='queued' LIMIT 1").get() as {id:string;owner_id:string}|undefined;if(row)await runJob({...deps,user:{id:row.owner_id,email:'',emailVerified:true,displayName:'',sessionId:'job'},requestId:row.id,ip:null},row.id);}catch{deps.log.error('generation.runner_failed');}finally{busy=false;}};
  const timer=setInterval(()=>{void tick();},100);timer.unref();return()=>{stopped=true;clearInterval(timer);for(const c of controls(deps.db).values())c.abort();};
}};
export default generationModule;
