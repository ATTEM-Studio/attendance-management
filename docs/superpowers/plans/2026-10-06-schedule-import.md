# 근무표 자동 가져오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Excel 또는 근무표 캡처 이미지를 읽어 직원별 날짜/시간 근무를 정규화하고, 업로드 당일(또는 미래의 선택일) 이후 일정만 기존 근무표와 비교·미리보기·안전 적용하는 관리자 기능을 만든다.

**Architecture:** Excel은 브라우저에서 구조적으로 파싱하고, 이미지는 관리자 인증이 걸린 Supabase Edge Function이 서버 측 비전 분석으로 정규화한다. 두 입력은 공통 `ImportedShift` 형태로 합쳐지고, 서버가 기존 `schedules`/`extra_schedules`/`attendance`를 기준으로 diff를 다시 계산한 뒤 PostgreSQL 함수 한 번으로 원자적으로 반영한다. 기존 수동 근무 편집과 출퇴근 경로는 변경하지 않고, 가져오기 기능은 별도 모듈과 별도 Edge Function으로 격리한다.

**Tech Stack:** Vanilla JS, Node.js >=20, Node test runner, `xlsx@0.18.5` browser bundle, Supabase Postgres + Edge Functions (Deno/TypeScript), OpenAI Responses API image input via server-side `OPENAI_API_KEY` (model is configurable with `OPENAI_SCHEDULE_VISION_MODEL`; default `gpt-6-luna`).

**Spec:** `docs/superpowers/specs/2026-10-06-schedule-import-design.md`

## Global Constraints

- 적용 기준일의 기본값은 KST 업로드 당일이며 과거 날짜로 낮출 수 없다.
- 적용 기준일 이전 일정은 어떤 가져오기에서도 수정·삭제하지 않는다.
- `attendance.clock_in` 또는 `attendance.clock_out`이 있는 직원/날짜는 자동 변경하지 않고 `protected`로 남긴다.
- 동일 직원/동일 날짜의 첫 구간은 `schedules`, 두 번째 이후 구간은 `extra_schedules`로 저장한다.
- 잘린 캡처나 일부 범위 입력에서는 자동 삭제를 생성하지 않는다.
- 원본 Excel 파일은 브라우저에서 처리하고 서버에 장기 저장하지 않는다.
- 이미지 원본은 분석 요청 중에만 전송하며 DB나 Storage에 저장하지 않는다.
- 비전 API 키와 Supabase service-role key는 브라우저에 노출하지 않는다.
- 기존 수동 일정 추가/수정, 추가 근무, 출퇴근, 근태 수정 흐름은 그대로 유지한다.

## Review Focus

- 급여표·회의 메모·발주표가 같은 workbook에 있어도 실제 근무표 블록을 우선하고 나머지는 후보에서 낮게 평가하는지 — Task 1에서 복합 workbook fixture로 고정한다.
- 월~일 전체가 보이지 않는 잘린 이미지/부분표가 `authoritative=false`가 되어 기존 근무 삭제를 만들지 않는지 — Task 4에서 이미지 분석 계약 테스트로 고정한다.
- `송이`처럼 축약명이 복수 직원과 매칭될 수 있을 때 임의 확정하지 않고 해당 행만 `needs_review`가 되는지 — Task 1에서 매칭 테스트로 고정한다.
- 오늘 수정본을 올린 직후 직원이 실제 출근해 preview와 apply 사이 상태가 바뀌어도 서버 재검증으로 변경이 막히는지 — Task 3에서 race-condition 적용 테스트로 고정한다.
- 같은 직원이 하루 두 구간 근무할 때 순서가 base/extra로 안정적으로 저장되고 겹치는 구간은 전체 적용을 실패시키는지 — Task 3에서 트랜잭션 테스트로 고정한다.

---

### Task 1: Excel 파서·정규화·직원 매칭 코어

**Files:**
- Create: `schedule-import-core.js`
- Create: `tests/schedule-import-core.test.mjs`
- Create: `tests/fixtures/schedule-import-complex.json`
- Modify: `package.json`
- Create/Modify: `package-lock.json`

