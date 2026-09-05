import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const forbiddenBranding = ['꿈카페', '하단지점', '하단점'];

test('built app is free of store-specific branding', async () => {
  execFileSync(process.execPath, ['build.mjs'], { stdio: 'pipe' });

  const [indexHtml, manifest, coreJs, adminJs] = await Promise.all([
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/manifest.webmanifest', import.meta.url), 'utf8'),
    readFile(new URL('../dist/core.js', import.meta.url), 'utf8'),
    readFile(new URL('../dist/admin-redesign.js', import.meta.url), 'utf8'),
  ]);

  const builtFiles = {
    'index.html': indexHtml,
    'manifest.webmanifest': manifest,
    'core.js': coreJs,
    'admin-redesign.js': adminJs,
  };

  for (const [name, content] of Object.entries(builtFiles)) {
    for (const term of forbiddenBranding) {
      assert.equal(content.includes(term), false, `${name} still contains ${term}`);
    }
  }

  assert.match(indexHtml, /직원 근무 일정과 출퇴근을 관리하는 근태관리 시스템/);
  assert.match(indexHtml, /<title>근태관리<\/title>/);
  assert.match(coreJs, /근태관리/);

  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.name, '근태관리');
  assert.equal(parsedManifest.short_name, '근태관리');
});
