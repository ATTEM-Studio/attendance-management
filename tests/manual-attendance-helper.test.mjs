import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const helperUrl = new URL('../supabase/functions/attendance-manual-create/manual-attendance.mjs', import.meta.url);
const edgeUrl = new URL('../supabase/functions/attendance-manual-create/index.ts', import.meta.url);

test('manual attendance helper validates historical record input', async () => {
  assert.equal(existsSync(helperUrl), true, 'manual-attendance.mjs must exist');
  const helper = await import(`${pathToFileURL(helperUrl.pathname).href}?t=${Date.now()}`);

  const valid = helper.validateManualAttendanceInput({
    employeeId:'e1', workDate:'2026-09-06',
    clockIn:'2026-09-06T09:07:00+09:00', clockOut:'2026-09-06T17:02:00+09:00',
    reason:'출퇴근 미입력 정정', today:'2026-09-08',
  });
  assert.equal(valid.ok, true);

  assert.equal(helper.validateManualAttendanceInput({
    employeeId:'e1', workDate:'2026-09-09',
    clockIn:'2026-09-09T09:00:00+09:00', clockOut:'2026-09-09T17:00:00+09:00',
    reason:'정정', today:'2026-09-08',
  }).ok, false, 'future dates must be rejected');

  assert.equal(helper.validateManualAttendanceInput({
    employeeId:'e1', workDate:'2026-09-06',
    clockIn:'2026-09-06T17:00:00+09:00', clockOut:'2026-09-06T09:00:00+09:00',
    reason:'정정', today:'2026-09-08',
  }).ok, false, 'clock out must be after clock in');
});

test('manual attendance metrics use the assigned schedule', async () => {
  assert.equal(existsSync(helperUrl), true, 'manual-attendance.mjs must exist');
  const helper = await import(`${pathToFileURL(helperUrl.pathname).href}?m=${Date.now()}`);
  const metrics = helper.computeManualAttendanceMetrics({
    workDate:'2026-09-06',
    clockIn:'2026-09-06T09:07:00+09:00',
    clockOut:'2026-09-06T17:02:00+09:00',
    scheduledStart:'09:00', scheduledEnd:'17:00',
  });
  assert.deepEqual(metrics, { workMinutes:475, lateMinutes:7, earlyLeaveMinutes:0, overtimeMinutes:2 });
});

test('isolated edge function exposes admin-only historical attendance creation with audit trail', async () => {
  assert.equal(existsSync(edgeUrl), true, 'attendance-manual-create source must be tracked');
  const source = await readFile(edgeUrl, 'utf8');
  assert.match(source, /app_sessions/);
  assert.match(source, /role !== 'admin'/);
  assert.match(source, /computeManualAttendanceMetrics/);
  assert.match(source, /audit_logs/);
  assert.match(source, /admin_clock_in/);
  assert.match(source, /admin_clock_out/);
  assert.match(source, /이미 근태 기록이 있는 날짜/);
});
