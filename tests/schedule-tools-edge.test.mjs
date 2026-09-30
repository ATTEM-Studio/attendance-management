import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  scheduleShiftTypes,
  validateExtraScheduleInput,
  buildMissingChecklistRows,
} from '../supabase/functions/attendance-schedule-tools/schedule-tools.mjs';

test('extra schedule validation supports multiple non-overlapping shifts', () => {
  const ok=validateExtraScheduleInput({
    employeeId:'11111111-1111-1111-1111-111111111111',
    workDate:'2026-09-30',
    scheduledStart:'18:00',
    scheduledEnd:'22:00',
    shiftType:'close',
  });
  assert.equal(ok.ok,true);
  assert.deepEqual(scheduleShiftTypes('middle_close'),['middle','close']);
  assert.deepEqual(scheduleShiftTypes('open_middle'),['open','middle']);
});

test('checklist sync creates only missing current/future checklist rows', () => {
  const rows=buildMissingChecklistRows({
    today:'2026-09-30',
    schedules:[
      {employeeId:'e1',workDate:'2026-09-29',shiftType:'open'},
      {employeeId:'e1',workDate:'2026-09-30',shiftType:'open'},
      {employeeId:'e1',workDate:'2026-09-30',shiftType:'close'},
    ],
    templates:[
      {id:'t1',shiftType:'open',active:true,weekdays:[3],items:[{id:'i1',title:'오픈 준비',description:'',required:true,sortOrder:0}]},
      {id:'t2',shiftType:'close',active:true,weekdays:[3],items:[{id:'i2',title:'마감 정리',description:'',required:true,sortOrder:0}]},
    ],
    existing:[
      {employeeId:'e1',workDate:'2026-09-30',sourceType:'checklist',shiftType:'open',title:'오픈 준비'},
    ],
  });
  assert.equal(rows.length,1);
  assert.equal(rows[0].shift_type,'close');
  assert.equal(rows[0].title,'마감 정리');
  assert.equal(rows[0].source_type,'checklist');
});

test('migration and edge function keep extra schedules server-side and sync checklist tasks', async () => {
  const [migration,edge,helper]=await Promise.all([
    readFile('supabase/migrations/20260930_multi_shift_schedules.sql','utf8'),
    readFile('supabase/functions/attendance-schedule-tools/index.ts','utf8'),
    readFile('supabase/functions/attendance-schedule-tools/schedule-tools.mjs','utf8'),
  ]);
  assert.match(migration,/create table if not exists public\.extra_schedules/i);
  assert.match(migration,/enable row level security/i);
  assert.match(edge,/requireSession/);
  assert.match(edge,/extra_schedules/);
  assert.match(edge,/task_assignments/);
  assert.match(edge,/checklist_templates/);
  assert.match(helper,/source_type:\s*'checklist'/);
});
