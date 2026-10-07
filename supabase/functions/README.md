# Supabase Edge Functions

현재 운영 중인 주요 Edge Function 소스를 GitHub 저장소에 함께 보존합니다.

- `attendance-api` — 로그인, 출퇴근, 근무표, 업무, 체크리스트, 근태 수정
- `attendance-delete` — 근태 삭제 및 삭제 이력 보존
- `attendance-report` — 근태 보고서 생성
- `attendance-employee-admin` — 직원 수정·삭제
- `attendance-manual-create` — 누락 근태 수동 생성
- `attendance-notify` — 현재 비활성화된 관리자 알림 엔드포인트
- `attendance-schedule-tools` — 다중 근무 및 체크리스트 동기화
- `attendance-schedule-import` — Excel/이미지 근무표 가져오기

운영 함수 변경 시 저장소 소스와 Supabase 배포본을 함께 갱신하고, 배포 후 회귀 테스트와 함수 버전 일치 여부를 확인합니다.
