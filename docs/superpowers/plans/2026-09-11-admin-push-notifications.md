# 관리자 이상 알림·Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 기기에서 알림을 한 번 허용하면 출근 미처리, 퇴근 미처리, 전날 미퇴근, 필수 체크리스트 미완료를 5분 주기로 감지해 Web Push와 앱 내 `확인 필요`에 중복 없이 전달한다.

**Architecture:** 기존 `attendance-api v6`와 출퇴근 상태 머신은 변경하지 않는다. 별도 Supabase Edge Function `attendance-notify`가 관리자 Push 구독/활성 알림 API와 Cron 스캔을 담당하고, 프론트는 `admin-notifications.js`를 별도 추가해 구독과 알림 병합/딥링크만 담당한다. Cron은 Supabase `pg_cron + pg_net`, 비밀값은 Edge Function secrets와 Supabase Vault에 보관한다.

**Tech Stack:** Vanilla JS PWA, Node 24 test runner, Supabase Postgres, Supabase Edge Functions (Deno), `@supabase/supabase-js@2`, `web-push@3.6.7`, Push API/Service Worker, pg_cron, pg_net, Supabase Vault.

**Spec:** `docs/superpowers/specs/2026-09-11-admin-push-notifications-design.md`

## Global Constraints

- v1 알림 유형은 `missing_clock_in`, `missing_clock_out`, `stale_open`, `required_checklist` 네 종류만 구현한다.
- 임계값은 출근 +10분, 퇴근 +15분, 체크리스트는 예정 퇴근시간 이후로 고정한다.
- 과거 미퇴근을 자동 종료하거나 출퇴근/근무표/체크리스트 원본 데이터를 자동 수정하지 않는다.
- Push 오류가 기존 출퇴근·근무표·관리자 기능을 막아서는 안 된다.
- 같은 `alert_key`의 Push는 1회만 fan-out 한다.
- 관리자 구독/활성 알림 API는 기존 `app_sessions` custom bearer token에서 `role = admin`만 허용한다.
- `/scan`은 `x-cron-secret`이 일치할 때만 실행한다.
- VAPID private key와 Cron secret은 저장소·프론트 번들에 포함하지 않는다.
- iPhone/iPad는 홈 화면에 추가한 PWA에서 알림 허용을 안내한다.
- 운영 Cron은 `dryRun`과 테스트 Push 검증이 끝날 때까지 활성화하지 않는다.

---

## File map

- Create `supabase/migrations/20260911_admin_notifications.sql` — 구독/알림 테이블과 인덱스, RLS, cron/net 확장 준비.
- Create `supabase/functions/attendance-notify/deno.json` — Supabase JS + web-push 의존성.
- Create `supabase/functions/attendance-notify/notification-core.mjs` — 4개 이상 조건을 순수 함수로 계산.
- Create `supabase/functions/attendance-notify/index.ts` — 관리자 API, scan, Push fan-out.
- Create `admin-notifications.js` — 관리자 기기 Push 구독, 서버 알림 조회, 로컬 경고 병합, 딥링크.
- Create `styles-admin-notifications.css` — 최초 알림 안내/상태 UI.
- Modify `admin-redesign.js` — `확인 필요` 렌더링을 notification helper 경유로 연결.
- Modify `build.mjs` — 새 JS/CSS 주입, 서비스워커 `push`/`notificationclick`, 캐시 갱신.
- Modify `.github/workflows/test.yml` — 새 JS/Core 문법 검사.
- Create `tests/notification-core.test.mjs` — 이상 감지 경계값/해결 규칙.
- Create `tests/admin-notifications.test.mjs` — 빌드/프론트 계약/딥링크/중복제거 회귀.
- Update `README.md` — 관리자 Push 사용법과 운영 비밀값 이름만 문서화.

---

### Task 1: DB 스키마와 보안 경계

**Files:**
- Create: `supabase/migrations/20260911_admin_notifications.sql`
- Test: `tests/admin-notifications.test.mjs`

