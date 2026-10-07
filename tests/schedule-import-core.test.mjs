import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const coreUrl = new URL('../schedule-import-core.js', import.meta.url);
const fixtureUrl = new URL('./fixtures/schedule-import-complex.json', import.meta.url);

async function loadCore() {
  assert.equal(existsSync(coreUrl), true, 'schedule-import-core.js must exist');
  await import(`${coreUrl.href}?t=${Date.now()}-${Math.random()}`);
  assert.ok(globalThis.ScheduleImportCore, 'ScheduleImportCore global API must be exposed');
  return globalThis.ScheduleImportCore;
}

async function loadFixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

function fakeWorkbook(fixture) {
  const SheetNames = Object.keys(fixture.sheets);
  const Sheets = Object.fromEntries(SheetNames.map((name) => [name, { __rows: fixture.sheets[name] }]));
  return { SheetNames, Sheets };
}

const fakeXLSX = {
  utils: {
    sheet_to_json(sheet) {
      return sheet.__rows.map((row) => row.slice());
    },
  },
};

test('schedule candidate outranks payroll and meeting sheets', async () => {
  const core = await loadCore();
  const fixture = await loadFixture();
  const regions = core.detectScheduleRegions(fakeWorkbook(fixture), fakeXLSX);

  assert.ok(regions.length >= 1);
  assert.equal(regions[0].sheetName, '9월 스케줄');
  assert.equal(regions[0].authoritative, true);
  assert.ok(regions[0].score > (regions.find((row) => row.sheetName === '직원 급여')?.score ?? -Infinity));
  assert.ok(regions[0].reasons.some((reason) => reason.includes('요일')));
});

test('schedule region parses weekday shifts and normalizes ambiguous clock text', async () => {
  const core = await loadCore();
  const fixture = await loadFixture();
  const workbook = fakeWorkbook(fixture);
  const [region] = core.detectScheduleRegions(workbook, fakeXLSX);
  const rows = core.parseScheduleRegion(workbook, fakeXLSX, region);

  assert.ok(rows.some((row) => row.employeeLabel === '세영' && row.weekday === 1 && row.scheduledStart === '08:00' && row.scheduledEnd === '12:00'));
  assert.ok(rows.some((row) => row.employeeLabel === '이유림' && row.weekday === 1 && row.scheduledStart === '12:00' && row.scheduledEnd === '18:00'));
  assert.ok(rows.some((row) => row.employeeLabel === '김송이' && row.weekday === 1 && row.scheduledStart === '18:00' && row.scheduledEnd === '22:00'));
  assert.ok(rows.some((row) => row.employeeLabel === '송이' && row.weekday === 0 && row.scheduledStart === '09:00' && row.scheduledEnd === '18:00'));
});

test('weekly rows expand only inside target month and on or after effective date', async () => {
  const core = await loadCore();
  const expanded = core.expandWeeklyPattern([
    { sourceRowId:'m', employeeLabel:'세영', weekday:1, scheduledStart:'08:00', scheduledEnd:'12:00', shiftType:'other', confidence:1 },
    { sourceRowId:'t', employeeLabel:'윤아', weekday:2, scheduledStart:'08:00', scheduledEnd:'11:00', shiftType:'other', confidence:1 },
  ], '2026-10', '2026-10-15');

  assert.ok(expanded.length > 0);
  assert.ok(expanded.every((row) => row.workDate.startsWith('2026-10-')));
  assert.ok(expanded.every((row) => row.workDate >= '2026-10-15'));
  assert.ok(expanded.some((row) => row.workDate === '2026-10-19' && row.employeeLabel === '세영'));
  assert.ok(expanded.some((row) => row.workDate === '2026-10-20' && row.employeeLabel === '윤아'));
  assert.equal(expanded.some((row) => row.workDate === '2026-10-12'), false);
});

test('normalization keeps multiple same-day segments separate and sorted', async () => {
  const core = await loadCore();
  const normalized = core.normalizeImportedShifts([
    { sourceRowId:'2', employeeLabel:'김송이', employeeId:'e1', workDate:'2026-10-21', scheduledStart:'18:00', scheduledEnd:'22:00', confidence:1 },
    { sourceRowId:'1', employeeLabel:'김송이', employeeId:'e1', workDate:'2026-10-21', scheduledStart:'09:00', scheduledEnd:'14:00', confidence:1 },
  ]);

  assert.deepEqual(normalized.map((row) => [row.scheduledStart,row.scheduledEnd]), [['09:00','14:00'],['18:00','22:00']]);
  assert.equal(normalized[0].shiftType, 'other');
  assert.equal(normalized[1].shiftType, 'other');
});

test('employee matching handles exact, unique abbreviation and ambiguous abbreviation safely', async () => {
  const core = await loadCore();
  const employees = [
    {id:'e1',name:'김송이',active:true},
    {id:'e2',name:'박세영',active:true},
    {id:'e3',name:'최유림',active:false},
  ];

  assert.deepEqual(core.matchEmployeeLabel('김송이', employees, {}), {
    employeeId:'e1', matchedName:'김송이', matchType:'exact', confidence:1, needsReview:false,
  });

  const unique = core.matchEmployeeLabel('송이', employees, {});
  assert.equal(unique.employeeId, 'e1');
  assert.equal(unique.matchType, 'abbreviation');
  assert.equal(unique.needsReview, false);

  const ambiguous = core.matchEmployeeLabel('송이', [...employees,{id:'e4',name:'박송이',active:true}], {});
  assert.equal(ambiguous.employeeId, undefined);
  assert.equal(ambiguous.needsReview, true);
  assert.equal(ambiguous.candidates.length, 2);
});

test('saved alias takes precedence and inactive employees are not auto-matched', async () => {
  const core = await loadCore();
  const employees = [
    {id:'e1',name:'김송이',active:true},
    {id:'e2',name:'최유림',active:false},
  ];
  const aliased = core.matchEmployeeLabel('송이쌤', employees, {'송이쌤':'e1'});
  assert.equal(aliased.employeeId, 'e1');
  assert.equal(aliased.matchType, 'alias');

  const inactive = core.matchEmployeeLabel('최유림', employees, {});
  assert.equal(inactive.employeeId, undefined);
  assert.equal(inactive.needsReview, true);
});
