import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('inspect checklist API wiring', async () => {
  await import('../build.mjs');
  const admin = await readFile('dist/admin-checklist.js', 'utf8');
  const api = await readFile('dist/api.js', 'utf8');
  const start = admin.indexOf('async function saveChecklistTemplate');
  const end = admin.indexOf('function openChecklistDeleteSheet', start);
  console.log('\n### saveChecklistTemplate block\n' + admin.slice(start, end));
  console.log('\n### checklist api lines\n' + api.split('\n').filter((line) => /ChecklistTemplate/.test(line)).join('\n'));
});
