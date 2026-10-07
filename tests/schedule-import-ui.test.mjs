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
