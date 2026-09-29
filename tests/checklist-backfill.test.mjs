import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

test('checklist backfill skips past dates and repairs current/future schedules only', async () => {
  const source = await readFile('checklist-backfill.js', 'utf8');
  const context = {};
  vm.runInNewContext(source + '\nthis.findGroups = findChecklistBackfillGroups;', context);
  const findGroups = context.findGroups;

  const state = {
    checklistTemplates:[
      { id:'open-t', shiftType:'open', active:true, weekdays:[0,1,2,3,4,5,6] },
      { id:'close-t', shiftType:'close', active:true, weekdays:[0,1,2,3,4,5,6] },
    ],
    schedules:[
      { employeeId:'e1', workDate:'2026-09-28', scheduledStart:'08:00', scheduledEnd:'11:00', shiftType:'open' },
      { employeeId:'e1', workDate:'2026-09-29', scheduledStart:'08:00', scheduledEnd:'11:00', shiftType:'open' },
      { employeeId:'e1', workDate:'2026-09-30', scheduledStart:'08:00', scheduledEnd:'11:00', shiftType:'open' },
      { employeeId:'e2', workDate:'2026-09-29', scheduledStart:'18:00', scheduledEnd:'22:00', shiftType:'close' },
      { employeeId:'e3', workDate:'2026-09-29', scheduledStart:'12:00', scheduledEnd:'22:00', shiftType:'middle_close' },
      { employeeId:'e4', workDate:'2026-09-29', scheduledStart:'12:00', scheduledEnd:'18:00', shiftType:'middle' },
    ],
    taskAssignments:[
      { employeeId:'e2', workDate:'2026-09-29', sourceType:'checklist', shiftType:'close', status:'pending' },
    ],
  };

  const groups = findGroups(state, '2026-09-29');
  const dates = groups.flatMap((group) => Array.from(group.workDates)).sort();

  assert.ok(!dates.includes('2026-09-28'));
  assert.ok(dates.includes('2026-09-29'));
  assert.ok(dates.includes('2026-09-30'));
  assert.ok(groups.some((group) => group.employeeId === 'e1'));
  assert.ok(groups.some((group) => group.employeeId === 'e3'));
  assert.ok(!groups.some((group) => group.employeeId === 'e2'));
  assert.ok(!groups.some((group) => group.employeeId === 'e4'));

  assert.match(source, /session\?\.role !== 'admin'/);
  assert.match(source, /api\.bulkSchedule/);
  assert.match(source, /const baseLoadForChecklistBackfill = load/);

  execFileSync(process.execPath, ['build.mjs'], { stdio:'pipe' });
  const html = await readFile('dist/index.html', 'utf8');
  const sw = await readFile('dist/sw.js', 'utf8');
  assert.match(html, /checklist-backfill\.js/);
  assert.match(sw, /checklist-backfill\.js/);
});
