import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const sourceUrl = new URL('../schedule-import.js', import.meta.url);
const styleUrl = new URL('../styles-schedule-import.css', import.meta.url);

function makeContext() {
  const context = {
    api:{},
    state:{ employees:[], schedules:[], extraSchedules:[], attendance:[] },
    session:{role:'admin',token:'token'},
    month:'2026-10', adminWorkMonth:'2026-10', adminWorkSelectedDate:'2026-10-20', adminWorkView:'schedule',
    ScheduleImportCore:{}, XLSX:{},
    externalRequest:async()=>({}),
    kstDate:()=> '2026-10-20', currentMonth:()=> '2026-10',
    esc:(v)=>String(v??''), icon:()=>'', openSheet(){}, dismissLayer(){}, toastMsg(){}, setPending(){}, haptic(){},
    load:async()=>{}, renderAdmin(){},
    activeEmployees(){ return []; },
    adminScheduleWorkspace(){ return '<section id="base-schedule"></section>'; },
    bindAdminWork(){},
    document:{ querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>({click(){}}) },
    FileReader:class {}, Blob:class {}, URL:{createObjectURL:()=>'',revokeObjectURL(){}},
    TextEncoder, Uint8Array, ArrayBuffer, crypto:globalThis.crypto,
    console, setTimeout:(fn)=>fn(), clearTimeout(){},
  };
  context.globalThis=context;
  return context;
}

async function loadUi() {
  assert.equal(existsSync(sourceUrl), true, 'schedule-import.js must exist');
  const source=await readFile(sourceUrl,'utf8');
  const context=makeContext();
  vm.createContext(context);
  vm.runInContext(source,context);
  return {source,context};
}

test('schedule import UI exposes a four-stage wizard and API methods', async () => {
  const {source,context}=await loadUi();
  assert.equal(typeof context.openScheduleImport,'function');
  assert.equal(typeof context.renderScheduleImportStep,'function');
  assert.equal(typeof context.buildImportPreviewModel,'function');
  assert.equal(typeof context.api.previewScheduleImport,'function');
  assert.equal(typeof context.api.applyScheduleImport,'function');
  assert.equal(typeof context.api.saveScheduleImportAlias,'function');
  for (const copy of ['파일 선택','근무표 선택','직원 확인','변경사항 확인','변경사항 적용']) assert.match(source,new RegExp(copy));
  assert.match(source,/\.xlsx/);
  assert.doesNotMatch(source,/\.png|\.jpg|\.jpeg|\.webp|analyzeScheduleImage/);
});

test('final preview renders a monthly calendar and only the selected date details', async () => {
  const {source,context}=await loadUi();
  assert.equal(typeof context.importPreviewCalendar,'function');
  assert.equal(typeof context.importSelectedDateDetail,'function');
  assert.match(source,/data-import-preview-date/);
  assert.match(source,/캘린더로 한눈에 확인하세요/);
  assert.doesNotMatch(source,/\(preview\.diff\|\|\[\]\)\.map\(importDiffRow\)/);
  const preview=context.buildImportPreviewModel({
    sourceType:'xlsx',
    targetMonth:'2026-10',
    effectiveDate:'2026-10-07',
    today:'2026-10-07',
    diff:[
      {status:'add',workDate:'2026-10-07',employeeName:'김나현',after:[{scheduledStart:'13:00',scheduledEnd:'19:00'}]},
      {status:'add',workDate:'2026-10-07',employeeName:'장세영',after:[{scheduledStart:'08:00',scheduledEnd:'14:00'}]},
      {status:'update',workDate:'2026-10-08',employeeName:'박시현',before:[{scheduledStart:'10:00',scheduledEnd:'16:00'}],after:[{scheduledStart:'11:00',scheduledEnd:'17:00'}]},
    ],
  });
  const calendar=context.importPreviewCalendar(preview,'2026-10','2026-10-07');
  const detail=context.importSelectedDateDetail(preview,'2026-10-07');
  assert.match(calendar,/2026년 10월/);
  assert.match(calendar,/data-import-preview-date="2026-10-07"/);
  assert.match(calendar,/2건/);
  assert.match(detail,/김나현/);
  assert.match(detail,/장세영/);
  assert.doesNotMatch(detail,/박시현/);
});

