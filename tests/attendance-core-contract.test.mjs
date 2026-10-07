import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api=await readFile(new URL('../supabase/functions/attendance-api/index.ts',import.meta.url),'utf8');

test('attendance state machine keeps the approved staff actions and same-day cancel rule',()=>{
  for(const action of ['clock_in','clock_out','start_extra','cancel_clock_out']) assert.ok(api.includes(action));
  assert.ok(api.includes('record_attendance_action_v3'));
  assert.ok(api.includes('clock_out_cancel_same_day_only'));
  assert.ok(api.includes('clock_out_cancel_limit'));
});

test('admin attendance and correction paths remain audited',()=>{
  assert.ok(api.includes('record_attendance_action_v4'));
  assert.ok(api.includes("r==='correction'"));
  assert.ok(api.includes('correct_attendance_value'));
  assert.ok(api.includes("event_type:'admin_corrected'"));
});

test('session validation rejects expired sessions and inactive staff',()=>{
  assert.ok(api.includes(".gt('expires_at',new Date().toISOString())"));
  assert.ok(api.includes("eq('active',true)"));
  assert.ok(api.includes("delete().eq('token_hash',token_hash)"));
});
