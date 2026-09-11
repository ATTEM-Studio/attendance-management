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

test('open-session uniqueness is isolated by employee and work date', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  assert.match(
    sql,
    /drop\s+index\s+if\s+exists\s+public\.attendance_one_open_session_per_employee_idx/i,
  );
  assert.match(
    sql,
    /create\s+unique\s+index\s+attendance_one_open_session_per_employee_idx[\s\S]*?\(employee_id\s*,\s*work_date\)[\s\S]*?clock_in\s+is\s+not\s+null[\s\S]*?clock_out\s+is\s+null/i,
  );
});
