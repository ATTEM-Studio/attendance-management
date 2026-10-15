import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScheduleImportDiff, validateImportPayload } from '../supabase/functions/attendance-schedule-import/import-core.mjs';

const [ui,edge,migration,overrideMigration]=await Promise.all([
  readFile(new URL('../schedule-import.js',import.meta.url),'utf8'),
  readFile(new URL('../supabase/functions/attendance-schedule-import/index.ts',import.meta.url),'utf8'),
  readFile(new URL('../supabase/migrations/20261015034500_schedule_import_allow_past.sql',import.meta.url),'utf8'),
  readFile(new URL('../supabase/migrations/20261015061500_schedule_import_past_schedule_override.sql',import.meta.url),'utf8'),
]);

test('past dates require explicit opt-in',()=>{
  const base={
    targetMonth:'2026-10',
    effectiveDate:'2026-10-01',
    today:'2026-10-15',
    shifts:[{employeeId:'e1',workDate:'2026-10-01',scheduledStart:'09:00',scheduledEnd:'18:00'}],
  };
  assert.equal(validateImportPayload(base).ok,false);
  assert.equal(validateImportPayload({...base,allowPast:true}).ok,true);
});

test('opted-in past import updates historical schedules while keeping today protected',()=>{
  const diff=buildScheduleImportDiff({
    targetMonth:'2026-10',
    effectiveDate:'2026-10-01',
    allowPast:true,
    today:'2026-10-15',
    authoritative:false,
    shifts:[
      {employeeId:'e1',employeeLabel:'김나현',workDate:'2026-10-03',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'open'},
      {employeeId:'e1',employeeLabel:'김나현',workDate:'2026-10-15',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'open'},
    ],
    baseSchedules:[],
    extraSchedules:[],
    attendance:[
      {employee_id:'e1',work_date:'2026-10-03',clock_in:'2026-10-03T09:05:00+09:00',clock_out:'2026-10-03T18:00:00+09:00'},
      {employee_id:'e1',work_date:'2026-10-15',clock_in:'2026-10-15T09:05:00+09:00',clock_out:null},
    ],
  });
  const byDate=new Map(diff.map((row)=>[row.workDate,row.status]));
  assert.equal(byDate.get('2026-10-03'),'add');
  assert.equal(byDate.get('2026-10-15'),'protected');
});

test('UI exposes a deliberate past-date option and sends it to preview/apply',()=>{
  assert.match(ui,/id="scheduleImportAllowPast"/);
  assert.match(ui,/과거 일정까지 일괄 반영/);
  assert.match(ui,/실제 출퇴근 기록은 유지/);
  assert.match(ui,/실제 출퇴근 기록은 삭제·수정하지 않습니다/);
  assert.match(ui,/allowPast:scheduleImportState\.allowPast===true/);
  assert.match(ui,/지난 월 근무표는 ‘과거 일정까지 일괄 반영’을 켜야 합니다/);
});

test('server audits opt-in and uses the guarded five-argument RPC',()=>{
  assert.match(edge,/const allowPast=body\?\.allowPast===true/);
  assert.match(edge,/allow_past:source\.allowPast===true/);
  assert.match(edge,/Boolean\(run\.allow_past\)!==Boolean\(source\.allowPast\)/);
  assert.match(edge,/p_allow_past:source\.allowPast===true/);
  assert.match(migration,/add column if not exists allow_past boolean not null default false/);
  assert.match(migration,/p_allow_past boolean/);
  assert.match(migration,/past effective date requires explicit opt-in/);
  assert.match(migration,/apply_schedule_import\(text,date,boolean,boolean,jsonb\)/);
  assert.doesNotMatch(migration,/drop function/);
  assert.match(overrideMigration,/s\.work_date < v_today/);
  assert.match(overrideMigration,/v_group\.work_date < v_today/);
});
