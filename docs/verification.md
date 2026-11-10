> 현재 상태 안내 (2026-11-11): 아래는 v0.1 당시 기록입니다. 이후 사용자 실행 확인과 v0.2 배포 UI 검증이 완료되었습니다. [전체 작업 현황](project-status.md)과 [v0.2 검증](monologue-progress.md)을 참고하세요.

# 검증 기록 — 2026-11-10

## 통과
- `npm test`: 9개 테스트. Telnet 분할 협상, IAC escaping, TTYPE/NAWS 경로, 알 수 없는 옵션 거절, CP949 분할 수신, 이전 소켓 close 격리, 매크로 확장/순환/한도, 큐 중지, 자동반응 청크/색상/대기 시간, 설정 유효성, 협상 버퍼 한도.
- `npm run check`: TypeScript 오류 0.
- `npm run build`: 메인/preload/renderer 번들 생성.
- `npm run pack`: Windows x64 폴더형 배포 생성.
- `node scripts/ui-test.mjs`: 실제 Electron 앱 + 로컬 TCP 서버. CP949 한글 명령, 연속 명령 순서, composition 중 Enter 차단, 비밀 입력 명령 기록 제외. 렌더러 오류 0.
- `node scripts/smoke.mjs`: 패키지 실행, 설정 저장, 비밀 입력 마스킹. 렌더러 오류 0.
- `scripts/probe.ts`: xmud.ddnsfree.com:6666 접속, CP949로 퇴마요새 Reboot 배너 및 Enter 안내 정상 수신. 로그인 데이터 전송 없음.
- `npm audit --omit=dev`: 배포 의존성 취약점 0. 전체 개발 의존성 검사에는 moderate 6건이 보고됨.
- 독립 코드 리뷰에서 Telnet escaped IAC의 버퍼 제한 우회 발견. 실패하는 회귀 테스트 추가 후 상한 검사 수정.

## 제한과 남은 확인
- 실제 계정 로그인, 장시간 플레이, 모든 게임 화면의 ANSI 호환성은 미검증.
- IME composition 이벤트 자동 테스트는 통과했으나 사용자 실제 한글 입력기의 모든 조합은 미검증.
- 갈무리 대화상자와 디스크 오류, 손상된 설정 파일 복구는 코드 구현만 되어 있고 독립 통합 테스트는 미실시.
- OS 예약 단축키는 운영체제에 따라 다를 수 있음.
- 설치형/서명된 배포가 아닌 폴더형 실행 파일.

## 환경 문제 해결
네트워크 제한 아래 TCP 테스트가 실패했으나 동일 코드를 네트워크 권한으로 실행하면 통과했다. Electron UI 런처의 ELECTRON_RUN_AS_NODE를 빈 값으로 주면 Node 모드로 시작하므로 환경 변수 자체를 제거하여 해결했다. Electron 설치 압축 해제 바인딩 문제는 동일 버전 캐시 ZIP으로 개발 런타임을 복구했다.

## 최종 배포 실행 차단 (앞선 패키지 검증과 구분)
최종 재빌드 후 2026-11-10 23:08 KST 실행 검증에서 Windows가 `Iyagi Mud.exe was blocked by your organization's Device Guard policy`를 반환했다. 앞선 빌드의 smoke와 개발 런타임 UI 통합 테스트는 통과했지만 최종 재빌드 실행은 미검증이다. 정책 우회나 변경은 수행하지 않았다. 이 PC에서 배포본을 실행하려면 관리 정책에 맞는 승인/서명이 필요할 수 있다.