**Interfaces:**
- Produces table `notification_subscriptions(endpoint,p256dh,auth,user_agent,enabled,failure_count,last_success_at,created_at,updated_at)`.
- Produces table `notification_alerts(alert_key,type,employee_id,work_date,attendance_id,severity,title,body,status,first_detected_at,last_detected_at,push_sent_at,resolved_at)`.
- Both tables have RLS enabled and no browser policies; only service-role Edge Function access is expected.

- [ ] **Step 1: Write failing migration contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20260911_admin_notifications.sql', import.meta.url), 'utf8').catch(() => '');

test('notification schema is server-only and has stable alert keys', () => {
  assert.match(sql, /create table public\.notification_subscriptions/i);
  assert.match(sql, /endpoint text not null unique/i);
  assert.match(sql, /create table public\.notification_alerts/i);
  assert.match(sql, /alert_key text not null unique/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /create extension if not exists pg_cron/i);
  assert.match(sql, /create extension if not exists pg_net/i);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- --test-name-pattern="notification schema"`
Expected: FAIL because migration does not exist.

- [ ] **Step 3: Add minimal migration**

Use exact checks:

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  enabled boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  type text not null check (type in ('missing_clock_in','missing_clock_out','stale_open','required_checklist')),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  attendance_id uuid references public.attendance(id) on delete set null,
  severity text not null check (severity in ('warning','danger')),
  title text not null,
  body text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  push_sent_at timestamptz,
  resolved_at timestamptz
);

create index notification_alerts_open_idx on public.notification_alerts(status, work_date desc);
alter table public.notification_subscriptions enable row level security;
alter table public.notification_alerts enable row level security;
```

Do not add anon/authenticated RLS policies.

- [ ] **Step 4: Run GREEN + full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add admin notification storage"`

---

### Task 2: 이상 감지 순수 로직

**Files:**
- Create: `supabase/functions/attendance-notify/notification-core.mjs`
- Create: `tests/notification-core.test.mjs`

**Interfaces:**
- `buildActiveAlerts({ now, schedules, attendance, tasks, employees }) -> Alert[]`
- Alert shape: `{ alertKey, type, employeeId, workDate, attendanceId, severity, title, body }`.
- `now` is ISO timestamp; scheduling comparisons use `+09:00` explicitly.

- [ ] **Step 1: Write boundary tests first**

Cover all of these in `tests/notification-core.test.mjs`:

```js
assert.equal(buildAt('2026-09-11T09:09:00+09:00').length, 0);
assert.equal(buildAt('2026-09-11T09:10:00+09:00')[0].type, 'missing_clock_in');
assert.equal(buildAt('2026-09-11T18:14:00+09:00', { open:true }).some(a => a.type === 'missing_clock_out'), false);
assert.equal(buildAt('2026-09-11T18:15:00+09:00', { open:true }).some(a => a.type === 'missing_clock_out'), true);
assert.equal(buildWithYesterdayOpen()[0].type, 'stale_open');
assert.equal(buildAfterEndWithRequiredPending()[0].type, 'required_checklist');
assert.equal(buildAfterEndWithRequiredComplete().length, 0);
```

Also assert exact stable keys:

```js
assert.equal(alert.alertKey, `missing_clock_in:${EMPLOYEE_ID}:2026-09-11`);
assert.equal(stale.alertKey, `stale_open:${ATTENDANCE_ID}`);
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/notification-core.test.mjs`
Expected: module/function not found.

- [ ] **Step 3: Implement `notification-core.mjs` minimally**

Required helper signatures:

```js
const kstDate = (value) => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul' }).format(new Date(value));
const scheduleAt = (workDate, hhmm) => new Date(`${workDate}T${String(hhmm).slice(0,5)}:00+09:00`).getTime();
export function buildActiveAlerts({ now, schedules = [], attendance = [], tasks = [], employees = [] }) { /* four rules */ }
```

Rules must use actual fields already present in DB/bootstrap: `workDate`, `scheduledStart`, `scheduledEnd`, `clockIn`, `clockOut`, `sourceType`, `required`, `status` after Edge mapping.

- [ ] **Step 4: Run GREEN and full suite**

Run: `node --test tests/notification-core.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: detect attendance notification conditions"`

---

### Task 3: `attendance-notify` Edge Function API + Push fan-out

**Files:**
- Create: `supabase/functions/attendance-notify/deno.json`
- Create: `supabase/functions/attendance-notify/index.ts`
- Test: `tests/admin-notifications.test.mjs`

**Interfaces:**
- `GET /config` admin auth -> `{ vapidPublicKey }`
- `POST /subscribe` admin auth body `{ endpoint, keys:{ p256dh, auth }, userAgent }` -> `{ ok:true }`
- `POST /unsubscribe` admin auth body `{ endpoint }` -> `{ ok:true }`
- `GET /alerts` admin auth -> `{ alerts:[...] }` open only.
- `POST /scan` cron auth header `x-cron-secret` body `{ dryRun:boolean }` -> `{ ok:true, dryRun, detected, created, resolved, pushed }`.

- [ ] **Step 1: Add failing source-contract tests**

Assert the new Edge source contains:

```js
['/subscribe','/unsubscribe','/alerts','/config','/scan','x-cron-secret','requireAdmin','web-push','buildActiveAlerts']
```

and `deno.json` maps:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
    "web-push": "npm:web-push@3.6.7"
  }
}
```

- [ ] **Step 2: Run RED**

Run: `npm test -- --test-name-pattern="attendance-notify"`
Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement admin authentication by copying the proven custom-session pattern**

Use SHA-256 of bearer token, query `app_sessions`, require unexpired `role='admin'`, and update `last_used_at`, matching `attendance-manual-create/index.ts`.

- [ ] **Step 4: Implement subscription/config/alerts routes**

`/subscribe` uses `upsert(..., { onConflict:'endpoint' })` and always sets `enabled:true`, `failure_count:0`, `updated_at:now`.

`/unsubscribe` sets `enabled:false` for exact endpoint; do not delete historical row.

`/alerts` selects only `status='open'`, ordered by `first_detected_at desc` and returns camelCase payload.

`/config` returns only `Deno.env.get('VAPID_PUBLIC_KEY')`; never private key.

- [ ] **Step 5: Implement `/scan` read-only source queries + alert upsert/resolve**

Query only the data required for the detector:

- active employees (`id,name,active`)
- schedules for KST today (`employee_id,work_date,scheduled_start,scheduled_end`)
- attendance where `work_date=today` OR `clock_out is null`
- task assignments for today with checklist source
- current `notification_alerts status=open`

Map snake_case DB fields to the core function input.

When `dryRun:true`, return detected alert objects without writing alerts, subscriptions, or Push state.

For real scan:

1. upsert detected alerts on `alert_key`, preserving `first_detected_at` and existing `push_sent_at`;
2. update `last_detected_at`, `status='open'`, `resolved_at=null`;
3. mark previously open keys absent from current detection as `resolved`;
4. fan-out only rows whose `push_sent_at is null`.

- [ ] **Step 6: Implement Push sending with VAPID**

```ts
webpush.setVapidDetails(
  'https://attendance-management-choi18.vercel.app',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);
