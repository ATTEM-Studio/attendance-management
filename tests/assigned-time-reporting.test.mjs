import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [report,admin,correction,styles]=await Promise.all([
  readFile(new URL('../supabase/functions/attendance-report/index.ts',import.meta.url),'utf8'),
  readFile(new URL('../admin-redesign.js',import.meta.url),'utf8'),
  readFile(new URL('../baseline/admin-correction.js',import.meta.url),'utf8'),
  readFile(new URL('../styles-admin-redesign.css',import.meta.url),'utf8'),
]);

test('Excel settlement time uses assigned hours for completed base shifts and actual hours for extra shifts',()=>{
  assert.match(report,/const settlementMinutes=/);
  assert.match(report,/session_type==='extra'/);
  assert.match(report,/return scheduledMinutes\(schedule\)/);
  assert.match(report,/attendance\?\.clock_out/);
  assert.match(report,/기본근무=할당시간 · 추가근무=실제시간/);
  assert.match(report,/정산 시간/);
  assert.match(report,/실제 시간/);
});

test('Excel keeps actual attendance visible while making settlement totals explicit',()=>{
  assert.match(report,/actualMinutes/);
  assert.match(report,/정산 근무시간/);
  assert.match(report,/할당 출근/);
  assert.match(report,/할당 퇴근/);
  assert.match(report,/실제 출근/);
  assert.match(report,/실제 퇴근/);
  assert.match(report,/기본 근무 · 할당시간 정산/);
  assert.match(report,/추가 근무 · 실제시간 정산/);
});

test('admin views emphasize assigned hours and show settlement basis',()=>{
  assert.match(correction,/record-assigned-time/);
  assert.match(correction,/할당 \$\{esc\(assigned\)\}/);
  assert.match(correction,/attendanceSettlementMinutes/);
  assert.match(admin,/admin-assigned-shift/);
  assert.match(admin,/정산 기준시간/);
  assert.match(admin,/attendanceSettlementMinutes\(row\)/);
  assert.match(styles,/\.admin-assigned-shift/);
  assert.match(styles,/\.admin-attendance-summary \.is-settlement/);
});
