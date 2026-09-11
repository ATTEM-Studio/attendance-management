import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260911_admin_notifications.sql', import.meta.url), 'utf8').catch(() => '');

test('notification schema is server-only and has stable alert keys', () => {
  assert.match(migration, /create table public\.notification_subscriptions/i);
  assert.match(migration, /endpoint text not null unique/i);
  assert.match(migration, /create table public\.notification_alerts/i);
  assert.match(migration, /alert_key text not null unique/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net/i);
});