```

Payload:

```ts
JSON.stringify({
  title: alert.title,
  body: alert.body,
  type: alert.type,
  alertId: alert.id,
  employeeId: alert.employee_id,
  workDate: alert.work_date,
});
```

For each enabled subscription independently:
- success -> `failure_count=0`, `last_success_at=now`;
- status 404/410 -> `enabled=false`;
- other failure -> increment `failure_count`;
- continue sending to remaining devices.

After fan-out attempts finish, set the alert's `push_sent_at=now`; do not retry the same alert in later scans.

- [ ] **Step 7: Run GREEN + syntax/type smoke checks**

Run: `npm test`
Expected: PASS.

Before deploy, inspect imports with `deno check supabase/functions/attendance-notify/index.ts` when Deno is available; otherwise use Supabase deploy compilation as the runtime compile gate.

- [ ] **Step 8: Commit**

`git commit -m "feat: add attendance notification edge function"`

---

### Task 4: 관리자 Push 구독 UI와 API client

**Files:**
- Create: `admin-notifications.js`
- Create: `styles-admin-notifications.css`
- Modify: `build.mjs`
- Modify: `.github/workflows/test.yml`
- Test: `tests/admin-notifications.test.mjs`

**Interfaces:**
- `adminNotificationSupport() -> { supported:boolean, installed:boolean, permission:string }`
- `enableAdminNotifications() -> Promise<void>`
- `disableAdminNotifications() -> Promise<void>`
- `refreshAdminServerAlerts() -> Promise<Array>`
- `mergeAdminAttention(localAttention, serverAlerts) -> Array`
- Uses existing globals `session.token`, `externalRequest`, `renderAdmin`, `toastMsg`.

- [ ] **Step 1: Write RED tests for build inclusion and UI contracts**

Assert build output source includes:

```js
'/styles-admin-notifications.css'
'/admin-notifications.js'
'Notification.requestPermission'
'pushManager.subscribe'
'mergeAdminAttention'
```

and workflow checks `node --check admin-notifications.js`.

- [ ] **Step 2: Run RED**

Run: `npm test`
Expected: FAIL on missing notification assets/contracts.

- [ ] **Step 3: Implement API bridge and support detection**

Use:

```js
const ADMIN_NOTIFY_BASE = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-notify';
api.notificationConfig = (token) => externalRequest(`${ADMIN_NOTIFY_BASE}/config`, { token });
api.notificationAlerts = (token) => externalRequest(`${ADMIN_NOTIFY_BASE}/alerts`, { token });
api.notificationSubscribe = (token, body) => externalRequest(`${ADMIN_NOTIFY_BASE}/subscribe`, { method:'POST', token, body });
api.notificationUnsubscribe = (token, body) => externalRequest(`${ADMIN_NOTIFY_BASE}/unsubscribe`, { method:'POST', token, body });
```

Support is true only when `serviceWorker`, `PushManager`, and `Notification` exist.

- [ ] **Step 4: Implement one-tap enable flow**

Only call `Notification.requestPermission()` from the click handler.

Flow:
1. wait for `navigator.serviceWorker.ready`;
2. fetch `/config`;
3. convert VAPID URL-safe base64 to `Uint8Array`;
4. `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey })`;
5. send `subscription.toJSON()` keys + `navigator.userAgent` to `/subscribe`;
6. toast `관리자 알림을 켰어요.` and rerender.

Permission `denied` must not trigger repeated browser prompts; render settings guidance instead.

- [ ] **Step 5: Implement notification card**

Place a compact card near the existing Today attention area:
- default/unsupported message;
- `알림 켜기` when supported + not subscribed;
- `알림 사용 중` + `끄기` when current endpoint is registered;
- iOS standalone hint when `navigator.standalone !== true` and platform is iOS.

No threshold settings in v1.

- [ ] **Step 6: Inject assets through `build.mjs`**

Add CSS before `</head>`, JS immediately before `boot.js`, write both to `dist/`, include both in Service Worker shell, and bump cache key from `attendance-management-v28-generic` to `attendance-management-v28-notify-v1`.

- [ ] **Step 7: Run GREEN**

Run: `node --check admin-notifications.js && node --check build.mjs && npm test && npm run build`
Expected: all PASS and `dist/index.html` references notification assets.

- [ ] **Step 8: Commit**

`git commit -m "feat: add admin notification opt-in UI"`

---

### Task 5: 앱 내 알림 병합 + Push 딥링크

**Files:**
- Modify: `admin-redesign.js`
- Modify: `admin-notifications.js`
- Modify: `styles-admin-notifications.css`
- Modify: `build.mjs` service worker template
- Test: `tests/admin-notifications.test.mjs`

**Interfaces:**
- Server alert preferred for the four Push-backed types.
- Existing local `lateMinutes` warning remains.
- `handleAdminNotificationDeepLink()` consumes `adminAlert`, `employee`, `date` query params.

- [ ] **Step 1: Write RED test for duplicate suppression**

Use a pure helper exposed in `admin-notifications.js` and assert:

```js
const merged = mergeAdminAttention(
  [{ employeeId:'e1', type:'missing_clock_in', workDate:'2026-09-11', title:'local' }],
  [{ id:'a1', employeeId:'e1', type:'missing_clock_in', workDate:'2026-09-11', title:'server' }],
);
assert.equal(merged.length, 1);
assert.equal(merged[0].title, 'server');
```

Also assert unrelated local `late` remains.

- [ ] **Step 2: Run RED**

Run: `node --test tests/admin-notifications.test.mjs`
Expected: FAIL until merge helper and hook exist.

- [ ] **Step 3: Connect `adminTodaySnapshot`/`adminAttentionMarkup`**

Keep existing local attention computation. Add explicit `type` and `workDate` to local Push-equivalent warnings. Before rendering, call `mergeAdminAttention(snapshot.attention, adminServerAlerts)`.

Server alert click behavior:
- today -> open staff quick sheet;
- past date/stale -> set `adminSection='work'`, `adminWorkView='schedule'`, `adminWorkMonth=date.slice(0,7)`, `adminWorkSelectedDate=date`, render, then call existing selected-date attendance sheet for employee/date.

- [ ] **Step 4: Add service-worker Push handlers**

Generated `sw.js` must include:

```js
self.addEventListener('push', event => {
  const data = event.data?.json?.() || {};
  event.waitUntil(self.registration.showNotification(data.title || '근태관리', {
    body:data.body || '',
    icon:'/icons/icon.svg',
    badge:'/icons/icon.svg',
    data:{ alertId:data.alertId, employeeId:data.employeeId, workDate:data.workDate },
  }));
});
```

`notificationclick` builds:

```js
const target = `/?adminAlert=${encodeURIComponent(alertId)}&employee=${encodeURIComponent(employeeId)}&date=${encodeURIComponent(workDate)}`;
```

Focus an existing same-origin window if possible and navigate it; otherwise `clients.openWindow(target)`.

- [ ] **Step 5: Preserve deep link across expired admin login**

If the query is present but `session?.role !== 'admin'`, save exact `{alertId,employeeId,workDate}` to `sessionStorage['attendance-admin-alert-destination']`. After successful `adminLogin()` + `load()`, consume once and clear it.

- [ ] **Step 6: Run GREEN/full build**

Run: `node --check admin-redesign.js && node --check admin-notifications.js && npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -m "feat: route admin alerts to attendance details"`

---

### Task 6: Secrets, Edge deploy, dry-run, then 5-minute Cron

**Files:**
- Update: `README.md`
- No secret values committed.

**Interfaces:**
- Edge secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ATTENDANCE_NOTIFY_CRON_SECRET`.
- Vault names: `attendance_notify_scan_url`, `attendance_notify_cron_secret`.
- Cron job name: `attendance-notify-every-5-minutes`.

