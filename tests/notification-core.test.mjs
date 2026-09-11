import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActiveAlerts } from '../supabase/functions/attendance-notify/notification-core.mjs';

const EMPLOYEE_ID = '11111111-1111-1111-1111-111111111111';
const ATTENDANCE_ID = '22222222-2222-2222-2222-222222222222';

const employees = [{ id:EMPLOYEE_ID, name:'김직원', active:true }];
const baseSchedule = [{ employeeId:EMPLOYEE_ID, workDate:'2026-09-11', scheduledStart:'09:00', scheduledEnd:'18:00' }];

function buildAt(now, { open=false, completed=false, tasks=[] } = {}) {
  const attendance = [];
  if (open) attendance.push({ id:ATTENDANCE_ID, employeeId:EMPLOYEE_ID, workDate:'2026-09-11', clockIn:'2026-09-11T09:00:00+09:00', clockOut:null });
  if (completed) attendance.push({ id:ATTENDANCE_ID, employeeId:EMPLOYEE_ID, workDate:'2026-09-11', clockIn:'2026-09-11T09:00:00+09:00', clockOut:'2026-09-11T18:00:00+09:00' });
  return buildActiveAlerts({ now, schedules:baseSchedule, attendance, tasks, employees });
}

function buildWithYesterdayOpen() {
  return buildActiveAlerts({
    now:'2026-09-11T08:00:00+09:00',
    schedules:baseSchedule,
    employees,
    attendance:[{ id:ATTENDANCE_ID, employeeId:EMPLOYEE_ID, workDate:'2026-09-10', clockIn:'2026-09-10T09:00:00+09:00', clockOut:null }],
    tasks:[],
  });
}

function checklist(status='pending') {
  return [{ id:'t1', employeeId:EMPLOYEE_ID, workDate:'2026-09-11', sourceType:'checklist', required:true, status }];
}

test('missing clock-in starts exactly 10 minutes after scheduled start', () => {
  assert.equal(buildAt('2026-09-11T09:09:00+09:00').length, 0);
  const alerts = buildAt('2026-09-11T09:10:00+09:00');
  const alert = alerts.find((row) => row.type === 'missing_clock_in');
  assert.ok(alert);
  assert.equal(alert.alertKey, `missing_clock_in:${EMPLOYEE_ID}:2026-09-11`);
});

test('existing clock-in suppresses missing clock-in', () => {
  assert.equal(buildAt('2026-09-11T09:20:00+09:00', { open:true }).some((row) => row.type === 'missing_clock_in'), false);
});

test('missing clock-out starts exactly 15 minutes after scheduled end', () => {
  assert.equal(buildAt('2026-09-11T18:14:00+09:00', { open:true }).some((row) => row.type === 'missing_clock_out'), false);
  const alert = buildAt('2026-09-11T18:15:00+09:00', { open:true }).find((row) => row.type === 'missing_clock_out');
  assert.ok(alert);
  assert.equal(alert.alertKey, `missing_clock_out:${ATTENDANCE_ID}`);
});

test('past open attendance becomes stale-open alert without touching today', () => {
  const alerts = buildWithYesterdayOpen();
  const stale = alerts.find((row) => row.type === 'stale_open');
  assert.ok(stale);
  assert.equal(stale.alertKey, `stale_open:${ATTENDANCE_ID}`);
  assert.equal(stale.workDate, '2026-09-10');
});

test('required checklist alerts after scheduled end and resolves when complete', () => {
  const pending = buildAt('2026-09-11T18:00:00+09:00', { completed:true, tasks:checklist('pending') });
  assert.equal(pending.filter((row) => row.type === 'required_checklist').length, 1);
  assert.equal(pending.find((row) => row.type === 'required_checklist').alertKey, `required_checklist:${EMPLOYEE_ID}:2026-09-11`);

  const complete = buildAt('2026-09-11T18:01:00+09:00', { completed:true, tasks:checklist('completed') });
  assert.equal(complete.some((row) => row.type === 'required_checklist'), false);
});

test('inactive employees do not generate notification alerts', () => {
  const alerts = buildActiveAlerts({
    now:'2026-09-11T18:30:00+09:00',
    schedules:baseSchedule,
    attendance:[],
    tasks:checklist('pending'),
    employees:[{ id:EMPLOYEE_ID, name:'김직원', active:false }],
  });
  assert.equal(alerts.length, 0);
});
