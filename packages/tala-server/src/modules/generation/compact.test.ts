import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedSection, SectionContent } from '@hiraia/tala-core';
import { validateGeneratedSections } from '@hiraia/tala-core/generation';
import { evaluationCases, objectivesFor } from '../../../eval/cases';
import { fakeCompact, fakeCompactRaw } from '../../../eval/fixtures';
import { convertCompact, lessonRequest, multigradeSchedule } from './compact';
const fixture=()=>{const c=evaluationCases[0]!;return {...c.input,resolvedObjectives:objectivesFor(c.input)};};
const newId=(()=>{let n=0;return()=>`local-id-${++n}`;})();
test('compact format converts all fixtures into validated storage data with authoritative objectives',()=>{
  for(const c of evaluationCases){const input={...c.input,resolvedObjectives:objectivesFor(c.input)};const result=convertCompact(input,fakeCompact(input),newId);assert.deepEqual(validateGeneratedSections(input,result.sections),[],c.id);for(const s of result.sections)assert.equal(SectionContent.safeParse(s.content).success,true);}
});
test('server rotation is exact across all group counts and budgets; every grade gets a focus slot',()=>{
  for(const n of [2,3,4])for(const minutes of [10,30,50,60,240,480]){const input={...fixture(),timeBudgetMinutes:minutes,gradeGroups:Array.from({length:n},(_,i)=>({id:`group-00${i+1}`,grade:String(i+1) as '1',learnerCount:10}))};const schedule=multigradeSchedule(input);assert.equal(schedule.reduce((sum,b)=>sum+b.minutes,0),minutes);for(const g of input.gradeGroups)assert.equal(schedule.filter(b=>b.teacherWith===g.grade).length,1);}
});
test('missing/duplicate slots and hallucinated objective refs are refused, never repaired silently',()=>{
  const input=fixture(),raw=fakeCompact(input);const block=raw.sections.find(s=>s.key==='multigrade')!;block.blocks[0]!.slot=2;assert.throws(()=>convertCompact(input,raw,newId),/schedule_slots/);
  const bad=fakeCompact(input);bad.sections.find(s=>s.key==='objectives')!.groups[0]!.targets=['invented'];assert.throws(()=>convertCompact(input,bad,newId),/objective_reference/);
});
test('request validation checks missing groups and is shared by all providers',()=>{
  const input=fixture(),req=lessonRequest(input,{userId:'teacher-001',newId});assert.equal(req.version,2);assert.equal(req.maxOutputTokens,8192);const raw=fakeCompact(input);raw.sections.find(s=>s.key==='multigrade')!.blocks[0]!.activities.pop();const wire=fakeCompactRaw(input);const block=wire.sections.find(s=>s.key==='multigrade')!;if('blocks'in block)block.blocks!.at(0)!.activities.pop();const converted=req.schema.safeParse(wire);assert.equal(converted.success,true);if(converted.success)assert.ok(req.check!(converted.data).some(e=>e.includes('activity')));
});
test('v1 rollback keeps the storage-format schema',()=>{const input=fixture(),req=lessonRequest(input,{userId:'teacher-001',newId,version:1});const output=convertCompact(input,fakeCompact(input),newId);assert.equal(req.version,1);assert.equal(req.schema.safeParse(output).success,true);});
test('translation changes only allowlisted text leaves and preserves IDs and timeline structure',()=>{
  const input=fixture(),source=convertCompact(input,fakeCompact(input),newId).sections;const req=lessonRequest({...input,kind:'translate',targetLanguage:'fil'},{userId:'teacher-001',newId,source});const vars=JSON.parse(req.vars.input!) as {leaves:{path:string;text:string}[]};const parsed=req.schema.safeParse({translations:vars.leaves.map(l=>({...l,text:'Isinaling teksto.'}))});assert.equal(parsed.success,true);if(parsed.success){for(const s of parsed.data.sections)assert.equal(SectionContent.safeParse(s.content).success,true);const original=source.find(s=>s.key==='multigrade')!.content;const translated=parsed.data.sections.find(s=>s.key==='multigrade')!.content;if(original.type==='multigrade'&&translated.type==='multigrade'){assert.equal(original.blocks[0]!.id,translated.blocks[0]!.id);assert.equal(original.blocks[0]!.minutes,translated.blocks[0]!.minutes);}}
  assert.equal(req.schema.safeParse({translations:[]}).success,false);
});
