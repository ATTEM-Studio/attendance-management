import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const toolUrl = new URL('../admin-date-tools.js', import.meta.url);
const cssUrl = new URL('../styles-admin-date-tools.css', import.meta.url);

test('selected date work tools are included in the built PWA', async () => {
  assert.equal(existsSync(toolUrl), true, 'admin-date-tools.js must exist');
  assert.equal(existsSync(cssUrl), true, 'styles-admin-date-tools.css must exist');
  execFileSync(process.execPath, ['build.mjs'], { stdio: 'pipe' });
  const [indexHtml, sw] = await Promise.all([
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/sw.js', import.meta.url), 'utf8'),
  ]);
  assert.match(indexHtml, /styles-admin-date-tools\.css/);
  assert.match(indexHtml, /admin-date-tools\.js/);
  assert.match(sw, /admin-date-tools\.js/);
});

test('selected date inspector exposes attendance state and quick schedule editing', async () => {
  assert.equal(existsSync(toolUrl), true, 'admin-date-tools.js must exist');
  const source = await readFile(toolUrl, 'utf8');
  const context = {
    api: {},
    request: () => {},
    state: {
      employees: [{ id:'e1', name:'김송이', position:'스태프', active:true }],
      schedules: [{ id:'s1', employeeId:'e1', workDate:'2026-09-06', scheduledStart:'09:00', scheduledEnd:'17:00', shiftType:'other' }],
      attendance: [],
    },
    adminWorkSelectedDate: '2026-09-06',
    session: { token:'test-token' },
    bindAdminWork() {},
    esc: (v) => String(v ?? ''),
    shiftTypeLabel: () => '기타',
    longDate: () => '9월 6일 (일)',
    fmtTime: (v) => v || '—',
    localInputValue: (v) => v || '',
    field: ({id,label,value=''}) => `<label>${label}</label><input id="${id}" value="${value}">`,
    icon: () => '<i></i>',
    openSheet() {},
    dismissLayer() {},
    setTimeout(fn) { fn(); },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    toastMsg() {}, haptic() {}, setPending() {}, clearFieldErrors() {}, showFieldError() {},
    load: async () => {}, renderAdmin() {}, month:'2026-09', adminWorkMonth:'2026-09',
    openDeleteScheduleSheet() {},
  };
  context.employeeById = (id) => context.state.employees.find((e) => e.id === id);
  context.activeEmployees = () => context.state.employees.filter((e) => e.active);
  context.attendanceSessionsFor = (id,date) => context.state.attendance.filter((a) => a.employeeId === id && a.workDate === date);
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  const inspector = context.adminScheduleInspector();
  assert.match(inspector, /data-selected-attendance="e1\|2026-09-06"/);
  assert.match(inspector, /근태 기록 없음/);
  assert.match(inspector, /근무 추가·수정/);

  const attendanceSheet = context.selectedDateAttendanceSheetMarkup('e1','2026-09-06');
  assert.match(attendanceSheet, /근태 기록 추가/);
  assert.match(attendanceSheet, /09:00/);
  assert.match(attendanceSheet, /17:00/);

  const scheduleEditor = context.selectedDateScheduleEditorMarkup('2026-09-06');
  assert.match(scheduleEditor, /9월 6일 \(일\)/);
  assert.match(scheduleEditor, /김송이/);
  assert.match(scheduleEditor, /data-date-schedule-save="e1"/);
  assert.match(scheduleEditor, /직원 추가/);
});
