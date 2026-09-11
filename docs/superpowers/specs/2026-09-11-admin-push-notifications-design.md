# 관리자 이상 알림·Push 시스템 설계

## 1. 목표

관리자가 근태관리 앱을 계속 열어두지 않아도 출근·퇴근 누락 등 운영상 이상을 빠르게 확인할 수 있도록 한다.

초기 설정은 최대한 단순하게 유지한다. 관리자는 관리자 화면에서 **알림 켜기**를 한 번 누르고 브라우저/OS 알림 권한을 허용하면 된다. VAPID, Supabase, Push 서비스 등 기술 설정은 사용자에게 노출하지 않는다.

## 2. 범위

### v1에서 제공

- 관리자 기기별 Web Push 구독
- 알림 허용한 모든 관리자 기기로 Push 전송
- 5분 주기 이상 감지
- 앱 내 `확인 필요` 영역을 서버 알림과 결합
- 동일 이상 건 중복 Push 방지
- 알림 클릭 시 관리자 화면의 관련 직원/날짜로 이동
- 이상이 해결되면 활성 알림에서 제거
- 관리자 화면에서 해당 기기의 Push 알림 켜기/끄기

### v1에서 제외

- 관리자별 세밀한 알림 조건 커스터마이징
- SMS, 카카오 알림톡, 이메일
- 직원에게 보내는 Push
- 반복 재촉 알림
- 시간대별 무음 스케줄
- 읽음/안읽음 상태 관리

임계값은 v1에서 기본값으로 고정하고, 사용성 확인 후 설정 UI를 추가한다.

## 3. 기본 이상 감지 규칙

| 유형 | 조건 | 기본 기준 | Push 제목 예시 |
| --- | --- | --- | --- |
| 출근 미처리 | 근무표가 있으나 출근 기록이 없음 | 예정 출근 + 10분 | `출근 미처리` |
| 퇴근 미처리 | 오늘 근무가 열려 있고 퇴근 기록이 없음 | 예정 퇴근 + 15분 | `퇴근 미처리` |
| 전날 미퇴근 | 과거 날짜 출근 기록이 열려 있음 | 다음 날 최초 감지 | `전날 퇴근 기록 확인 필요` |
| 필수 체크리스트 미완료 | 필수 체크리스트가 남아 있음 | 예정 퇴근시간 이후 | `필수 업무 미완료` |

### 중복 방지

각 이상 건은 안정적인 `alert_key`를 가진다.

- `missing_clock_in:{employee_id}:{work_date}`
- `missing_clock_out:{attendance_id}`
- `stale_open:{attendance_id}`
- `required_checklist:{employee_id}:{work_date}`

같은 `alert_key`는 활성 상태에서 Push를 한 번만 보낸다. 스캐너가 5분마다 실행되어도 새 Push를 반복 전송하지 않는다.

상태가 정상으로 돌아오면 해당 알림은 `resolved` 처리한다. 같은 유형의 새로운 날짜/근무 기록은 다른 `alert_key`이므로 새 알림을 만들 수 있다.

## 4. 사용자 경험

### 최초 관리자 진입

관리자 로그인 후 Push 구독이 없는 기기에는 작은 안내 카드를 노출한다.

> 출근·퇴근 누락 알림을 받아보세요  
> 앱을 열어두지 않아도 확인이 필요한 근태를 알려드립니다.  
> **[알림 켜기]**

`알림 켜기`를 누른 사용자 동작 안에서 `Notification.requestPermission()`을 호출한다. 권한이 허용되면 서비스워커 Push 구독을 생성하고 서버에 등록한다.

권한 거부 시 반복 팝업을 띄우지 않는다. 관리자 화면에 `브라우저 설정에서 알림 권한을 허용해 주세요` 안내만 제공한다.

### 관리자 화면

기존 `오늘 > 확인 필요`는 유지하되 서버 `open` 알림과 병합한다.

