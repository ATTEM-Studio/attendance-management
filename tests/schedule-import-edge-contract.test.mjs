import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const edgeUrl=new URL('../supabase/functions/attendance-schedule-import/index.ts',import.meta.url);
const denoUrl=new URL('../supabase/functions/attendance-schedule-import/deno.json',import.meta.url);

async function sources(){
  assert.equal(existsSync(edgeUrl),true,'attendance-schedule-import/index.ts must exist');
  assert.equal(existsSync(denoUrl),true,'attendance-schedule-import/deno.json must exist');
  return {
    edge:await readFile(edgeUrl,'utf8'),
    deno:await readFile(denoUrl,'utf8'),
  };
}

test('edge function uses custom app session auth and admin-only guard before actions',async()=>{
  const {edge}=await sources();
  assert.match(edge,/authorization/i);
  assert.match(edge,/Bearer /);
  assert.match(edge,/SHA-256/);
  assert.match(edge,/app_sessions/);
  assert.match(edge,/expires_at/);
  assert.match(edge,/session\.role\s*!==\s*['"]admin['"]/);
  assert.match(edge,/403/);
  const authIndex=edge.indexOf('session.role');
  const actionIndex=edge.indexOf("action==='analyze_image'");
  assert.ok(authIndex>=0 && actionIndex>authIndex,'admin guard must run before action dispatch');
});

test('edge exposes analyze_image preview apply and save_alias actions',async()=>{
  const {edge}=await sources();
  for(const action of ['analyze_image','preview','apply','save_alias']) assert.match(edge,new RegExp(`action\\s*===\\s*['\"]${action}['\"]`));
  assert.match(edge,/analyzeScheduleImage/);
  assert.match(edge,/buildScheduleImportDiff/);
  assert.match(edge,/summarizeImportDiff/);
  assert.match(edge,/apply_schedule_import/);
  assert.match(edge,/schedule_import_runs/);
  assert.match(edge,/schedule_import_aliases/);
});

test('preview reloads server schedules extras and attendance before calculating diff',async()=>{
  const {edge}=await sources();
  assert.match(edge,/from\(['"]schedules['"]\)/);
  assert.match(edge,/from\(['"]extra_schedules['"]\)/);
  assert.match(edge,/from\(['"]attendance['"]\)/);
  assert.match(edge,/gte\(['"]work_date['"],\s*effectiveDate\)/);
  assert.match(edge,/buildScheduleImportDiff\(\{/);
});

test('apply recomputes current protection state and uses atomic RPC',async()=>{
  const {edge}=await sources();
  const helperStart=edge.indexOf('async function applyScheduleImport');
  const dispatchStart=edge.indexOf("action==='apply'");
  assert.ok(helperStart>=0 && dispatchStart>helperStart);
  const helperSource=edge.slice(helperStart,dispatchStart);
  assert.match(helperSource,/loadScheduleImportContext/);
  assert.match(helperSource,/buildScheduleImportDiff/);
  assert.match(helperSource,/rpc\(['"]apply_schedule_import['"]/);
  assert.match(helperSource,/status:['"]applied['"]/);
  assert.match(helperSource,/syncImportedChecklists/);
  const dispatchSource=edge.slice(dispatchStart,edge.indexOf("action==='save_alias'"));
  assert.match(dispatchSource,/applyScheduleImport\(source,runId,rawToken\)/);
});

test('apply is bound to the exact preview source fingerprint',async()=>{
  const {edge}=await sources();
  const helperStart=edge.indexOf('async function applyScheduleImport');
  const dispatchStart=edge.indexOf("action==='apply'");
  const helperSource=edge.slice(helperStart,dispatchStart);
  assert.match(helperSource,/source_fingerprint/);
  assert.match(helperSource,/run\.source_fingerprint\s*!==\s*source\.sourceFingerprint/);
  assert.match(helperSource,/미리보기와 적용 파일이 달라졌습니다/);
});

test('image action checks request before OpenAI and missing key fails clearly',async()=>{
  const {edge}=await sources();
  const block=edge.slice(edge.indexOf("action==='analyze_image'"),edge.indexOf("action==='preview'"));
  assert.match(block,/validateImageRequest/);
  assert.match(block,/OPENAI_API_KEY/);
  assert.match(block,/503/);
  assert.match(block,/OPENAI_SCHEDULE_VISION_MODEL/);
  assert.match(block,/gpt-6-luna/);
});

test('alias save validates active employee before service-role upsert',async()=>{
  const {edge}=await sources();
  const block=edge.slice(edge.indexOf("action==='save_alias'"));
  assert.match(block,/employees/);
  assert.match(block,/active/);
  assert.match(block,/schedule_import_aliases/);
  assert.match(block,/upsert/);
});

test('deno config pins supabase client import',async()=>{
  const {deno}=await sources();
  const parsed=JSON.parse(deno);
  assert.ok(parsed.imports?.['@supabase/supabase-js']);
  assert.match(parsed.imports['@supabase/supabase-js'],/^npm:@supabase\/supabase-js@/);
});
