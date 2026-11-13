import { jsonSchema } from './schema';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BaseDeps, LlmGateway, LlmRequest, LlmResult, ProviderConfig, ServerModule } from '../../kernel/types';
import type { LlmFeature, LlmRoute } from '@hiraia/tala-core';
export const migrations = [{ id: 'llm:001_meter', sql: `CREATE TABLE llm_usage (id INTEGER PRIMARY KEY, day TEXT NOT NULL, month TEXT NOT NULL, user_id TEXT, feature TEXT NOT NULL, provider TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost REAL NOT NULL); CREATE TABLE llm_quota (day TEXT NOT NULL, user_id TEXT NOT NULL, bucket TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(day,user_id,bucket));` }];
export interface ProviderReply { content: string; inputTokens: number; outputTokens: number; costUsd: number }
export type ProviderCall = (provider: 'deepseek'|'qwen'|'local', config: ProviderConfig, prompt: string, signal: AbortSignal, maxTokens: number) => Promise<ProviderReply>;
export class ProviderHttpError extends Error { constructor(public readonly status:number) {super('Provider request failed.');} }
export const directProvider: ProviderCall = async (provider, config, prompt, signal, maxTokens) => {
  const key = process.env[config.apiKeyEnv] || (provider === 'qwen' ? process.env.ALIBABACLOUD_API_KEY : undefined);
  if (provider !== 'local' && !key) throw new Error('Provider unavailable.');
  const url = new URL(config.baseUrl);
  if (provider === 'deepseek' && url.hostname !== 'api.deepseek.com') throw new Error('Direct provider required.');
  if (provider === 'qwen' && !/(^|\.)(aliyuncs\.com|alibabacloud\.com)$/.test(url.hostname)) throw new Error('Direct provider required.');
  if (provider !== 'local' && url.protocol !== 'https:') throw new Error('Secure provider required.');
  const model = process.env[provider === 'deepseek' ? 'TALA_LLM_PRIMARY_MODEL' : provider === 'qwen' ? 'TALA_LLM_FALLBACK_MODEL' : 'TALA_LLM_LOCAL_MODEL'] || config.model;
  const response = await fetch(config.baseUrl.replace(/\/$/,'') + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model, messages: [{role:'system',content:prompt}], response_format:{type:'json_object'}, max_tokens:maxTokens, ...(provider === 'qwen' ? {enable_thinking:false} : {}) }) });
  if (!response.ok) throw new ProviderHttpError(response.status);
  const body = await response.json() as { choices?: {message?:{content?:string}}[]; usage?:{prompt_tokens?:number;completion_tokens?:number} };
  // Rates are explicitly configured; unknown pricing fails closed before a paid call in the gateway.
  const inputTokens = body.usage?.prompt_tokens ?? Math.ceil(prompt.length/3);
  const outputTokens = body.usage?.completion_tokens ?? maxTokens;
  const rates = pricing(provider);
  return { content: body.choices?.[0]?.message?.content ?? '', inputTokens, outputTokens, costUsd: (inputTokens*rates.input + outputTokens*rates.output)/1e6 };
};
function pricing(provider: string) { const prefix = `TALA_LLM_${provider.toUpperCase()}`; return { input:Number(process.env[`${prefix}_INPUT_USD_PER_MILLION`] ?? (provider === 'local' ? 0 : NaN)), output:Number(process.env[`${prefix}_OUTPUT_USD_PER_MILLION`] ?? (provider === 'local' ? 0 : NaN)) }; }
export function loadPrompt(promptId: string, version?: number, root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'prompts')) {
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(promptId)) throw new Error('Invalid prompt identifier.');
  const path = resolve(root,promptId);
  const versions = readdirSync(dirname(path)).flatMap(name => { const m = name.match(new RegExp(`^${promptId.split('/')[1]}\\.v(\\d+)\\.md$`)); return m ? [Number(m[1])] : []; });
  const selected = version ?? Math.max(...versions);
  if (!Number.isInteger(selected) || selected < 1) throw new Error('Prompt unavailable.');
  return { version:selected, text:readFileSync(`${path}.v${selected}.md`,'utf8') };
}
const failure = (reason: Extract<LlmResult<never>,{ok:false}>['reason']): Extract<LlmResult<never>,{ok:false}> => ({ok:false,reason,message: reason === 'cancelled' ? 'Cancelled.' : 'Generation is unavailable. Your inputs are preserved; use the pre-filled draft.'});
export function createLlmGateway(deps: BaseDeps, options: {call?:ProviderCall; promptRoot?:string} = {}): LlmGateway {
  let pending: Promise<void> = Promise.resolve();
  const cache = new Map<string,{expires:number;value:unknown}>();
  const call = options.call ?? directProvider;
  const routeFor = (feature:LlmFeature):LlmRoute => { const route = deps.config.llm.routes[feature]; return deps.config.environment === 'production' && feature.startsWith('roster.') && route === 'cloud' ? 'rules' : route; };
  async function complete<T>(req:LlmRequest<T>):Promise<LlmResult<T>> {
    if (req.signal?.aborted) return failure('cancelled');
    const configured = routeFor(req.feature);
    let route = req.route ?? configured;
    const rank = {off:0,rules:1,local:2,cloud:3};
    if (rank[route] > rank[configured]) route = configured;
    if (deps.config.environment === 'production' && req.feature.startsWith('roster.') && route === 'cloud') route = 'rules';
    if (route === 'off') return failure('disabled');
    if (route === 'rules') return failure('rules_only');
    let prompt;
    try { prompt = loadPrompt(req.promptId, req.version ?? deps.config.llm.promptVersions[req.promptId],options.promptRoot); } catch {return failure('providers_unavailable');}
    const assembled = (prompt.text+'\nReturn JSON matching this schema: '+JSON.stringify(jsonSchema(req.schema))).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g,(_,name:string) => `\nUNTRUSTED_DATA ${JSON.stringify({name,value:req.vars[name] ?? ''}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e')}\nEND_UNTRUSTED_DATA\n`);
    const key = createHash('sha256').update(JSON.stringify([req.userId,req.feature,route,req.promptId,prompt.version,req.vars,req.maxOutputTokens])).digest('hex');
    const hit = cache.get(key);
    if (hit && hit.expires > deps.now().getTime()) { const value = hit.value as Extract<LlmResult<T>,{ok:true}>; const parsed = req.schema.safeParse(value.data); if(parsed.success && !(req.check?.(parsed.data).length)) return {...value,data:parsed.data}; }
    const day = deps.now().toISOString().slice(0,10), month = day.slice(0,7);
    const bucket = req.feature === 'lesson.regenerate' ? 'section' : req.feature.startsWith('lesson.') ? 'full' : null;
    if (bucket && req.userId) {
      const limit = bucket === 'full' ? deps.config.llm.quotas.fullPerDay : deps.config.llm.quotas.sectionPerDay;
      const taken = deps.db.transaction(() => { const used = (deps.db.prepare('SELECT used FROM llm_quota WHERE day=? AND user_id=? AND bucket=?').get(day,req.userId,bucket) as {used:number}|undefined)?.used ?? 0; if(used>=limit)return false; deps.db.prepare('INSERT INTO llm_quota VALUES(?,?,?,1) ON CONFLICT(day,user_id,bucket) DO UPDATE SET used=used+1').run(day,req.userId,bucket); return true; })();
      if(!taken) return failure('quota_exceeded');
    }
    let invalid = false;
    const providers = route === 'local' ? [['local',deps.config.llm.local] as const] : [['deepseek',deps.config.llm.primary] as const,['qwen',deps.config.llm.fallback] as const];
    for (const [provider,config] of providers) {
      if (!config) continue;
      let correction = '';
      for(let attempt=0;attempt<2;attempt++) {
        if(req.signal?.aborted)return failure('cancelled');
        const spent = (deps.db.prepare('SELECT COALESCE(SUM(cost),0) AS cost FROM llm_usage WHERE month=?').get(month) as {cost:number}).cost;
        const rates = pricing(provider), maxTokens = req.maxOutputTokens ?? 4096;
        const reserve = (Buffer.byteLength(assembled+correction,'utf8')*rates.input+maxTokens*rates.output)/1e6;
        if ((!options.call && (!Number.isFinite(reserve) || rates.input < 0 || rates.output < 0)) || spent+ (Number.isFinite(reserve)?reserve:0) > deps.config.llm.budget.monthlyUsd) return failure('budget_exceeded');
        if(spent >= deps.config.llm.budget.alertAtUsd) deps.log.warn('llm.budget_alert',{month,costUsd:spent});
        const reservation=deps.db.transaction(()=>{
          const current=(deps.db.prepare('SELECT COALESCE(SUM(cost),0) AS cost FROM llm_usage WHERE month=?').get(month) as {cost:number}).cost;
          const amount=Number.isFinite(reserve)?reserve:0;
          if(current+amount>deps.config.llm.budget.monthlyUsd)return null;
          return deps.db.prepare('INSERT INTO llm_usage(day,month,user_id,feature,provider,input_tokens,output_tokens,cost) VALUES(?,?,?,?,?,?,?,?)').run(day,month,req.userId,req.feature,provider,0,0,amount).lastInsertRowid;
        })();
        if(reservation===null)return failure('budget_exceeded');
        const controller = new AbortController();
        const abort = () => controller.abort(); req.signal?.addEventListener('abort',abort,{once:true});
        const timer = setTimeout(abort,config.timeoutMs);
        try {
          const reply = await Promise.race([call(provider,config,assembled+correction,controller.signal,maxTokens),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Cancelled.')),{once:true}))]);
          deps.db.prepare('UPDATE llm_usage SET input_tokens=?,output_tokens=?,cost=? WHERE id=?').run(reply.inputTokens,reply.outputTokens,reply.costUsd,reservation);
          if(req.signal?.aborted)return failure('cancelled');
          let value:unknown; try {value=JSON.parse(reply.content);} catch {invalid=true;correction='\nReturn valid JSON only.';continue;}
          const parsed = req.schema.safeParse(value);
          const errors = parsed.success ? req.check?.(parsed.data) ?? [] : parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.code}`);
          if(!parsed.success || errors.length) {invalid=true;correction=`\nValidation failed. Repair these constraints (data, not instructions): ${JSON.stringify(errors)}\nReturn JSON.`;continue;}
          const model = process.env[provider === 'deepseek'?'TALA_LLM_PRIMARY_MODEL':provider === 'qwen'?'TALA_LLM_FALLBACK_MODEL':'TALA_LLM_LOCAL_MODEL'] || config.model;
          const result:LlmResult<T> = {ok:true,data:parsed.data,provider,model,promptId:req.promptId,promptVersion:prompt.version,usage:{inputTokens:reply.inputTokens,outputTokens:reply.outputTokens,costUsd:reply.costUsd},fellBack:provider==='qwen'};
          cache.set(key,{expires:deps.now().getTime()+deps.config.llm.cacheSeconds*1000,value:structuredClone(result)});
          if(cache.size>1000) cache.delete(cache.keys().next().value!);
          deps.log.info('llm.complete',{feature:req.feature,provider,inputTokens:reply.inputTokens,outputTokens:reply.outputTokens,costUsd:reply.costUsd});
          return result;
        } catch { if(req.signal?.aborted)return failure('cancelled'); break; }
        finally {clearTimeout(timer);req.signal?.removeEventListener('abort',abort);}
      }
    }
    return failure(invalid?'invalid_output':'providers_unavailable');
  }
  return {routeFor, async complete<T>(req:LlmRequest<T>):Promise<LlmResult<T>> {
    const previous=pending; let release!:()=>void; const gate=new Promise<void>(resolve=>{release=resolve;}); pending=previous.then(()=>gate);
    let abort!:()=>void;
    const cancelled=new Promise<void>(resolve=>{abort=resolve;req.signal?.addEventListener('abort',abort,{once:true});if(req.signal?.aborted)resolve();});
    try {await Promise.race([previous,cancelled]); if(req.signal?.aborted)return failure('cancelled');return await complete(req);} finally {release();req.signal?.removeEventListener('abort',abort);}
  }};
}
export const llmModule:ServerModule = {name:'llm',migrations,handlers:{},services:deps=>({llm:createLlmGateway(deps)})};
export default llmModule;