- [ ] **Step 1: Generate secrets outside Git**

Generate VAPID pair with `npx web-push@3.6.7 generate-vapid-keys --json` and Cron secret with `openssl rand -hex 32` (or equivalent cryptographic random generator). Do not paste private values into issues, commits, logs, or frontend source.

- [ ] **Step 2: Apply Task 1 migration only**

Verify with SQL:

```sql
select to_regclass('public.notification_subscriptions'), to_regclass('public.notification_alerts');
```

Expected: both non-null. Existing attendance counts must remain unchanged.

- [ ] **Step 3: Set Edge secrets and deploy `attendance-notify`**

Set all three exact secret names and deploy with JWT verification disabled, because the function uses the existing custom bearer session and Cron secret itself.

- [ ] **Step 4: Validate auth boundaries**

Checks:
- no bearer `/alerts` -> 403;
- employee bearer `/alerts` -> 403;
- admin bearer `/alerts` -> 200;
- wrong `x-cron-secret` `/scan` -> 403.

- [ ] **Step 5: Run production-data `dryRun` before any Cron**

`POST /scan` with correct secret and `{ "dryRun": true }`.

Review every returned detected alert against current schedules/attendance/tasks. Confirm no DB `notification_alerts` rows were added by dry run.

- [ ] **Step 6: Register Vault secrets**

