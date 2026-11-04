import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui,edge,migration,build]=await Promise.all([
  readFile(new URL('../community.js',import.meta.url),'utf8'),
  readFile(new URL('../supabase/functions/attendance-community/index.ts',import.meta.url),'utf8'),
  readFile(new URL('../supabase/migrations/20261104143000_community.sql',import.meta.url),'utf8'),
  readFile(new URL('../build.mjs',import.meta.url),'utf8'),
]);

test('staff gets a third community tab with attendance review requests',()=>{
  assert.match(ui,/id="tabCommunity"/);
  assert.match(ui,/커뮤니티/);
  assert.match(ui,/출퇴근 반영 확인/);
  assert.match(ui,/data-community-attendance/);
  assert.match(ui,/확인 요청/);
  assert.match(ui,/inventory_issue/);
  assert.match(ui,/personal_note/);
  assert.match(ui,/suggestion/);
});

test('admin gets a community tab with workflow statuses and replies',()=>{
  assert.match(ui,/id="adminCommunityTab"/);
  assert.match(ui,/확인 전/);
  assert.match(ui,/확인 중/);
  assert.match(ui,/처리 완료/);
  assert.match(ui,/communityCreateComment/);
  assert.match(ui,/communityUpdateStatus/);
});

test('private staff posts stay scoped to the author while community posts are shared',()=>{
  assert.match(edge,/visibility\.eq\.community,author_employee_id\.eq\./);
  assert.match(edge,/post\.visibility==='community'\|\|post\.author_employee_id===s\.employee_id/);
  assert.match(ui,/관리자에게만/);
  assert.match(ui,/communityDefaultVisibility/);
  assert.match(ui,/\['attendance_issue','personal_note'\]/);
});

test('attendance issue snapshots are rebuilt by the server from attendance rows',()=>{
  assert.match(edge,/async function attendanceSnapshot/);
  assert.match(edge,/db\.from\('attendance'\)/);
  assert.match(edge,/\.eq\('employee_id',employeeId\)/);
  assert.match(edge,/\.eq\('work_date',workDate\)/);
  assert.match(edge,/attendance_snapshot:snapshot/);
  assert.doesNotMatch(edge,/attendance_snapshot:b\./);
});

test('only admins can update workflow status',()=>{
  assert.match(edge,/if\(s\.role!=='admin'\)return out\(\{error:'관리자만 처리 상태를 변경할 수 있습니다\.'/);
  assert.match(edge,/status==='resolved'/);
});

test('community tables are RLS protected and not directly granted to browser roles',()=>{
  assert.match(migration,/alter table public\.community_posts enable row level security/);
  assert.match(migration,/alter table public\.community_comments enable row level security/);
  assert.match(migration,/revoke all on table public\.community_posts from anon, authenticated/);
  assert.match(migration,/revoke all on table public\.community_comments from anon, authenticated/);
  assert.match(migration,/grant select, insert, update, delete on table public\.community_posts to service_role/);
});

test('build ships community assets with a new PWA cache',()=>{
  assert.match(build,/community\.js/);
  assert.match(build,/styles-community\.css/);
  assert.match(build,/attendance-management-v28-hardening-v5/);
});
