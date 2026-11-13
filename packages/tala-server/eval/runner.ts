import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { BUILTIN_TEMPLATES, SectionContent } from '@hiraia/tala-core';
import { buildPrefilledDraft, validateGeneratedSections } from '@hiraia/tala-core/generation';
import { jsonSchema } from '../src/modules/llm/schema';
import { directProvider, loadPrompt, ProviderHttpError } from '../src/modules/llm';
import { evaluationCases, objectivesFor } from './cases';
const schema=z.object({title:z.string(),sections:z.array(z.object({key:z.string(),content:SectionContent}))});
const live=process.argv.includes('--live');
if(live) {
  try {const file=parseEnv(readFileSync('/home/b11/code/hiraia/.env.local','utf8'));for(const name of ['DEEPSEEK_API_KEY','DASHSCOPE_API_KEY','ALIBABACLOUD_API_KEY','TALA_LLM_PRIMARY_MODEL','TALA_LLM_FALLBACK_MODEL']) if(!process.env[name]&&file[name])process.env[name]=file[name];}catch{/* No other credential locations are searched. */}
}
let failures=0;
for(const provider of ['deepseek','qwen'] as const) {
  if(live && !(provider==='deepseek'?process.env.DEEPSEEK_API_KEY:process.env.DASHSCOPE_API_KEY||process.env.ALIBABACLOUD_API_KEY)) {console.log(JSON.stringify({provider,status:'skipped',reason:'No provider key available.'}));continue;}
  for(const c of (live?evaluationCases.slice(0,1):evaluationCases)) {
    const input={...c.input,resolvedObjectives:objectivesFor(c.input)};
    const draft=buildPrefilledDraft(input);
    // Fake provider returns a structurally valid fixture, not a scored lesson-quality claim.
    for(const s of draft.sections){
      if(s.key==='assessment')s.content=draft.sections.find(s=>s.key==='objectives')!.content.type==='pergroup'?draft.sections.find(s=>s.key==='objectives')!.content:{type:'text',blocks:[{t:'p',spans:[{text:Object.values(input.resolvedObjectives).flat().concat(input.customObjectives).join('\n')}]}]};
      if(s.content.type==='pergroup' && s.key==='materials')s.content.groups=Object.fromEntries(input.gradeGroups.map(g=>[g.id,[]]));
      if(s.content.type==='multigrade')s.content.blocks.forEach(b=>Object.values(b.groups).forEach(g=>g.activity=[{t:'p',spans:[{text:'Observe plants independently.'}]}]));
    }
    let value:unknown=draft;
    if(live) {
      const model=process.env[provider==='deepseek'?'TALA_LLM_PRIMARY_MODEL':'TALA_LLM_FALLBACK_MODEL'];
      if(!model){console.log(JSON.stringify({provider,status:'skipped',reason:'Model environment variable is not configured.'}));break;}
      const template=BUILTIN_TEMPLATES.find(t=>t.id===input.templateId)!;
      const prompt=loadPrompt('lesson/multigrade').text.replace('{{input}}',`UNTRUSTED_DATA ${JSON.stringify({...input,template})} END_UNTRUSTED_DATA`).replace('{{schema}}',JSON.stringify(template.sections))+'\nReturn JSON matching this full schema: '+JSON.stringify(jsonSchema(schema));
      try {const reply=await directProvider(provider,{apiKeyEnv:provider==='deepseek'?'DEEPSEEK_API_KEY':'DASHSCOPE_API_KEY',baseUrl:provider==='deepseek'?'https://api.deepseek.com':'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',model,timeoutMs:60000},prompt,AbortSignal.timeout(60000),4000);value=JSON.parse(reply.content);console.log(JSON.stringify({provider,case:c.id,inputTokens:reply.inputTokens,outputTokens:reply.outputTokens,costUsd:Number.isFinite(reply.costUsd)?reply.costUsd:null}));}catch(error){console.log(JSON.stringify({provider,case:c.id,status:'provider_failed',httpStatus:error instanceof ProviderHttpError?error.status:null,timeout:error instanceof Error&&error.name==='TimeoutError',errorKind:error instanceof SyntaxError?'json':error instanceof TypeError?'transport':error instanceof ProviderHttpError?'http':'configuration',networkCode:error instanceof Error&&error.cause&&typeof error.cause==='object'&&'code' in error.cause&&['ENOTFOUND','EAI_AGAIN','ECONNRESET','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(String(error.cause.code))?String(error.cause.code):null}));failures++;continue;}
    }
    const parsed=schema.safeParse(value);const errors=parsed.success?validateGeneratedSections(input,parsed.data.sections):parsed.error.issues.map(i=>`Schema: ${i.path.join('.')} ${i.code}`);
    console.log(JSON.stringify({provider,case:c.id,mode:live?'live':'fake',schema:parsed.success,structuralErrors:errors,scores:{schema:parsed.success?1:0,multigrade:!parsed.success?0:errors.some(e=>/group|teacher|paired|activity/i.test(e))?0:1,competencyPresence:!parsed.success?0:errors.some(e=>/objectives|assessment/i.test(e))?0:1,timeBudget:c.input.templateId==='tpl.dll.v1'?null:!parsed.success?0:errors.some(e=>/minutes|budget|transition/i.test(e))?0:1,materials:!parsed.success?0:errors.some(e=>/materials|resources/i.test(e))?0:1},passed:!errors.length,teacherReview:'required before release'}));
    if(errors.length)failures++;
  }
}
process.exitCode=failures?1:0;
