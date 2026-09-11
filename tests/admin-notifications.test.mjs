import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260911_admin_notifications.sql', import.meta.url), 'utf8').catch(() => '');
const edge = await readFile(new URL('../supabase/functions/attendance-notify/index.ts', import.meta.url), 'utf8').catch(() => '');
const deno = await readFile(new URL('../supabase/functions/attendance-notify/deno.json', import.meta.url), 'utf8').catch(() => '');
const client = await readFile(new URL('../admin-notifications.js', import.meta.url), 'utf8').catch(() => '');
const build = await readFile(new URL('../build.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');

test('notification schema is server-only and has stable alert keys', () => {
  assert.match(migration, /create table public\.notification_subscriptions/i);
  assert.match(migration, /endpoint text not null unique/i);
  assert.match(migration, /create table public\.notification_alerts/i);
  assert.match(migration, /alert_key text not null unique/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net/i);
});

test('attendance-notify edge function exposes protected admin and cron routes', () => {
  for (const marker of ['/subscribe','/unsubscribe','/alerts','/config','/scan','x-cron-secret','requireAdmin','web-push','buildActiveAlerts']) {
    assert.ok(edge.includes(marker), `missing ${marker}`);
  }
  const imports = JSON.parse(deno || '{}').imports || {};
  assert.equal(imports['@supabase/supabase-js'], 'npm:@supabase/supabase-js@2');
  assert.equal(imports['web-push'], 'npm:web-push@3.6.7');
});

test('admin notification client supports one-tap Push subscription', () => {
  for (const marker of ['Notification.requestPermission', 'pushManager.subscribe', 'adminNotificationSupport', 'enableAdminNotifications', 'disableAdminNotifications', 'refreshAdminServerAlerts', 'mergeAdminAttention']) {
    assert.ok(client.includes(marker), `missing ${marker}`);
  }
  assert.ok(build.includes('/styles-admin-notifications.css'));
  assert.ok(build.includes('/admin-notifications.js'));
  assert.ok(workflow.includes('node --check admin-notifications.js'));
});
