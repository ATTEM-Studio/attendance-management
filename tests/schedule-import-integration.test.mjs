import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceUrl=new URL('../schedule-import.js',import.meta.url);
const source=await readFile(sourceUrl,'utf8');

test('saved employee aliases are loaded and reused before rematching without re-upload',()=>{
  assert.match(source,/api\.listScheduleImportAliases\s*=/);
  assert.match(source,/action:['"]aliases['"]/);
  assert.match(source,/async function loadScheduleImportAliases/);
  assert.match(source,/await loadScheduleImportAliases\(\)/);
  assert.match(source,/rematchScheduleImportRows\(\)/);
});

test('unresolved employee rows expose a selector and block preview until resolved',()=>{
  assert.match(source,/data-import-alias=/);
  assert.match(source,/match\?\.needsReview/);
  assert.match(source,/id="scheduleImportPreview"[^>]*\$\{review\.length\?'disabled':''\}/);
  assert.match(source,/확인이 필요한 직원을 먼저 연결해 주세요/);
  assert.match(source,/saveScheduleImportAlias/);
});

test('preview renders all safety categories and blocks apply while review remains',()=>{
  for(const label of ['신규','변경','삭제','보호','확인 필요']) assert.match(source,new RegExp(label));
  assert.match(source,/s\.needs_review\?'disabled':''/);
  assert.match(source,/protected/);
  assert.match(source,/needs_review/);
});

test('successful apply refreshes the target month and admin work view',()=>{
  assert.match(source,/await applyScheduleImportChanges\(\)/);
  assert.match(source,/await load\(scheduleImportState\.targetMonth\)/);
  assert.match(source,/renderAdmin\(\)/);
  assert.match(source,/근무표를 적용했습니다/);
});

test('image imports use a real SHA-256 source fingerprint rather than a constant',()=>{
  assert.match(source,/await\s+file\.arrayBuffer\(\)/);
  assert.match(source,/ScheduleImportCore\.fingerprintArrayBuffer/);
  assert.doesNotMatch(source,/sourceFingerprint\s*=\s*['"]image['"]/);
});

test('client never mutates schedule arrays directly during import and API errors stay actionable',()=>{
  assert.doesNotMatch(source,/state\.schedules\s*=/);
  assert.doesNotMatch(source,/state\.extraSchedules\s*=/);
  assert.match(source,/catch\(error\)\{toastMsg\?\.\(error\.message\)/);
});
