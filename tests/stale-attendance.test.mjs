import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui,edge,build]=await Promise.all([
  readFile(new URL('../admin-stale-attendance.js',import.meta.url),'utf8'),
  readFile(new URL('../supabase/functions/attendance-stale-open/index.ts',import.meta.url),'utf8'),
  readFile(new URL('../build.mjs',import.meta.url),'utf8'),
]);

test('admin surfaces historical stale clock-outs and can correct them',()=>{
  for(const token of ['과거 미퇴근','listStaleAttendance','resolveStaleAttendance','data-stale-center','saveStaleAttendance']) assert.ok(ui.includes(token));
});

test('stale-open edge function only lists prior-day open attendance and records audited correction',()=>{
  assert.ok(edge.includes(".lt('work_date',cutoff)"));
  assert.ok(edge.includes(".is('clock_out',null)"));
  assert.ok(edge.includes('correct_attendance_value'));
  assert.ok(edge.includes("event_type:'admin_corrected'"));
  assert.ok(edge.includes(".eq('role','admin')"));
});

test('build ships stale attendance assets from local repository',()=>{
  assert.ok(build.includes('/admin-stale-attendance.js'));
  assert.ok(build.includes('/styles-stale-attendance.css'));
  assert.ok(build.includes("new URL('./baseline/', import.meta.url)"));
  assert.equal(build.includes('attendance-management-dcpp95jnz-choi18.vercel.app'),false);
});
