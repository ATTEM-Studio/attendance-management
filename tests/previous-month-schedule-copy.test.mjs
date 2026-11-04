import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration=await readFile(new URL('../supabase/migrations/20261104122500_schedule_import_previous_month_source.sql',import.meta.url),'utf8');

test('schedule import audit accepts xlsx and internal previous-month sources only',()=>{
  assert.match(migration,/source_type in \('xlsx','previous_month'\)/);
  assert.match(migration,/drop constraint if exists schedule_import_runs_source_type_check/);
});