**Interfaces:**
- Consumes: `XLSX` 객체를 인자로 받는 브라우저/Node 공용 파서 어댑터.
- Produces: `globalThis.ScheduleImportCore` with `detectScheduleRegions(workbook, XLSX)`, `parseScheduleRegion(workbook, XLSX, region)`, `expandWeeklyPattern(rows, targetMonth, effectiveDate)`, `matchEmployeeLabel(label, employees, aliases)`, `normalizeImportedShifts(rows)`, `fingerprintArrayBuffer(buffer)`.
- `detectScheduleRegions` returns `[{id,sheetName,range,score,reasons,authoritative}]` sorted descending.
- `normalizeImportedShifts` returns `ImportedShift[]` with `employeeLabel`, `workDate`, `scheduledStart`, `scheduledEnd`, `shiftType`, `confidence`, `notes`.

- [ ] **Step 1: Write failing parser and matcher tests**

Add tests that assert:
- a workbook-shaped fixture containing schedule + payroll + meeting memo ranks the schedule region first;
- repeating weekday blocks are expanded only to dates `>= effectiveDate` within `targetMonth`;
- `09:00 - 18:00`, `9-6`, `6-10 (4)` normalize to 24-hour `HH:mm` using the time-grid context when needed;
- multiple segments for one employee/day remain separate and sorted;
- exact active employee match succeeds;
- a unique surname-omitted match is suggested only when unambiguous;
- two possible abbreviated matches return `needsReview:true` and no `employeeId`.

- [ ] **Step 2: Run Task 1 tests and verify RED**

Run: `node --test tests/schedule-import-core.test.mjs`

Expected: FAIL because `schedule-import-core.js` and exported API do not exist.

- [ ] **Step 3: Add `xlsx@0.18.5` and implement the minimal pure core**

Run: `npm install xlsx@0.18.5 --save`

Implement the interfaces above without any DOM or network dependency. `schedule-import-core.js` must attach one stable API object to `globalThis.ScheduleImportCore` so the same file can be side-effect imported by Node tests and loaded as a classic script in the PWA.

- [ ] **Step 4: Run Task 1 tests and full suite**

Run: `node --test tests/schedule-import-core.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add package.json package-lock.json schedule-import-core.js tests/schedule-import-core.test.mjs tests/fixtures/schedule-import-complex.json
git commit -m "feat: add schedule import parser core"
```

### Task 2: 관리자 가져오기 UI·Excel 업로드·미리보기 모델

**Files:**
- Create: `schedule-import.js`
- Create: `styles-schedule-import.css`
- Create: `tests/schedule-import-ui.test.mjs`
- Modify: `build.mjs`
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: `ScheduleImportCore`, existing global `state.employees`, `state.schedules`, `state.extraSchedules`, `session.token`, `month`, `load()`, `renderAdmin()`.
- Produces: `openScheduleImport()`, `renderScheduleImportStep(state)`, `buildImportPreviewModel({shifts,existing,attendance,effectiveDate,authoritative})`, and browser API methods `api.previewScheduleImport`, `api.applyScheduleImport`, `api.analyzeScheduleImage`, `api.saveScheduleImportAlias`.
- Build output must contain `/vendor/xlsx.full.min.js`, `/schedule-import-core.js`, `/schedule-import.js`, `/styles-schedule-import.css` and include them in the service-worker shell.

- [ ] **Step 1: Write failing UI/build tests**

Assert that built `dist/index.html` contains a `근무표 가져오기` entry in the admin Work area and loads the local XLSX vendor script before import scripts. Assert that the UI model exposes source type, target month, effective date (minimum today KST), candidate region selection, employee matching, and summary counts for `add/update/remove/protected/needs_review/unchanged`.

- [ ] **Step 2: Run Task 2 tests and verify RED**

Run: `node --test tests/schedule-import-ui.test.mjs`

Expected: FAIL because the import UI/build assets do not exist.

- [ ] **Step 3: Implement the Excel upload wizard and preview-only client flow**

