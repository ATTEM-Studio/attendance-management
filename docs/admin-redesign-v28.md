# Attendance Management 관리자 UX 리디자인 v28

- 대상: attendance-management 관리자 UI
- 범위: 관리자 중심 리디자인(B안)
- 목표: 기능 목록 중심 관리자 화면을 업무 흐름 중심 Operations Dashboard로 재편
- 비범위: 직원 화면 전면 재설계, 출퇴근 상태 머신, Supabase 핵심 스키마, 인증, Excel 계산 로직 변경

## 핵심 UX 원칙

1. 기능이 아니라 업무 흐름으로 분류한다.
2. 관리자 홈은 메뉴판이 아니라 Action Dashboard다.
3. 상태 자체가 진입점이 된다.
4. 한 컨텍스트에는 하나의 주요 행동만 강조한다.
5. Mobile은 Native Operations App, Desktop은 Professional Operations Dashboard로 설계한다.

## 관리자 IA

```text
관리자

├─ 오늘
│  ├─ 핵심 상태
│  ├─ 출근 전
│  ├─ 근무 중
│  ├─ 퇴근 완료
│  ├─ 확인 필요
│  ├─ 직원 현황
│  └─ 오늘 체크리스트
│
├─ 근무
│  ├─ 근무표
│  ├─ 근무 배정
│  ├─ 주간 공유
│  ├─ 근태 기록
│  ├─ 근태 수정
│  └─ Excel
│
└─ 운영
   ├─ 직원 관리
   ├─ 업무 배정
   └─ 체크리스트 템플릿
```

## 오늘

관리자 기본 진입 화면. 상단에 현재 근무 상황을 요약하고, 출근 전 / 근무 중 / 퇴근 완료 KPI를 제공한다.

`확인 필요` 영역은 예정 시각 경과 후 미출근, 필수 체크리스트 미완료, 지각 등 운영상 우선 확인 항목을 노출한다.

직원 카드는 이름, 예정 근무시간, 근무유형, 현재 상태, 체크리스트 진행률을 보여주며 현재 상태에 맞는 관리자 액션 하나만 강조한다.

## 근무

상단 Segmented Control로 `근무표 / 근태기록`을 전환한다.

근무표는 월간 Calendar를 유지하고, 데스크톱에서는 Calendar + Inspector 2-column 구조를 사용한다. 날짜별 배정 직원 이름은 `+N`으로 축약하지 않고 모두 표시한다.

근태기록에서는 월별 총 근무시간, 지각, 추가근무를 요약하고 직원/이상기록 필터, 근태 수정, Excel 저장을 한 흐름으로 통합한다.

## 운영

Apple Settings 계열 List UI를 사용한다.

- 직원 관리
- 수동 업무 배정
- 체크리스트 템플릿

자동 생성 체크리스트와 수동 업무의 관리 UI는 분리한다.

## Responsive

- 0–519px: Mobile Operations App
- 520–759px: Large Mobile / Small Tablet
- 760–1023px: Tablet
- 1024px+: Desktop Operations Dashboard

모바일에서는 하단 Floating Navigation, 데스크톱에서는 80~88px Navigation Rail을 사용한다.

## 유지하는 Visual Language

- Cool Gray Canvas
- Soft White Surface
- 제한적 Glass Surface
- Primary Blue
- Green / Orange / Red semantic status
- 20~30px large radius
- 약 54px primary button
- Bottom Sheet / Desktop Large Panel
- Safe Area 대응
- Press scale(.98)
- 140ms fast / 240ms normal motion
- 한국어 word-break: keep-all

## 접근성

- semantic button
- aria-label / aria-selected / aria-current
- keyboard focus
- 44px 이상 주요 touch target
- prefers-reduced-motion
- 상태를 색상만으로 표현하지 않기
- Safe Area 대응

## 비즈니스 로직 비변경 원칙

특별한 결함이 발견되지 않는 한 아래는 변경하지 않는다.

- Supabase 핵심 스키마
- 출퇴근 상태 머신
- 중복 출퇴근 방지
- 추가근무 로직
- 체크리스트 자동 생성 로직
- 기존 근무표 데이터
- 직원/관리자 인증
- API 권한 구조
- Excel 계산 로직

## 성공 기준

1. 관리자가 홈에서 현재 상황을 빠르게 파악할 수 있다.
2. 최상위 Navigation은 오늘 / 근무 / 운영 3개다.
3. 오늘 문제는 별도 메뉴 탐색 없이 Today 화면에서 진입할 수 있다.
4. 일정 관련 기능은 근무에서 찾을 수 있다.
5. 직원/업무/체크리스트 설정은 운영에서 찾을 수 있다.
6. Desktop은 모바일 화면 확대본처럼 보이지 않는다.
7. 기존 핵심 기능은 모두 유지한다.
8. 데이터가 없거나 많아도 Layout이 깨지지 않는다.
9. Loading / Error / Empty / Success 상태를 명확히 구분한다.

## 최종 정의

- 직원 UI: Native Mobile Utility App
- 관리자 Mobile: Native Store Operations App
- 관리자 Desktop: Professional Operations Dashboard

목표는 더 예쁜 관리자 페이지가 아니라, 관리자가 현재 상황을 빠르게 이해하고 필요한 행동까지 최소한의 탐색으로 수행할 수 있는 운영 도구를 만드는 것이다.
