import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('inspect schedule and task assignment contracts', async () => {
  await import('../build.mjs');
  for (const file of ['dist/admin-task.js','dist/api.js','dist/core.js','dist/admin-schedule.js']) {
    try {
      const source = await readFile(file, 'utf8');
      const lines = source.split('\n');
      const hits = [];
      lines.forEach((line, index) => {
        if (/assignTask|task-assignment|taskAssignments|saveTask|scheduledStart|sessionType|start_extra|bulkSchedule/i.test(line)) {
          hits.push(lines.slice(Math.max(0,index-3), Math.min(lines.length,index+10)).join('\n'));
        }
      });
      console.log('\n### ' + file + '\n' + hits.slice(0, 140).join('\n---\n'));
    } catch (error) {
      console.log('\n### missing ' + file + ': ' + error.message);
    }
  }
});