Store exact values:

```sql
select vault.create_secret('https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-notify/scan', 'attendance_notify_scan_url');
select vault.create_secret('<generated cron secret>', 'attendance_notify_cron_secret');
```

The second SQL is executed interactively with the generated secret and must never be committed.

- [ ] **Step 7: Enable the 5-minute Cron only after Push preview validation**

Schedule:

```sql
select cron.schedule(
  'attendance-notify-every-5-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='attendance_notify_scan_url'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='attendance_notify_cron_secret')
    ),
    body := '{"dryRun":false}'::jsonb
  );
  $$
);
```

Verify exactly one matching cron job exists.

- [ ] **Step 8: Update README without secrets**

Document only:
- 관리자: 홈 화면 추가 → 관리자 로그인 → 알림 켜기;
- supported alerts/default thresholds;
- secret variable names;
- cron job name and how to disable it with `cron.unschedule`.

- [ ] **Step 9: Commit**

`git commit -m "docs: document admin push notification operations"`

---

### Task 7: Preview + real Push verification + production handoff

**Files:**
- Modify only if verification uncovers a tested bug.

**Interfaces:**
- Feature branch Preview first.
- Production merge only after Preview + Edge + dryRun + real Push verification.

- [ ] **Step 1: Run complete local/CI verification**

