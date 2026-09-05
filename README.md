# Attendance Management

꿈카페 하단지점용 근태·인력 관리 PWA입니다.

현재 GitHub 소스는 **v28 관리자 UX 리디자인** 기준입니다.

## Production

- Vercel: https://attendance-management-choi18.vercel.app/
- Supabase API: 기존 운영 API를 그대로 사용합니다.

## v28 관리자 구조

관리자 최상위 정보구조를 다음 3개 영역으로 재편했습니다.

- **오늘**: 출근 전 / 근무 중 / 퇴근 완료, 확인 필요, 직원별 체크리스트 진행률, 관리자 직접 출퇴근 처리
- **근무**: 근무표, 근태기록, 주간 공유, 근태 수정, Excel
- **운영**: 직원 관리, 추가 업무, 체크리스트 템플릿

모바일은 하단 Floating Navigation, 데스크톱은 좌측 Navigation Rail + Wide Operations Dashboard를 사용합니다.

## Build

```bash
npm install
npm test
npm run build
```

빌드 결과는 `dist/`에 생성됩니다.

현재 빌드는 검증된 v27 immutable deployment를 baseline으로 받아 v28 관리자 presentation layer를 주입합니다. 출퇴근 상태 머신, Supabase 스키마, 추가근무, 체크리스트 생성 등 핵심 비즈니스 로직은 변경하지 않습니다.

## Main files

- `build.mjs` — v27 baseline을 가져와 v28 dist를 생성
- `admin-redesign.js` — 관리자 Today / Work / Operations UI 및 interaction
- `styles-admin-redesign.css` — v28 responsive/admin design system
- `tests/admin-redesign.test.mjs` — 관리자 리디자인 회귀 테스트
- `docs/admin-redesign-v28.md` — 승인된 관리자 UX 스펙

## Version

Current production presentation version: **v28**