Add a four-stage sheet/wizard:
1. 파일 선택 (`.xlsx`, `.png`, `.jpg`, `.jpeg`, `.webp`)
2. 근무표 후보/대상 월/적용 시작일 선택
3. 직원 매칭 및 확인 필요 해소
4. 변경 요약과 적용 버튼

Excel stays local: read `ArrayBuffer`, compute SHA-256 fingerprint, call `detectScheduleRegions`, parse the selected region, expand weekdays, then call the server preview endpoint. Do not mutate schedules from the client.

- [ ] **Step 4: Update build pipeline without introducing a new bundler**

Copy `node_modules/xlsx/dist/xlsx.full.min.js` to `dist/vendor/xlsx.full.min.js`; inject CSS/scripts in deterministic order; add all new local assets to the service-worker shell; bump the cache key.

- [ ] **Step 5: Run UI/build regression**

Run: `node --test tests/schedule-import-ui.test.mjs && npm test && npm run build`

Expected: PASS, build exit code 0, and no existing admin/staff asset removed.

- [ ] **Step 6: Commit Task 2**

```bash
git add schedule-import.js styles-schedule-import.css build.mjs .github/workflows/test.yml tests/schedule-import-ui.test.mjs
git commit -m "feat: add schedule import admin flow"
```

### Task 3: 서버 diff·보호 규칙·원자적 적용

**Files:**
- Create: `supabase/functions/attendance-schedule-import/import-core.mjs`
- Create: `tests/schedule-import-server-core.test.mjs`
- Create: `supabase/migrations/20261006_schedule_import.sql`
- Create: `tests/schedule-import-migration-contract.test.mjs`

**Interfaces:**
- Consumes: normalized `ImportedShift[]`, current base schedules, extra schedules, attendance rows, `targetMonth`, `effectiveDate`, `authoritative`.
- Produces from pure core: `validateImportPayload(input)`, `buildScheduleImportDiff(input)`, `summarizeImportDiff(diff)`.
- DB migration produces tables `schedule_import_runs`, `schedule_import_aliases` and RPC `public.apply_schedule_import(p_target_month text, p_effective_date date, p_authoritative boolean, p_shifts jsonb) returns jsonb`.
- RPC is `SECURITY DEFINER`, revoked from `public/anon/authenticated`, executable only by `service_role`.

- [ ] **Step 1: Write failing server diff tests**

Assert `add/update/remove/unchanged/protected/needs_review` classification; `remove` is impossible when `authoritative=false`; pre-effective-date rows are ignored; rows with attendance are protected; multiple segments sort to base + extras; overlapping imported segments fail validation.

- [ ] **Step 2: Add the preview→apply race-condition RED test**

Model preview without attendance, then apply input with a newly-created attendance row and assert the apply-side planner returns `protected` rather than `update/remove`.

- [ ] **Step 3: Run pure server tests and verify RED**

Run: `node --test tests/schedule-import-server-core.test.mjs tests/schedule-import-migration-contract.test.mjs`

Expected: FAIL because server core and migration are absent.

- [ ] **Step 4: Implement pure server diff helpers**

`buildScheduleImportDiff` groups by `employeeId + workDate`, compares ordered segment arrays, and never creates removal changes for non-authoritative input. It must treat any attendance on the employee/date with non-null `clock_in` or `clock_out` as protected.

- [ ] **Step 5: Implement DB schema and atomic RPC**

Migration requirements:
- `schedule_import_runs` matches spec metadata and stores no source file bytes;
- `schedule_import_aliases(label_key text primary key, employee_id uuid references employees(id), original_label text, created_at timestamptz, updated_at timestamptz)` with RLS enabled and no browser policies;
- `apply_schedule_import` re-validates effective date against KST current date, rejects shifts outside target month, rechecks attendance protection, updates an existing base schedule in place when possible, removes future generated checklist assignments tied to a base schedule before an authorized removal if the FK requires it, reconciles `extra_schedules`, rejects overlapping segments, and runs as one SQL transaction by virtue of one RPC call;
- any SQL exception aborts the whole call.

- [ ] **Step 6: Run server tests and full suite**

