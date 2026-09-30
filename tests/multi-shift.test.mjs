import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

test('multi-shift admin tools render base and extra shifts for the same employee', async () => {
  assert.equal(existsSync(new URL('../multi-shift.js', import.meta.url)), true);
  const source = await readFile(new URL('../multi-shift.js', import.meta.url), 'utf8');

  const context = {
    api:{},
    state:{
      employees:[{id:'e1',name:'김송이',position:'스태프',active:true}],
      schedules:[{id:'s1',employeeId:'e1',workDate:'2026-09-30',scheduledStart:'09:00',scheduledEnd:'14:00',shiftType:'open'}],
      extraSchedules:[{id:'x1',employeeId:'e1',workDate:'2026-09-30',scheduledStart:'18:00',scheduledEnd:'22:00',shiftType:'close',segmentType:'extra'}],
    },
    session:{role:'admin',token:'t'},
    adminWorkSelectedDate:'2026-09-30',
    month:'2026-09', adminWorkMonth:'2026-09',
    selectedDateScheduleEditorMarkup:()=>'', openSelectedDateScheduleEditor(){},
    employeeById(id){return this.state.employees.find(e=>e.id===id);},
    activeEmployees(){return this.state.employees.filter(e=>e.active);},
    esc:v=>String(v??''), longDate:()=> '9월 30일 (수)', shiftTypeLabel:t=>({open:'오픈',close:'마감'}[t]||'기타'),
    dateToolShiftOptions:()=>'<option></option>', field:()=>'', icon:()=>'', externalRequest:async()=>({}),
    openSheet(){}, dismissLayer(){}, toastMsg(){}, haptic(){}, setPending(){}, renderAdmin(){},
    refreshSelectedDateContext:async()=>{}, document:{querySelector:()=>null,querySelectorAll:()=>[]},
    setTimeout(fn){fn();}, console,
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(source, context);

  const html=context.multiShiftScheduleEditorMarkup('2026-09-30');
  assert.match(html,/기본 근무/);
  assert.match(html,/추가 근무/);
  assert.match(html,/09:00/);
  assert.match(html,/18:00/);
  assert.match(html,/data-extra-schedule-save="x1"/);
  assert.match(html,/data-extra-schedule-delete="x1"/);
  assert.match(html,/\+ 추가 근무/);
  assert.match(html,/김송이/);
});

test('multi-shift client exposes schedule tool APIs and automatic checklist sync', async () => {
  const source = await readFile(new URL('../multi-shift.js', import.meta.url), 'utf8');
  assert.match(source,/attendance-schedule-tools/);
  assert.match(source,/saveExtraSchedule/);
  assert.match(source,/deleteExtraSchedule/);
  assert.match(source,/syncChecklists/);
  assert.match(source,/baseSaveChecklistTemplate/);
  assert.match(source,/baseBulkSchedule/);
  assert.match(source,/session\?\.role === 'staff'/);
});

test('multi-shift assets are included in the built PWA', async () => {
  execFileSync(process.execPath,['build.mjs'],{stdio:'pipe'});
  const [html,sw]=await Promise.all([
    readFile(new URL('../dist/index.html', import.meta.url),'utf8'),
    readFile(new URL('../dist/sw.js', import.meta.url),'utf8'),
  ]);
  assert.match(html,/multi-shift\.js/);
  assert.match(html,/styles-multi-shift\.css/);
  assert.match(sw,/multi-shift\.js/);
});
