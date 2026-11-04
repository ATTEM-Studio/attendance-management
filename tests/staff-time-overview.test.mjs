import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../staff-time-overview.js',import.meta.url),'utf8');
const build=await readFile(new URL('../build.mjs',import.meta.url),'utf8');

function loadContext(){
  const context={
    console,
    state:null,
    session:{role:'staff',employeeId:'e1',token:'staff-token'},
    currentTab:'today',
    liveTimer:null,
    renderToday(){},
    renderAdmin(){},
    employeeRow(employee){return '<div class="employee-row"><button class="row-action" data-employee-edit="'+employee.id+'">편집</button></div>';},
    openEmployeeManager(){},
    closeInternalViewForBack(){return false;},
    employeeById(id){return context.state?.employees?.find((row)=>row.id===id);},
    kstDate(){return '2026-11-04';},
    currentMonth(){return '2026-11';},
    monthTitle(value){const [y,m]=value.split('-');return y+'년 '+Number(m)+'월';},
    longDate(value){return value;},
    formatMinutes(value){const n=Math.max(0,Number(value)||0);const h=Math.floor(n/60),m=n%60;return h?(m?h+'시간 '+m+'분':h+'시간'):m+'분';},
    liveMinutes(){return 30;},
    esc(value){return String(value??'');},
    icon(){return '<svg></svg>';},
    toastMsg(){},
    haptic(){},
    openSheet(){},
    clearInterval(){},
    navigator:{clipboard:{writeText:async()=>{}}},
    document:{
      querySelector(){return null;},
      querySelectorAll(){return [];},
      createElement(){return {style:{},setAttribute(){},select(){},remove(){}};},
      body:{appendChild(){}},
      execCommand(){return true;},
    },
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return context;
}

test('staff monthly summary separates assigned, actual and settlement time',()=>{
  const context=loadContext();
  context.state={
    employees:[{id:'e1',name:'김나현',active:true}],
    schedules:[
      {employeeId:'e1',workDate:'2026-11-01',scheduledStart:'09:00',scheduledEnd:'17:00'},
      {employeeId:'e1',workDate:'2026-11-02',scheduledStart:'10:00',scheduledEnd:'16:00'},
      {employeeId:'e1',workDate:'2026-11-10',scheduledStart:'09:00',scheduledEnd:'18:00'},
    ],
    extraSchedules:[
      {employeeId:'e1',workDate:'2026-11-01',scheduledStart:'18:00',scheduledEnd:'20:00'},
    ],
    attendance:[
      {employeeId:'e1',workDate:'2026-11-01',sessionType:'base',clockIn:'2026-11-01T09:15:00+09:00',clockOut:'2026-11-01T17:10:00+09:00',workMinutes:475},
      {employeeId:'e1',workDate:'2026-11-01',sessionType:'extra',clockIn:'2026-11-01T18:10:00+09:00',clockOut:'2026-11-01T19:40:00+09:00',workMinutes:90},
    ],
  };
  const summary=context.staffTimeMonthSummary('e1','2026-11-04');
  assert.equal(summary.assigned,960); // 8h + 6h + 2h, future Nov 10 excluded
  assert.equal(summary.actual,565);
  assert.equal(summary.settlement,570); // assigned 8h base + actual 90m extra
  assert.equal(summary.delta,-5);
  assert.deepEqual([...summary.missingDates],['2026-11-02']);
});

test('staff share text is ready to send to an administrator',()=>{
  const context=loadContext();
  const text=context.staffTimeShareText({name:'김나현'},{
    monthKey:'2026-11',assigned:600,actual:585,settlement:600,delta:-15,missingDates:['2026-11-03'],
  });
  assert.match(text,/근태 확인 요청/);
  assert.match(text,/할당 누적: 10시간/);
  assert.match(text,/실제 기록: 9시간 45분/);
  assert.match(text,/근태 기록 없음: 11\/03/);
});

test('administrator staff preview is read-only and never swaps persisted login',()=>{
  assert.match(source,/관리자 · 읽기 전용/);
  assert.match(source,/직원 화면 미리보기/);
  assert.match(source,/data-staff-preview/);
  assert.match(source,/button\.disabled=true/);
  assert.doesNotMatch(source,/saveSession\s*\(/);
  assert.match(source,/session=\{\.\.\.adminSession,role:'staff',employeeId\}/);
  assert.match(source,/session=adminSession/);
});

test('employee manager adds a direct staff-page preview action',()=>{
  const context=loadContext();
  const html=context.employeeRow({id:'e1',name:'김나현',position:'스태프',active:true});
  assert.match(html,/data-staff-preview="e1"/);
  assert.match(html,/화면 보기/);
  assert.match(html,/data-employee-edit="e1"/);
});

test('build ships the staff time overview assets with a fresh PWA cache',()=>{
  assert.match(build,/staff-time-overview\.js/);
  assert.match(build,/styles-staff-time-overview\.css/);
  assert.match(build,/attendance-management-v28-hardening-v3/);
});