test('preview model enforces KST effective date floor and exposes all diff counts', async () => {
  const {context}=await loadUi();
  const model=context.buildImportPreviewModel({
    sourceType:'xlsx', targetMonth:'2026-10', effectiveDate:'2026-10-01', today:'2026-10-20',
    candidateRegionId:'r1', employeeMatches:[{label:'송이',needsReview:true}],
    diff:[
      {status:'add'},{status:'update'},{status:'remove'},{status:'protected'},{status:'needs_review'},{status:'unchanged'},
    ], authoritative:true,
  });
  assert.equal(model.sourceType,'xlsx');
  assert.equal(model.targetMonth,'2026-10');
  assert.equal(model.effectiveDate,'2026-10-20');
  assert.equal(model.candidateRegionId,'r1');
  assert.equal(model.employeeMatches[0].needsReview,true);
  assert.deepEqual(JSON.parse(JSON.stringify(model.summary)),{add:1,update:1,remove:1,protected:1,needs_review:1,unchanged:1});
});


test('previous-month copy maps by weekday occurrence and preserves existing target schedules by default', async () => {
  const {context}=await loadUi();
  context.state.employees=[{id:'e1',name:'김나현',active:true}];
  context.state.schedules=[{employeeId:'e1',workDate:'2026-11-05',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'open'}];
  context.state.extraSchedules=[];
  context.activeEmployees=()=>context.state.employees;
  assert.equal(context.previousMonthKey('2026-11'),'2026-10');
  assert.equal(context.targetDateForOccurrence('2026-11','2026-10-01'),'2026-11-05');
  assert.equal(context.targetDateForOccurrence('2026-11','2026-10-04'),'2026-11-01');
  assert.equal(context.targetDateForOccurrence('2026-11','2026-10-29'),'');
  const bundle={schedules:[
    {employeeId:'e1',workDate:'2026-10-01',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'open'},
    {employeeId:'e1',workDate:'2026-10-02',scheduledStart:'10:00',scheduledEnd:'17:00',shiftType:'middle'},
  ],extraSchedules:[]};
  const safe=context.buildPreviousMonthCopyPlan(bundle,'2026-11',false);
  assert.equal(safe.skippedExisting,1);
  assert.equal(safe.shifts.length,1);
  assert.equal(safe.shifts[0].workDate,'2026-11-06');
  const overwrite=context.buildPreviousMonthCopyPlan(bundle,'2026-11',true);
  assert.equal(overwrite.skippedExisting,0);
  assert.equal(overwrite.shifts.length,2);
});



test('previous-month copy normalizes overlapping base and extra segments instead of blocking preview', async () => {
  const {context,source}=await loadUi();
  context.state.employees=[{id:'e1',name:'고은아',active:true}];
  context.state.schedules=[];
  context.state.extraSchedules=[];
  context.activeEmployees=()=>context.state.employees;
  const normalized=context.normalizePreviousMonthSegments([
    {employeeId:'e1',workDate:'2026-10-08',scheduledStart:'07:30',scheduledEnd:'12:00',shiftType:'other',segmentType:'base'},
    {employeeId:'e1',workDate:'2026-10-08',scheduledStart:'11:00',scheduledEnd:'17:00',shiftType:'other',segmentType:'extra'},
    {employeeId:'e1',workDate:'2026-10-08',scheduledStart:'17:00',scheduledEnd:'18:00',shiftType:'other',segmentType:'extra'},
  ]);
  assert.equal(normalized.mergedOverlapCount,1);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.rows.map((row)=>[row.scheduledStart,row.scheduledEnd]))),[
    ['07:30','17:00'],
    ['17:00','18:00'],
  ]);
  const plan=context.buildPreviousMonthCopyPlan({
    schedules:[{employeeId:'e1',workDate:'2026-10-08',scheduledStart:'07:30',scheduledEnd:'12:00',shiftType:'other'}],
    extraSchedules:[
      {employeeId:'e1',workDate:'2026-10-08',scheduledStart:'11:00',scheduledEnd:'17:00',shiftType:'other'},
      {employeeId:'e1',workDate:'2026-10-08',scheduledStart:'17:00',scheduledEnd:'18:00',shiftType:'other'},
    ],
  },'2026-11',false);
  assert.equal(plan.normalizedOverlaps,1);
  assert.equal(plan.shifts.length,2);
  assert.match(source,/겹치는 근무/);
  assert.match(source,/하나의 연속 근무구간으로 합쳐/);
});