Run:

```bash
node --check admin-redesign.js
node --check admin-date-tools.js
node --check admin-notifications.js
node --check build.mjs
npm test
npm run build
```

Expected: all PASS.

- [ ] **Step 2: Verify Vercel Preview assets**

Preview must be READY. Fetch and confirm HTTP 200 for:
- `/admin-notifications.js`
- `/styles-admin-notifications.css`
- `/sw.js`

and `sw.js` contains both `push` and `notificationclick` listeners.

- [ ] **Step 3: Real device subscription test**

On one supported admin device:
1. admin login;
2. tap `알림 켜기` once;
3. OS/browser allow;
4. verify one enabled subscription row appears;
5. run one controlled scan producing a testable alert;
6. verify one Push arrives;
7. click Push and verify employee/date detail opens.

Do not fabricate an employee attendance correction just to test; use a reversible test schedule/data fixture or current verified abnormal record, then clean the fixture.

- [ ] **Step 4: Verify duplicate prevention and resolution**

Run scan again with same condition -> no second Push and same `alert_key` row.
Resolve the underlying fixture -> next scan marks `status='resolved'` and the app removes it from active alerts.

- [ ] **Step 5: Verify failure isolation**

Use a controlled invalid/expired subscription fixture to confirm 404/410 disables only that subscription and a valid second subscription still receives the Push.

- [ ] **Step 6: Open PR and require latest CI success**

PR includes spec + plan + implementation. Confirm final head Actions conclusion `success` before merge.

- [ ] **Step 7: Merge to `main` and verify Production**

After merge:
- main CI success;
- Vercel target `production` is READY and references the merge SHA;
- production `/sw.js` has Push handlers;
- one admin device remains subscribed or re-subscribes successfully;
- Cron remains one active job;
- existing employee clock-in/out smoke test still works.

- [ ] **Step 8: Final safety query**

Confirm notification deployment did not mutate attendance data unexpectedly by checking notification writes are confined to `notification_alerts`/`notification_subscriptions`, and current open attendance records remain explainable by real user actions.
