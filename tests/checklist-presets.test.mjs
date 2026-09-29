import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

test('open and close checklist presets are concise and installable', async () => {
  const dataSource = await readFile('checklist-presets-data.js', 'utf8');
  const context = {};
  vm.runInNewContext(dataSource + '\nthis.presets = DEFAULT_CHECKLIST_PRESETS;', context);
  const presets = context.presets;

  assert.equal(presets.length, 2);
  const open = presets.find((item) => item.shiftType === 'open');
  const close = presets.find((item) => item.shiftType === 'close');
  assert.equal(open.name, '오픈조 필수 체크리스트');
  assert.equal(close.name, '마감조 필수 체크리스트');
  assert.deepEqual(Array.from(open.weekdays), [0,1,2,3,4,5,6]);
  assert.deepEqual(Array.from(close.weekdays), [0,1,2,3,4,5,6]);
  assert.equal(open.active, true);
  assert.equal(close.active, true);
  assert.ok(open.items.length >= 18);
  assert.ok(close.items.length >= 20);
  assert.ok(open.items.every((item) => item.title.length <= 28));
  assert.ok(close.items.every((item) => item.title.length <= 28));
  assert.ok(open.items.some((item) => item.title.includes('첫 샷')));
  assert.ok(open.items.some((item) => item.title.includes('품절')));
  assert.ok(open.items.some((item) => item.title.includes('재고')));
  assert.ok(close.items.some((item) => item.title.includes('머신')));
  assert.ok(close.items.some((item) => item.title.includes('수도')));
  assert.ok(close.items.some((item) => item.title.includes('퇴근 보고')));
  assert.equal(open.items.find((item) => item.title.includes('소금빵 발효'))?.required, false);
  assert.equal(close.items.find((item) => item.title.includes('여름 얼음'))?.required, false);

  const installer = await readFile('checklist-presets.js', 'utf8');
  assert.match(installer, /api\.saveChecklistTemplate/);
  assert.match(installer, /state\.checklistTemplates/);
  assert.match(installer, /기본 오픈·마감 템플릿/);

  execFileSync(process.execPath, ['build.mjs'], { stdio:'pipe' });
  const html = await readFile('dist/index.html', 'utf8');
  const sw = await readFile('dist/sw.js', 'utf8');
  assert.match(html, /checklist-presets-data\.js/);
  assert.match(html, /checklist-presets\.js/);
  assert.match(sw, /checklist-presets-data\.js/);
  assert.match(sw, /checklist-presets\.js/);
});
