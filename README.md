# Attendance Management

직원 근무 일정, 출퇴근, 체크리스트와 관리자 운영을 위한 **범용 근태관리 PWA**입니다.

현재 GitHub 소스는 **v28 관리자 UX 리디자인 + 범용 브랜딩** 기준입니다.

## Production

- Vercel: https://attendance-management-choi18.vercel.app/
- Supabase API: 현재 운영 API를 그대로 사용합니다.

## 관리자 구조

관리자 최상위 정보구조는 다음 3개 영역으로 구성됩니다.

- **오늘**: 출근 전 / 근무 중 / 퇴근 완료, 확인 필요, 직원별 체크리스트 진행률, 관리자 직접 출퇴근 처리
- **근무**: 근무표, 근태기록, 주간 공유, 근태 수정, Excel
- **운영**: 직원 관리, 추가 업무, 체크리스트 템플릿

모바일은 하단 Floating Navigation, 데스크톱은 좌측 Navigation Rail + Wide Operations Dashboard를 사용합니다.

## 관리자 Push 알림

관리자 기기에서 **홈 화면 추가 → 관리자 로그인 → 알림 켜기** 순서로 한 번 설정하면 Web Push를 받을 수 있습니다. Android/데스크톱의 지원 브라우저는 일반 브라우저에서도 동작하며, iPhone/iPad는 홈 화면에 추가한 PWA에서 알림 허용을 권장합니다.

v1 기본 알림은 다음 네 종류입니다.

- 출근 미처리: 예정 출근시간 +10분
- 퇴근 미처리: 예정 퇴근시간 +15분
- 전날 미퇴근: 과거 날짜의 열린 근태 발견 시
- 필수 체크리스트 미완료: 예정 퇴근시간 이후

동일 `alert_key`는 한 번만 Push fan-out 하며, 문제 해결 후 앱 내 활성 알림에서 제거합니다. 알림 기능은 출퇴근·근무표·체크리스트 원본 데이터를 자동 변경하지 않습니다.

### 운영 비밀값

실제 값은 Git에 저장하지 않습니다. 현재 구현은 Supabase Vault를 우선 사용하고, Edge 환경변수가 설정된 경우 이를 우선할 수 있습니다.

Vault names:

- `attendance_notify_vapid_public_key`
- `attendance_notify_vapid_private_key`
- `attendance_notify_cron_secret`
- `attendance_notify_scan_url`

Edge env fallback names:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `ATTENDANCE_NOTIFY_CRON_SECRET`

Cron job name:

- `attendance-notify-every-5-minutes`

Cron을 중지할 때는 Supabase SQL에서 아래와 같이 실행합니다.

```sql
select cron.unschedule('attendance-notify-every-5-minutes');
```

운영 Cron은 Preview, dryRun, 실제 관리자 기기 Push 검증을 모두 통과한 뒤에만 활성화합니다.

## Generic branding

앱의 표시명은 `근태관리`로 통일합니다.

빌드 단계에서 이전 매장 전용 이름이나 지점명이 정적 HTML, PWA Manifest, 공통 UI, 관리자 UI에 남지 않도록 중립화합니다. 백엔드에서 이전 매장명이 `storeName`으로 전달되는 경우에도 화면에서는 `근태관리`로 표시하며, 다른 정상적인 매장명은 그대로 표시할 수 있습니다.

제품 설명은 다음 문구를 사용합니다.

> 직원 근무 일정과 출퇴근을 관리하는 근태관리 시스템

## Build

```bash
npm install
npm test
npm run build
```

빌드 결과는 `dist/`에 생성됩니다.

현재 빌드는 검증된 v27 immutable deployment를 baseline으로 받아 v28 관리자 presentation layer와 범용 브랜딩 처리를 적용합니다. 출퇴근 상태 머신, 추가근무, 체크리스트 생성 등 핵심 비즈니스 로직은 변경하지 않습니다.

## Main files

- `build.mjs` — v27 baseline을 가져와 범용 v28 dist를 생성
- `admin-redesign.js` — 관리자 Today / Work / Operations UI 및 interaction
- `admin-date-tools.js` — 선택 날짜 근태 조회·수정 및 빠른 근무표 편집
- `admin-notifications.js` — 관리자 Push 구독, 앱 내 알림 병합, 딥링크
- `supabase/functions/attendance-notify/` — 이상 감지 API와 Web Push fan-out
- `supabase/migrations/20260911_admin_notifications.sql` — 알림 저장소와 서버 전용 Vault bridge
- `tests/admin-redesign.test.mjs` — 관리자 리디자인 회귀 테스트
- `tests/admin-notifications.test.mjs` — 알림/Push 계약 회귀 테스트
- `tests/notification-core.test.mjs` — 이상 감지 경계값 테스트
- `tests/branding-neutralization.test.mjs` — 특정 업체 브랜딩 재유입 방지 테스트
- `docs/admin-redesign-v28.md` — 승인된 관리자 UX 스펙

## Current scope

현재 단계에서는 **표시 브랜딩을 범용화**했습니다. Supabase API와 데이터 저장소까지 업체별 독립 설치형으로 분리하는 작업은 별도 단계입니다.

## Version

Current production presentation version: **v28 generic**
