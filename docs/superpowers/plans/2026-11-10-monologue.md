# 혼잣말 소스 번역·실행 Implementation Plan

> Execution: superpowers:executing-plans. 사용자가 계획 작성과 구현 시작을 명시적으로 요청했으므로 추가 승인 단계 없이 직접 실행한다.

Goal: 수집 자료의 SCS를 가져와 문법 검사/번역하고 제한된 실행 엔진으로 실행하는 v0.2를 제공한다. 기존 SCF 바이너리 실행 및 동일 SCF 출력은 제외한다.
Spec: docs/research/monologue-corpus-reanalysis.md
Architecture: 형식/인코딩 로더 → include/define 전처리 → AST 번역기 → Worker 인터프리터 → 제한된 통신/입력 IPC.

## 작업과 검증
- [x] Task 1: src/script/source.ts, johab.json. UTF-8/CP949/Johab 및 관찰된 Galmuri 레코드 해독. 바이너리/손상 파일 거절. include는 사용자 선택 소스 디렉터리와 명시적으로 선택한 헤더 폴더 내부만 탐색; 동일 이름 모호하면 오류. I.H/ENGLISH.H는 직접 만든 내장 선언/별칭으로 처리. tests/script-source.test.ts로 인코딩/형식/경계 검증.
- [x] Task 2: src/script/compiler.ts (타입 포함). 토큰화, 소스 위치, define/include, 변수/배열/함수/조건/반복/복합대입/return/break. 미지원 구문 및 함수 진단. tests/script-compiler.test.ts. 실제 고유 소스 101개는 번역만 검증하고 결과 목록 작성.
- [x] Task 3: src/script/runtime.ts/worker.ts. AST 평가, 참조 인자, 부분 송신, | 보존, 날짜/시간, 찾을글 상태, 지연/대기. pause/resume/stop, 연결 종료 취소, 메모리/배열/호출 깊이/송신량 상한. tests/script-runtime.test.ts, 모의 서버 통합.
- [x] Task 4: src/script/service.ts 및 main/preload/UI 연결. 가져오기/편집/번역/실행/일시정지/중지, 헤더 경로와 경고 표시, 오류 위치, 사용자 입력 대화상자. 번역 후 편집 시 이전 번역 실행 금지. 실제 서버 자동사냥 실행 금지.
- [x] Task 5: 기존 테스트+타입 검사+build+UI 통합+독립 코드 리뷰+Windows 별도 출력 폴더 패키지 검증. 문서에 지원 범위/검증 범위 구분.

## 명시적인 호환 정책
원본 비교 실행으로 아직 확정하지 못한 의미를 숨기지 않는다. 초기 호환 프로필은 지연/대기 시간 단위 10ms, 찾을글의 공백=목록 구분 및 백틱=문자열 공백, 1-based 번호, 첫 감지 보존 및 명시적 정리로 한다. 설정 화면에서 이 프로필을 표시하며 모의 테스트 검증과 원본 검증을 구분한다. $# 숫자 코드는 확인된 바이트 삽입 형태만 지원하고 기타 예약 문법은 진단한다. 직접 OS/파일/메모리 접근은 제공하지 않는다. SCF 대신 자체 AST를 메모리에서 실행한다.

## 주요 실패 조건
Galmuri 손상/포맷 혼동, 헤더 버전 오선택, 순간 수신 유실, 무한루프 UI 멈춤, 중지 후 송신, 비밀 입력 중 실행, 편집 전 번역 실행, 미지원 함수의 조용한 실행을 회귀 테스트로 검사한다.
