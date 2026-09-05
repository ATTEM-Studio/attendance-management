import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const legacyBrand = '\uafc8\uce74\ud398';
const legacyBranch = '\ud558\ub2e8\uc9c0\uc810';
const legacyShortBranch = '\ud558\ub2e8\uc810';
const forbiddenBranding = [legacyBrand, legacyBranch, legacyShortBranch];

test('built app and repository docs are free of store-specific branding', async () => {
  execFileSync(process.execPath, ['build.mjs'], { stdio: 'pipe' });

  const [indexHtml, manifest, coreJs, adminJs, readme] = await Promise.all([
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/manifest.webmanifest', import.meta.url), 'utf8'),
    readFile(new URL('../dist/core.js', import.meta.url), 'utf8'),
    readFile(new URL('../dist/admin-redesign.js', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
  ]);

  const checkedFiles = {
    'index.html': indexHtml,
    'manifest.webmanifest': manifest,
    'core.js': coreJs,
    'admin-redesign.js': adminJs,
    'README.md': readme,
  };

  for (const [name, content] of Object.entries(checkedFiles)) {
    for (const term of forbiddenBranding) {
      assert.equal(content.includes(term), false, `${name} still contains store-specific branding`);
    }
  }

  assert.match(indexHtml, /직원 근무 일정과 출퇴근을 관리하는 근태관리 시스템/);
  assert.match(indexHtml, /<title>근태관리<\/title>/);
  assert.match(coreJs, /function displayStoreName/);
  assert.match(coreJs, /근태관리/);
  assert.match(adminJs, /displayStoreName\(\)/);
  assert.match(readme, /범용 근태관리 PWA/);

  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.name, '근태관리');
  assert.equal(parsedManifest.short_name, '근태관리');

  const helperMatch = coreJs.match(/function displayStoreName\(value = state\?\.storeName\) \{[\s\S]*?\n\}/);
  assert.ok(helperMatch, 'displayStoreName helper must exist in built core.js');

  const sandbox = { input: `${legacyBrand} ${legacyBranch}`, result: null };
  vm.runInNewContext(`${helperMatch[0]}; result = displayStoreName(input);`, sandbox);
  assert.equal(sandbox.result, '근태관리', 'legacy store names must be neutralized at runtime');
});
