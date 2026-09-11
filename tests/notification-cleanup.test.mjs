import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

test('built app has no administrator Push notification surface', async () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'pipe' });

  const [index, serviceWorker, build] = await Promise.all([
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/sw.js', import.meta.url), 'utf8'),
    readFile(new URL('../build.mjs', import.meta.url), 'utf8'),
  ]);

  for (const marker of [
    '/admin-notifications.js',
    '/styles-admin-notifications.css',
    "self.addEventListener('push'",
    "self.addEventListener('notificationclick'",
    'attendance-management-v28-notify-v1',
  ]) {
    assert.equal(index.includes(marker) || serviceWorker.includes(marker) || build.includes(marker), false, `notification marker remains: ${marker}`);
  }

  assert.equal(await exists(new URL('../dist/admin-notifications.js', import.meta.url)), false);
  assert.equal(await exists(new URL('../dist/styles-admin-notifications.css', import.meta.url)), false);
});