Push 대상 4개 유형은 서버 알림을 우선한다. 같은 직원·날짜·유형의 기존 클라이언트 계산 항목이 있으면 한 번만 표시한다. 지각처럼 Push 대상이 아닌 기존 로컬 경고는 그대로 유지한다.

예시:

- 🔴 퇴근 미처리 — 김송이 · 18:00 퇴근 예정
- 🟠 출근 미처리 — 박시현 · 09:00 출근 예정
- 🟡 필수 업무 미완료 — 김채빈 · 필수 2개 남음

알림 행을 누르면 해당 직원의 Quick Sheet 또는 선택 날짜 근태 상세로 연결한다.

### Push 클릭

Push payload에는 최소한 다음 정보만 포함한다.

- `type`
- `employeeId`
- `workDate`
- `alertId`
- 표시용 `title`, `body`

서비스워커의 `notificationclick` 이벤트가 앱을 열거나 기존 창을 포커스하고 다음 형태의 목적지를 전달한다.

`/?adminAlert={alertId}&employee={employeeId}&date={workDate}`

관리자 세션이 유효하면 바로 관련 화면으로 이동한다. 세션이 만료된 경우 목적지 정보를 `sessionStorage` 등 임시 저장소에 보관하고 관리자 로그인 완료 후 한 번만 복원한다.

## 5. 아키텍처

```text
근무표 / 출퇴근 / 체크리스트 데이터
              ↓
      Supabase 5분 Cron
              ↓
      attendance-notify /scan
              ↓
     이상 조건 계산 + alert_key
              ↓
 notification_alerts upsert
      ↙                 ↘
앱 내 확인 필요       Web Push 발송
                         ↓
               관리자 허용 기기 전체
```

### 구성요소 A — 프론트 `admin-notifications.js`

역할:

- 현재 브라우저의 Push 지원 여부 확인
- 알림 권한 상태 표시
- 서비스워커 Push 구독 생성/해제
- 구독 정보를 서버 API에 등록/삭제
- 활성 알림 조회
- 기존 `확인 필요`와 서버 알림 중복 제거 후 병합
- Push URL 딥링크 처리

기존 관리자 재설계 코드와 근태 판단 로직을 대규모 수정하지 않고 별도 파일로 추가한다.

### 구성요소 B — 서비스워커

현재 `sw.js`에 다음 이벤트를 추가한다.

- `push`
- `notificationclick`
- `pushsubscriptionchange`는 브라우저 지원 범위를 확인해 필요 시 추가

기존 캐시/fetch 동작은 유지한다.

### 구성요소 C — Supabase Edge Function `attendance-notify`

하나의 알림 전용 Edge Function으로 분리한다.

관리자 세션 필요:

- `POST /subscribe`
- `POST /unsubscribe`
- `GET /alerts`

Cron 전용:

- `POST /scan`

관리자 API는 기존 `app_sessions` custom bearer token을 검증하고 `role = admin`만 허용한다.

`/scan`은 브라우저에서 사용할 수 없도록 별도 서버 비밀값(`x-cron-secret`) 검증을 추가한다.

이 구조를 사용하면 기존 `attendance-api v6`의 출퇴근 동작을 건드리지 않고 알림 기능을 분리할 수 있다.

### 구성요소 D — DB

#### `notification_subscriptions`

관리자 Push 구독 기기를 저장한다.

주요 컬럼:

