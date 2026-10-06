import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const coreUrl=new URL('../supabase/functions/attendance-schedule-import/import-core.mjs',import.meta.url);
async function core(){assert.equal(existsSync(coreUrl),true,'import-core.mjs must exist');return import(`${coreUrl.href}?t=${Date.now()}-${Math.random()}`);}

const baseInput=()=>({
  targetMonth:'2026-10',effectiveDate:'2026-10-15',today:'2026-10-15',authoritative:true,
  shifts:[],baseSchedules:[],extraSchedules:[],attendance:[],
});

test('diff classifies add update remove unchanged and never removes for partial input',async()=>{
  const {buildScheduleImportDiff,summarizeImportDiff}=await core();
  const input=baseInput();
  input.baseSchedules=[
    {id:'s1',employeeId:'e1',workDate:'2026-10-20',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'other'},
    {id:'s2',employeeId:'e2',workDate:'2026-10-21',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'other'},
    {id:'s3',employeeId:'e3',workDate:'2026-10-22',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'other'},
  ];
  input.shifts=[
    {employeeId:'e1',employeeLabel:'A',workDate:'2026-10-20',scheduledStart:'10:00',scheduledEnd:'18:00',shiftType:'other'},
    {employeeId:'e2',employeeLabel:'B',workDate:'2026-10-21',scheduledStart:'09:00',scheduledEnd:'18:00',shiftType:'other'},
    {employeeId:'e4',employeeLabel:'D',workDate:'2026-10-23',scheduledStart:'12:00',scheduledEnd:'16:00',shiftType:'other'},
  ];
  const diff=buildScheduleImportDiff(input);
  assert.equal(diff.find((r)=>r.employeeId==='e1').status,'update');
  assert.equal(diff.find((r)=>r.employeeId==='e2').status,'unchanged');
  assert.equal(diff.find((r)=>r.employeeId==='e3').status,'remove');
  assert.equal(diff.find((r)=>r.employeeId==='e4').status,'add');
  assert.deepEqual(summarizeImportDiff(diff),{add:1,update:1,remove:1,protected:0,needs_review:0,unchanged:1});

  const partial=buildScheduleImportDiff({...input,authoritative:false});
  assert.equal(partial.some((r)=>r.employeeId==='e3'&&r.status==='remove'),false);
});

test('pre-effective rows are ignored and attendance turns mutation into protected',async()=>{
  const {buildScheduleImportDiff}=await core();
  const input=baseInput();
  input.baseSchedules=[
    {id:'old',employeeId:'e1',workDate:'2026-10-14',scheduledStart:'09:00',scheduledEnd:'18:00'},
    {id:'today',employeeId:'e1',workDate:'2026-10-15',scheduledStart:'09:00',scheduledEnd:'18:00'},
  ];
  input.shifts=[
    {employeeId:'e1',workDate:'2026-10-14',scheduledStart:'10:00',scheduledEnd:'18:00'},
    {employeeId:'e1',workDate:'2026-10-15',scheduledStart:'10:00',scheduledEnd:'18:00'},
  ];
  input.attendance=[{employeeId:'e1',workDate:'2026-10-15',clockIn:'2026-10-15T00:02:00Z',clockOut:null}];
  const diff=buildScheduleImportDiff(input);
  assert.equal(diff.some((r)=>r.workDate==='2026-10-14'),false);
  const protectedRow=diff.find((r)=>r.workDate==='2026-10-15');
  assert.equal(protectedRow.status,'protected');
  assert.match(protectedRow.detail,/출퇴근/);
});

test('preview to apply race is protected when attendance appears after preview',async()=>{
  const {buildScheduleImportDiff}=await core();
  const input=baseInput();
  input.baseSchedules=[{id:'s1',employeeId:'e1',workDate:'2026-10-20',scheduledStart:'09:00',scheduledEnd:'18:00'}];
  input.shifts=[{employeeId:'e1',workDate:'2026-10-20',scheduledStart:'10:00',scheduledEnd:'18:00'}];
  const preview=buildScheduleImportDiff(input);
  assert.equal(preview[0].status,'update');
  const applyCheck=buildScheduleImportDiff({...input,attendance:[{employeeId:'e1',workDate:'2026-10-20',clockIn:'2026-10-20T01:00:00Z'}]});
  assert.equal(applyCheck[0].status,'protected');
});

test('multiple segments stay ordered as base plus extras and overlaps fail validation',async()=>{
  const {validateImportPayload,buildScheduleImportDiff}=await core();
  const input=baseInput();
  input.shifts=[
    {employeeId:'e1',workDate:'2026-10-20',scheduledStart:'18:00',scheduledEnd:'22:00'},
    {employeeId:'e1',workDate:'2026-10-20',scheduledStart:'09:00',scheduledEnd:'14:00'},
  ];
  assert.equal(validateImportPayload(input).ok,true);
  const diff=buildScheduleImportDiff(input);
  assert.equal(diff[0].status,'add');
  assert.deepEqual(diff[0].after.map((r)=>[r.segmentType,r.scheduledStart,r.scheduledEnd]),[
    ['base','09:00','14:00'],['extra','18:00','22:00'],
  ]);

  const overlap=validateImportPayload({...input,shifts:[
    {employeeId:'e1',workDate:'2026-10-20',scheduledStart:'09:00',scheduledEnd:'14:00'},
    {employeeId:'e1',workDate:'2026-10-20',scheduledStart:'13:00',scheduledEnd:'18:00'},
  ]});
  assert.equal(overlap.ok,false);
  assert.match(overlap.error,/겹/);
});

test('unmatched imported employee is needs_review rather than a mutation',async()=>{
  const {buildScheduleImportDiff}=await core();
  const input=baseInput();
  input.shifts=[{employeeLabel:'미확인',workDate:'2026-10-20',scheduledStart:'09:00',scheduledEnd:'14:00'}];
  const diff=buildScheduleImportDiff(input);
  assert.equal(diff.length,1);
  assert.equal(diff[0].status,'needs_review');
});
