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

## 근무표 가져오기

관리자 `근무 > 근무표`에서 **근무표 가져오기**를 사용할 수 있습니다.

- `.xlsx` 근무표는 브라우저에서 직접 분석합니다.
- `.png/.jpg/.jpeg/.webp` 캡처 이미지는 서버 측 비전 분석으로 표 구조와 시간 블록을 읽습니다.
- 직원명은 기존 활성 직원과 자동 매칭하고, 애매한 이름만 직접 확인합니다.
- 수정본은 기본적으로 업로드 당일 이후 일정만 비교합니다.
- 실제 출퇴근 기록이 있는 날짜는 자동 수정·삭제하지 않습니다.
- 전체 근무표로 확신할 수 없는 부분 캡처에서는 기존 일정 삭제를 만들지 않습니다.
- 적용 전 `신규 / 변경 / 삭제 / 보호 / 확인 필요`를 미리 확인하고, 실제 반영은 원자적으로 처리합니다.

운영 세부사항은 `docs/schedule-import-operations.md`를 참고합니다.

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

현재 빌드는 저장소의 `baseline/`에 보존한 검증된 런타임 스냅샷을 기반으로 v28 관리자 presentation layer와 범용 브랜딩 처리를 적용합니다. 외부 Vercel 배포본에 의존하지 않으므로 GitHub 저장소만으로 재현 가능한 빌드가 가능합니다. 출퇴근 상태 머신, 추가근무, 체크리스트 생성 등 핵심 비즈니스 로직은 변경하지 않습니다.

## Main files

- `baseline/` — 검증된 런타임 원본 스냅샷
- `build.mjs` — 로컬 baseline에서 범용 v28 dist를 생성
- `admin-redesign.js` — 관리자 Today / Work / Operations UI 및 interaction
- `admin-date-tools.js` — 선택 날짜 근태 조회·수정 및 빠른 근무표 편집
- `schedule-import-core.js` — Excel 근무표 후보 탐지, 시간 정규화, 직원 매칭
- `schedule-import.js` — 관리자 근무표 가져오기 UI 및 preview/apply 흐름
- `supabase/functions/attendance-schedule-import/` — 이미지 분석, 서버 diff 검증, 적용 API
- `tests/admin-redesign.test.mjs` — 관리자 리디자인 회귀 테스트
- `tests/branding-neutralization.test.mjs` — 특정 업체 브랜딩 재유입 방지 테스트
- `docs/admin-redesign-v28.md` — 승인된 관리자 UX 스펙

## Current scope

현재 단계에서는 **표시 브랜딩을 범용화**했고, 근무표 Excel/이미지 자동 가져오기 기능을 별도 모듈로 추가했습니다. Supabase API와 데이터 저장소를 업체별 독립 설치형으로 분리하는 작업은 별도 단계입니다.

## Version

Current production presentation version: **v28 generic**