Run: `node --test tests/schedule-import-server-core.test.mjs tests/schedule-import-migration-contract.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add supabase/functions/attendance-schedule-import/import-core.mjs supabase/migrations/20261006_schedule_import.sql tests/schedule-import-server-core.test.mjs tests/schedule-import-migration-contract.test.mjs
git commit -m "feat: add atomic schedule import engine"
```

### Task 4: Edge Function API + 이미지 비전 분석

**Files:**
- Create: `supabase/functions/attendance-schedule-import/index.ts`
- Create: `supabase/functions/attendance-schedule-import/deno.json`
- Create: `supabase/functions/attendance-schedule-import/vision-adapter.mjs`
- Create: `tests/schedule-import-vision.test.mjs`
- Create: `tests/schedule-import-edge-contract.test.mjs`

**Interfaces:**
- Consumes: existing `app_sessions` custom bearer session pattern; `OPENAI_API_KEY`; optional `OPENAI_SCHEDULE_VISION_MODEL`, default `gpt-6-luna`; Task 3 diff helpers/RPC.
- Produces POST actions:
  - `analyze_image`: `{imageDataUrl,mimeType,targetMonth,effectiveDate}` → `{regions,rows,authoritative,confidence,warnings}`
  - `preview`: `{sourceType,sourceName,sourceFingerprint,targetMonth,effectiveDate,authoritative,shifts}` → `{runId,diff,summary}`
  - `apply`: same normalized input + `runId` → `{runId,summary,appliedChanges}`
  - `save_alias`: `{label,employeeId}` → `{ok:true}`
- Only `admin` sessions may call these actions.

- [ ] **Step 1: Write failing Edge/vision contract tests**

Assert:
- staff/unauthenticated requests are rejected;
- unsupported MIME types and oversized image payloads are rejected before any model request;
- full Monday–Sunday image with intact time axis may return `authoritative=true`;
- image missing weekday headers or time axis must return `authoritative=false` and cannot create removals downstream;
- model output with invalid time, duplicate/overlapping segments, or unknown structure is converted to warnings/`needs_review`, never silently applied.

- [ ] **Step 2: Run Task 4 tests and verify RED**

Run: `node --test tests/schedule-import-vision.test.mjs tests/schedule-import-edge-contract.test.mjs`

Expected: FAIL because function/adapter do not exist.

- [ ] **Step 3: Implement `vision-adapter.mjs` using the OpenAI Responses API**

Implement `analyzeScheduleImage({imageDataUrl,mimeType,targetMonth,effectiveDate,apiKey,model})` with image input and a strict JSON schema matching the normalized candidate contract. The prompt must tell the model to use both visible text and cell geometry/color blocks, mark uncertainty explicitly, and never infer missing cropped days as off-days. Validate the returned JSON again in code before returning it.

- [ ] **Step 4: Implement authenticated Edge Function actions**

Reuse the established SHA-256 `app_sessions` validation pattern. `preview` must fetch authoritative employees/schedules/extras/attendance from Postgres, recompute diff server-side, insert one `schedule_import_runs` row with status `previewed`, and return the diff. `apply` must recompute protection state immediately before calling the Task 3 RPC, update the run to `applied`, and then invoke existing checklist synchronization logic for the affected month/employees.

- [ ] **Step 5: Run Task 4 tests and full suite**

Run: `node --test tests/schedule-import-vision.test.mjs tests/schedule-import-edge-contract.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add supabase/functions/attendance-schedule-import tests/schedule-import-vision.test.mjs tests/schedule-import-edge-contract.test.mjs
git commit -m "feat: add schedule import edge API"
```

### Task 5: 앱 연결·사용자 확인·재동기화

**Files:**
- Modify: `schedule-import.js`
- Modify: `styles-schedule-import.css`
- Modify: `multi-shift.js`
- Create: `tests/schedule-import-integration.test.mjs`

**Interfaces:**
- Consumes: Task 4 API contract and existing `load(targetMonth)`, `renderAdmin()`, `api.syncChecklists()`.
- Produces: complete end-user flow from upload to preview to apply; unresolved rows cannot be included in apply; successful apply refreshes current month and selected Work calendar.

- [ ] **Step 1: Write failing integration tests**