- `id uuid`
- `endpoint text unique`
- `p256dh text`
- `auth text`
- `user_agent text`
- `enabled boolean`
- `failure_count integer`
- `last_success_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

Push endpoint와 암호화 키는 관리자 전용 Edge Function에서만 접근한다. 일반 bootstrap 데이터에는 포함하지 않는다. 클라이언트의 직접 DB 접근도 허용하지 않는다.

#### `notification_alerts`

이상 감지 결과와 중복 방지 상태를 저장한다.

주요 컬럼:

- `id uuid`
- `alert_key text unique`
- `type text`
- `employee_id uuid`
- `work_date date`
- `attendance_id uuid null`
- `severity text`
- `title text`
- `body text`
- `status text` (`open`, `resolved`)
- `first_detected_at timestamptz`
- `last_detected_at timestamptz`
- `push_sent_at timestamptz null`
- `resolved_at timestamptz null`

v1에서는 읽음 상태를 별도로 저장하지 않는다.

## 6. Push 발송

Web Push는 표준 Push API + VAPID를 사용한다.

서버에는 VAPID private key를 Supabase Edge Function secret으로만 저장한다. 공개키만 프론트가 구독 생성 시 사용한다.

한 alert를 처음 생성했을 때 현재 활성 관리자 구독 전체에 한 번 fan-out 한다. `push_sent_at`은 fan-out 시도를 마친 뒤 기록한다. v1에서는 일시적 Push 실패를 반복 재시도해 다른 정상 기기에 중복 알림을 만드는 것보다 중복 방지를 우선한다.

Push 전송 실패 처리:

- 정상 성공: `last_success_at` 갱신, `failure_count = 0`
- 404/410: 만료된 구독으로 판단하여 `enabled = false`
- 일시적 실패: `failure_count + 1`, 해당 스캔 전체는 계속 진행
- 한 기기 실패가 다른 관리자 기기 전송을 막지 않음

## 7. 스케줄러

Supabase의 `pg_cron` + `pg_net`을 사용하여 5분마다 `attendance-notify /scan`을 호출한다.

Cron은 프론트 세션에 의존하지 않는다. 스캔 호출은 별도 비밀값으로 보호하며 이 값은 프론트에 노출하지 않는다.

첫 구현 시 운영 DB에 Cron을 즉시 걸기 전에 Edge Function의 `dryRun` 모드를 통해 현재 데이터에서 어떤 알림이 생성되는지 확인한다.

검증 후 Cron을 활성화한다.

## 8. 이상 감지 세부 규칙

### 출근 미처리

- `schedules.work_date = 오늘`
- 현재 시간이 `scheduled_start + 10분` 이후
- 해당 직원/날짜의 실제 `clock_in` 기록 없음

이미 관리자가 수동 근태를 생성했다면 즉시 정상으로 본다.

### 퇴근 미처리

- `schedules.work_date = 오늘`
- 현재 시간이 `scheduled_end + 15분` 이후
- 해당 날짜의 열린 attendance가 존재

### 전날 미퇴근

- `attendance.work_date < 오늘`
- `clock_in is not null`
- `clock_out is null`

이 기록은 자동 수정하지 않는다. 관리자에게만 알려 실제 시간을 확인해 수정하도록 한다.

### 필수 체크리스트 미완료

- 해당 날짜 근무표 존재
- 예정 퇴근시간 경과
- `task_assignments.source_type = checklist`
- `required = true`
- `status != completed`

## 9. 해결 상태

각 스캔마다 현재 활성 조건을 계산한다.

기존 `open` 알림 중 이번 스캔에서 더 이상 조건이 성립하지 않는 항목은 `resolved` 처리한다.

예:

- 출근 미처리 Push 후 실제 출근 → 해결
- 퇴근 미처리 Push 후 관리자 시간 수정 → 해결
- 전날 미퇴근 Push 후 관리자 퇴근시간 정정 → 해결
- 체크리스트 미완료 Push 후 전부 완료 → 해결

Push는 해결 알림까지 보내지 않는다. 앱 내에서는 해결된 항목을 기본 목록에서 제거한다.

## 10. 보안

- 관리자 구독 등록/조회는 기존 관리자 세션 인증 필수
- Push subscription endpoint/p256dh/auth는 일반 bootstrap에 포함하지 않음
- 관련 테이블은 프론트 직접 접근을 허용하지 않고 Edge Function 경유
- VAPID private key는 Edge Function secret에만 보관
- Cron 호출은 별도 secret으로 검증
- `/scan`은 요청자가 임의 employee/date를 주입해 Push를 만드는 구조가 아니라 서버가 DB 상태를 직접 계산
- Push 메시지에는 PIN, 전화번호 등 민감정보를 포함하지 않음

## 11. 플랫폼별 동작

### Android / 데스크톱

지원 브라우저에서 관리자 페이지를 열고 `알림 켜기`를 누르면 된다.

### iPhone / iPad

Web Push를 안정적으로 사용하려면 홈 화면에 추가한 PWA에서 실행하는 흐름을 기본 안내로 한다.

1. Safari에서 근태관리 열기
2. 홈 화면에 추가
3. 홈 화면의 근태관리 실행
4. 관리자 로그인
5. `알림 켜기`
6. iOS 알림 허용

지원되지 않는 환경에서는 알림 켜기 버튼 대신 `이 기기에서는 Push 알림을 사용할 수 없습니다` 안내를 노출하고 앱 내 확인 필요 기능은 계속 사용할 수 있게 한다.

## 12. 운영 안전장치

이번 기능은 출퇴근 원본 데이터를 변경하지 않는다.

- 스캐너는 조회 + 알림 테이블 기록만 수행
- 출근/퇴근 기록 자동 생성 금지
- 과거 미퇴근 자동 종료 금지
- 근무표 자동 수정 금지
- 체크리스트 자동 완료 금지

알림 시스템 장애가 발생해도 기존 출퇴근·근무표·관리자 기능은 계속 동작해야 한다.

## 13. 테스트 전략

### 단위/회귀 테스트

- 예정 출근 +9분에는 알림 없음
- +10분 이후 출근 기록이 없으면 1건 생성
- 동일 스캔 반복 시 동일 alert_key Push 재전송 없음
- 퇴근 예정 +14분에는 없음
- +15분 이후 열린 근태가 있으면 퇴근 미처리 생성
- 전날 미퇴근이 있어도 오늘 근태에는 영향 없음
- 관리자 수정 후 stale alert resolved
- 필수 체크리스트 전부 완료 시 resolved
- 기존 로컬 `확인 필요`와 서버 alert가 같은 건이면 한 번만 표시
- Push 410 응답 시 구독 비활성화
- 비관리자 세션 subscribe 차단
- 잘못된 cron secret으로 scan 차단
- Push 딥링크 상태에서 로그인 만료 후 로그인하면 원래 직원/날짜로 복귀

### 통합 검증

Cron 활성화 전 운영 데이터를 대상으로 `dryRun`을 실행해 현재 예상 알림 목록만 확인한다.

테스트용 Push 구독에서 다음 순서를 검증한다.

1. 관리자 알림 켜기
2. 테스트 Push 수신
3. 푸시 클릭
4. 앱 관리자 화면 열림
5. 대상 직원/날짜 표시
6. 문제 수정
7. 다음 scan에서 alert resolved
8. 같은 문제로 중복 Push가 오지 않음

## 14. 배포 순서

운영 중인 출퇴근 기능을 보호하기 위해 다음 순서를 지킨다.

1. 기능 브랜치에서 DB migration/Edge Function/프론트 테스트
2. DB 테이블만 먼저 추가 — 기존 기능에 영향 없음
3. Edge Function 배포, Cron은 아직 비활성
4. 프론트 Preview에서 관리자 구독/알림 UI 검증
5. 테스트 기기 Push 검증
6. `dryRun`으로 운영 데이터 감지 결과 확인
7. Cron 활성화
8. main 병합
9. Vercel Production READY 및 실제 Push 재검증

## 15. 성공 기준

- 관리자가 신규 기기에서 1회의 `알림 켜기` 동작으로 Push 설정 완료
- 출근 미처리/퇴근 미처리/전날 미퇴근/필수 체크리스트 미완료가 5~10분 이내 관리자에게 전달
- 동일 이상 건 Push는 1회만 전송
- 기존 확인 필요 UI와 중복 표시되지 않음
- 알림 클릭 시 해당 직원/날짜 확인으로 바로 이동
- 문제 해결 후 앱 내 활성 알림에서 사라짐
- Push 기능 장애가 기존 출퇴근 처리에 영향을 주지 않음
