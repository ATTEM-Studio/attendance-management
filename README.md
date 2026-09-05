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

현재 빌드는 검증된 v27 immutable deployment를 baseline으로 받아 v28 관리자 presentation layer와 범용 브랜딩 처리를 적용합니다. 출퇴근 상태 머신, Supabase 스키마, 추가근무, 체크리스트 생성 등 핵심 비즈니스 로직은 변경하지 않습니다.

## Main files

- `build.mjs` — v27 baseline을 가져와 범용 v28 dist를 생성
- `admin-redesign.js` — 관리자 Today / Work / Operations UI 및 interaction
- `styles-admin-redesign.css` — v28 responsive/admin design system
- `tests/admin-redesign.test.mjs` — 관리자 리디자인 회귀 테스트
- `tests/branding-neutralization.test.mjs` — 특정 업체 브랜딩 재유입 방지 테스트
- `docs/admin-redesign-v28.md` — 승인된 관리자 UX 스펙

## Current scope

현재 단계에서는 **표시 브랜딩을 범용화**했습니다. Supabase API와 데이터 저장소까지 업체별 독립 설치형으로 분리하는 작업은 별도 단계입니다.

## Version

Current production presentation version: **v28 generic**
