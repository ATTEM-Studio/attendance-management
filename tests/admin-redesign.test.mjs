import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const js = await readFile(new URL('../admin-redesign.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles-admin-redesign.css', import.meta.url), 'utf8');
const build = await readFile(new URL('../build.mjs', import.meta.url), 'utf8');

const includesAll = (text, values) => values.every((value) => text.includes(value));

test('admin navigation is reduced to Today, Work, Operations', () => {
  assert.ok(includesAll(js, ["key:'today'", "key:'work'", "key:'operations'", "label:'오늘'", "label:'근무'", "label:'운영'"]));
});

test('today dashboard exposes KPI, attention center and staff quick actions', () => {
  assert.ok(includesAll(js, ['adminTodaySnapshot', 'admin-kpi-grid', '확인 필요', 'openAdminStaffQuickSheet', 'data-admin-attendance-action']));
});

test('work workspace combines schedule and attendance records', () => {
  assert.ok(includesAll(js, ['adminWorkViewMarkup', '근무표', '근태기록', 'adminScheduleWorkspace', 'adminAttendanceWorkspace', 'Excel']));
});

test('operations workspace keeps employee, manual task and checklist management', () => {
  assert.ok(includesAll(js, ['adminOperationsView', '직원 관리', '업무 배정', '체크리스트 템플릿', 'openEmployeeManager', 'openTaskManager', 'openChecklistManager']));
});

test('responsive design provides mobile bottom nav and desktop rail', () => {
  assert.ok(css.includes('.admin-mobile-nav'));
  assert.ok(css.includes('.admin-rail'));
  assert.ok(css.includes('@media(min-width:1024px){.admin-mobile-nav{display:none}}'));
  assert.ok(css.lastIndexOf('@media(min-width:1024px){.admin-mobile-nav{display:none}}') > css.lastIndexOf('.admin-mobile-nav{display:grid}'));
});

test('build is pinned to immutable v27 and produces v28 cache', () => {
  assert.ok(build.includes('attendance-management-mp0va9jtl-choi18.vercel.app'));
  assert.ok(build.includes("attendance-management-v28"));
  assert.ok(build.includes('/styles-admin-redesign.css'));
  assert.ok(build.includes('/admin-redesign.js'));
  assert.ok(build.includes("adminSection !== 'undefined'"));
});