Assert:
- unresolved employee aliases disable final apply only for affected rows and expose a selector;
- saving an alias rematches rows without re-uploading the source;
- preview summary shows new/change/delete/protected/review counts;
- protected and needs-review rows are never included in the mutation payload;
- successful apply reloads month data and checklists;
- API failure leaves local/current schedule state untouched and shows an actionable error.

- [ ] **Step 2: Run integration test and verify RED**

Run: `node --test tests/schedule-import-integration.test.mjs`

Expected: FAIL until the complete wiring exists.

- [ ] **Step 3: Implement the final apply/refresh flow**

Wire the preview payload and `runId` to `apply`. After success, call `load(targetMonth)`, refresh extra schedules through the existing wrapped load path, render admin Work view, show the applied counts, and keep `protected` items visible as not changed.

- [ ] **Step 4: Run integration + full regression + build**

Run: `node --test tests/schedule-import-integration.test.mjs && npm test && npm run build`

Expected: PASS and build exit 0.

- [ ] **Step 5: Commit Task 5**

```bash
git add schedule-import.js styles-schedule-import.css multi-shift.js tests/schedule-import-integration.test.mjs
git commit -m "feat: complete schedule import workflow"
```

### Task 6: 실제 샘플 검증·Supabase 배포·Preview 배포

**Files:**
- Modify: `README.md`
- Create: `docs/schedule-import-operations.md`

**Interfaces:**
- Consumes: user-provided `/mnt/data/복사본 꿈카페 9월 스케줄.xlsx` and `/mnt/data/schedule_preview.png` only as local validation inputs; do not commit these source files.
- Produces: documented verification evidence, deployed Supabase migration/function, and Vercel Preview for real-device/user acceptance before main merge.

- [ ] **Step 1: Run local parser against the real Excel without committing the file**

Use the Task 1 parser to print only normalized schedule rows and candidate metadata. Verify payroll/memo sheets are not selected as the recommended schedule. Compare a representative Monday–Sunday block against the visible source.

- [ ] **Step 2: Apply migration to operating Supabase and verify schema**

Apply `20261006_schedule_import.sql`. Verify the two new tables have RLS enabled, the RPC execute grants are service-role-only, and existing `schedules`, `attendance`, `extra_schedules`, checklist tables retain their row counts before any real apply test.

- [ ] **Step 3: Deploy `attendance-schedule-import` Edge Function with `verify_jwt=false`**

This is allowed only because the function implements the existing custom `app_sessions` bearer authentication internally. Verify unauthenticated and staff requests return 403.

- [ ] **Step 4: Verify image-analysis environment before claiming image support complete**

Call a health/config-safe path or a controlled analyzer request. If `OPENAI_API_KEY` is absent, stop the image rollout and report the exact missing secret; do not expose secret values and do not claim image import is complete. If present, analyze the supplied schedule screenshot and compare normalized rows against the visible table.

- [ ] **Step 5: Dry-run/preview against production data without applying changes**

Use an admin session and the real Excel normalized payload with `preview`. Confirm effective-date protection, attendance protection, and deletion behavior. Do not call `apply` against live schedules unless the preview is an explicitly controlled fixture or the user approves that exact preview.

- [ ] **Step 6: Update operations docs**

Document supported formats, default effective-date behavior, full-vs-partial schedule semantics, protected attendance behavior, image API secret requirements, and rollback approach.

- [ ] **Step 7: Run final branch verification**

Run: `npm test && npm run build`

Then verify GitHub Actions for the branch commit and the Vercel Preview deployment are successful. Fetch Preview `/`, `/schedule-import.js`, `/schedule-import-core.js`, `/vendor/xlsx.full.min.js`, `/styles-schedule-import.css`, and `/sw.js`; all must be HTTP 200 and `sw.js` must cache the new assets.

- [ ] **Step 8: Commit docs and open PR**

```bash
git add README.md docs/schedule-import-operations.md
git commit -m "docs: add schedule import operations guide"
git push -u origin feature/schedule-import
```

Open a PR to `main`. Do not merge to Production until the real Excel/image preview is verified and the user confirms the preview behavior matches their schedule workflow.
