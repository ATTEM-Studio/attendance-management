import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL('../supabase/migrations/20260911_fix_stale_open_attendance.sql', import.meta.url);
const migrationPath = fileURLToPath(migrationUrl);

test('today attendance ignores an unfinished session from a previous date', () => {
  assert.ok(
    existsSync(migrationPath),
    'a migration must scope the open-attendance lookup to the current KST work date',
  );

  const sql = readFileSync(migrationPath, 'utf8');
  const openLookup = sql.match(/select \* into v_open[\s\S]*?for update;/i)?.[0] || '';

  assert.match(openLookup, /work_date\s*=\s*v_today/i);
  assert.match(openLookup, /clock_out\s+is\s+null/i);
});