test('previous-month preview shows the projected target calendar, not only diff counts', async () => {
  const {source,context}=await loadUi();
  context.state.employees=[
    {id:'e1',name:'김나현',active:true},
    {id:'e2',name:'장세영',active:true},
  ];
  context.activeEmployees=()=>context.state.employees;
  context.state.schedules=[
    {employeeId:'e2',workDate:'2026-11-05',scheduledStart:'08:00',scheduledEnd:'14:00',shiftType:'open'},
  ];
  context.state.extraSchedules=[];
  const model={
    targetMonth:'2026-11',
    previewSelectedDate:'',
    preview:context.buildImportPreviewModel({
      sourceType:'previous_month',
      targetMonth:'2026-11',
      effectiveDate:'2026-11-01',
      today:'2026-11-01',
      diff:[
        {status:'add',employeeId:'e1',employeeName:'김나현',workDate:'2026-11-05',before:[],after:[{scheduledStart:'13:00',scheduledEnd:'19:00',shiftType:'middle'}]},
      ],
    }),
  };
  const rows=context.previousMonthProjectedRows(model);
  assert.equal(rows.length,2);
  assert.ok(rows.some((row)=>row.employeeName==='김나현'&&row.previewStatus==='add'));
  assert.ok(rows.some((row)=>row.employeeName==='장세영'&&row.previewStatus==='existing'));
  const calendar=context.previousMonthProjectionCalendar(model);
  assert.match(calendar,/적용 후 예상 결과/);
  assert.match(calendar,/2026년 11월 근무표/);
  assert.match(calendar,/지난달 반영/);
  assert.match(calendar,/기존 유지/);
  const html=context.previousMonthPreviewMarkup(model);
  assert.match(html,/적용 전 미리보기/);
  assert.match(html,/아직 실제 일정에는 저장되지 않았습니다/);
  assert.match(html,/이 근무표로 적용/);
  assert.match(source,/적용 후 근무표 미리보기/);
  assert.match(source,/설정으로 돌아가기/);
});

test('admin Work exposes previous-month copy next to Excel import', async () => {
  const {source,context}=await loadUi();
  assert.match(source,/지난달 불러오기/);
  assert.equal(typeof context.openPreviousMonthCopy,'function');
  assert.equal(typeof context.buildPreviousMonthCopyPlan,'function');
  assert.match(source,/id="adminPreviousMonthCopy"/);
  assert.match(source,/id="adminScheduleImport"/);
});

test('schedule import entry is injected into admin Work and build ships local parser assets in order', async () => {
  assert.equal(existsSync(styleUrl), true, 'styles-schedule-import.css must exist');
  execFileSync(process.execPath,['build.mjs'],{stdio:'pipe'});
  const [html,sw,ui,core,vendor]=await Promise.all([
    readFile(new URL('../dist/index.html',import.meta.url),'utf8'),
    readFile(new URL('../dist/sw.js',import.meta.url),'utf8'),
    readFile(new URL('../dist/schedule-import.js',import.meta.url),'utf8'),
    readFile(new URL('../dist/schedule-import-core.js',import.meta.url),'utf8'),
    readFile(new URL('../dist/vendor/xlsx.full.min.js',import.meta.url),'utf8'),
  ]);
  assert.match(ui,/근무표 가져오기/);
  assert.ok(html.indexOf('/vendor/xlsx.full.min.js') < html.indexOf('/schedule-import-core.js'));
  assert.ok(html.indexOf('/schedule-import-core.js') < html.indexOf('/schedule-import.js'));
  for (const asset of ['vendor/xlsx.full.min.js','schedule-import-core.js','schedule-import.js','styles-schedule-import.css']) assert.match(sw,new RegExp(asset.replace(/[.]/g,'\\.')));
  assert.ok(core.includes('ScheduleImportCore'));
  assert.ok(vendor.length > 1000);
});
