import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const migrationUrl=new URL('../supabase/migrations/20261006_schedule_import.sql',import.meta.url);

test('schedule import migration provides private audit tables and one atomic service-role RPC',async()=>{
  assert.equal(existsSync(migrationUrl),true,'schedule import migration must exist');
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/create table if not exists public\.schedule_import_runs/i);
  assert.match(sql,/create table if not exists public\.schedule_import_aliases/i);
  assert.match(sql,/alter table public\.schedule_import_runs enable row level security/i);
  assert.match(sql,/alter table public\.schedule_import_aliases enable row level security/i);
  assert.match(sql,/create or replace function public\.apply_schedule_import/i);
  assert.match(sql,/security definer/i);
  assert.match(sql,/revoke all on function public\.apply_schedule_import/i);
  assert.match(sql,/grant execute on function public\.apply_schedule_import[^;]+service_role/i);
  assert.match(sql,/Asia\/Seoul/i);
  assert.match(sql,/clock_in is not null[\s\S]*clock_out is not null/i);
  assert.match(sql,/extra_schedules/i);
  assert.match(sql,/task_assignments/i);
  assert.match(sql,/source_type\s*=\s*'checklist'/i);
  assert.match(sql,/status\s*=\s*'pending'/i);
  assert.match(sql,/raise exception/i);
  assert.equal(/grant execute on function public\.apply_schedule_import[^;]+authenticated/i.test(sql),false);
  assert.equal(/grant execute on function public\.apply_schedule_import[^;]+anon/i.test(sql),false);
});
