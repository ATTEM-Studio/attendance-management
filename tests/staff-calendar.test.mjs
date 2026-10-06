import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

test('staff calendar models past, today, future and extra shifts', async () => {
  const source = await readFile('staff-calendar.js','utf8');
  const context = {
    state:{
      schedules:[
        {employeeId:'e1',workDate:'2026-10-05',scheduledStart:'09:00',scheduledEnd:'14:00',shiftType:'open'},
        {employeeId:'e1',workDate:'2026-10-06',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'open'},
        {employeeId:'e1',workDate:'2026-10-08',scheduledStart:'09:00',scheduledEnd:'14:00',shiftType:'open'},
      ],
      extraSchedules:[
        {id:'x1',employeeId:'e1',workDate:'2026-10-08',scheduledStart:'18:00',scheduledEnd:'22:00',shiftType:'close',segmentType:'extra'},
      ],
      attendance:[
        {employeeId:'e1',workDate:'2026-10-05',clockIn:'2026-10-05T09:03:00+09:00',clockOut:'2026-10-05T14:01:00+09:00',sessionNo:1},
      ],
    },
    session:{role:'staff',employeeId:'e1',token:'t'},
    month:'2026-10',
    kstDate:()=> '2026-10-06',
    esc:(v)=>String(v??''),
    shiftTypeLabel:(v)=>({open:'오픈',middle:'미들',close:'마감',other:'기타'}[v]||v),
    fmtTime:(v)=> String(v||'').slice(11,16),
    dailyAttendanceSummary:(employeeId,date)=>({
      sessions:(context.state.attendance||[]).filter((row)=>row.employeeId===employeeId&&row.workDate===date),
      open:null,
      completed:(context.state.attendance||[]).filter((row)=>row.employeeId===employeeId&&row.workDate===date&&row.clockOut),
    }),
    document:{querySelector:()=>null,querySelectorAll:()=>[]},
    renderStaff(){},
    load:async()=>{},
    console,
    setTimeout(fn){fn();},
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(source,context);

  const past=context.staffCalendarDayModel('e1','2026-10-05','2026-10-06');
  const today=context.staffCalendarDayModel('e1','2026-10-06','2026-10-06');
  const future=context.staffCalendarDayModel('e1','2026-10-08','2026-10-06');

  assert.equal(past.period,'past');
  assert.equal(past.status,'done');
  assert.equal(today.period,'today');
  assert.equal(today.status,'scheduled');
  assert.equal(future.period,'future');
  assert.equal(future.segments.length,2);
  assert.match(future.summary,/09:00–14:00/);
  assert.match(future.summary,/18:00–22:00/);
});

test('staff calendar markup is read-only and month navigable', async () => {
  const source = await readFile('staff-calendar.js','utf8');
  assert.match(source,/내 근무 일정/);
  assert.match(source,/data-staff-calendar-prev/);
  assert.match(source,/data-staff-calendar-next/);
  assert.match(source,/data-staff-calendar-date/);
  assert.doesNotMatch(source,/saveExtraSchedule|bulkSchedule|deleteExtraSchedule/);
});

test('staff calendar assets are included in built PWA', async () => {
  execFileSync(process.execPath,['build.mjs'],{stdio:'pipe'});
  const [html,sw]=await Promise.all([
    readFile('dist/index.html','utf8'),
    readFile('dist/sw.js','utf8'),
  ]);
  assert.match(html,/staff-calendar\.js/);
  assert.match(html,/styles-staff-calendar\.css/);
  assert.match(sw,/staff-calendar\.js/);
  assert.match(sw,/styles-staff-calendar\.css/);
});
