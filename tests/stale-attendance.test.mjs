import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui,build]=await Promise.all([
  readFile(new URL('../admin-stale-attendance.js',import.meta.url),'utf8'),
  readFile(new URL('../build.mjs',import.meta.url),'utf8'),
]);

test('admin surfaces historical stale clock-outs and can correct them with the existing audited API',()=>{
  for(const token of ['과거 미퇴근','api.bootstrap','api.correctAttendance','data-stale-center','saveStaleAttendance']) assert.ok(ui.includes(token));
  assert.ok(ui.includes("field:'clockOut'"));
  assert.ok(ui.includes('staleAttendanceMonths'));
});

test('build ships stale attendance assets from local repository',()=>{
  assert.ok(build.includes('/admin-stale-attendance.js'));
  assert.ok(build.includes('/styles-stale-attendance.css'));
  assert.ok(build.includes("new URL('./baseline/', import.meta.url)"));
  assert.equal(build.includes('attendance-management-dcpp95jnz-choi18.vercel.app'),false);
});
