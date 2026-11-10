# 퇴마요새 클라이언트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 이야기멀티의 주요 조작 방식을 지원하는 Windows x64 머드 클라이언트를 만든다.
**Architecture:** Electron 메인 프로세스가 Telnet 연결, 디코딩, 명령 큐, 설정/로그 파일을 관리한다. 제한된 preload API를 통해 렌더러의 xterm.js 화면과 연결한다.
**Tech Stack:** Electron, TypeScript, xterm.js, iconv-lite, Vite, Node test runner, electron-builder.
**Spec:** ../specs/2026-11-10-mud-client-design.md

## Global Constraints
- Windows x64, 단일 접속 세션. 기본 서버 xmud.ddnsfree.com:6666.
- 원본 C:\KSR\MULTI 파일 변경 금지. 원본 소스·바이너리를 배포물에 포함하지 않는다.
- CP949/UTF-8 선택. 자동 로그인과 비밀번호 저장 제외.
- Node 접근 없는 렌더러, contextIsolation, 고정된 IPC API.
- 원본 .MAC/.ANS 가져오기, 혼잣말 언어, 좌표 자동반응 제외.
- 패키징/실제 연결 검증에 실패하면 완료로 표시하지 않는다.

## Review Focus
- TCP 청크 경계에서 한글과 IAC가 나뉘어도 문자와 협상이 손상되지 않아야 한다: Task 1.
- 이전 소켓의 지연 이벤트가 새 연결 상태를 덮어쓰지 않아야 한다: Task 1.
- 매크로 참조 순환과 서버 반응의 반복이 무한 전송을 만들지 않아야 한다: Task 2.
- 한글 IME Enter가 조합 완료와 전송을 동시에 처리하지 않아야 한다: Task 3.
- 비밀 입력과 손상된 설정 파일이 비밀번호 노출 또는 실행 실패를 만들지 않아야 한다: Task 3.

## Task 1: 통신 기반
**Files:** package.json, tsconfig.json, vite.config.ts, src/core/telnet.ts, src/core/connection.ts, tests/telnet.test.ts, tests/connection.test.ts.
**Interfaces:** TelnetParser.feed(Buffer): {data: Buffer, replies: Buffer[]}; Connection.connect(host,port,encoding), send(text), disconnect(), resize(cols,rows); data/status/echo 이벤트.
- [ ] 공식 문서 확인 후 버전 고정 및 의존성 설치. 현재 PATH에 npm 명령이 없으므로 번들 Node 주변에서 npm CLI 위치를 확인한다.
- [ ] 실패 테스트: 각 바이트로 나눈 IAC 협상은 완전한 청크와 동일한 data/replies를 내고, IAC IAC는 리터럴 255 한 바이트를 반환한다.
- [ ] 실패 테스트: CP949 한글 바이트를 분리 수신해도 원문이 복원되고, 재접속 후 이전 연결 close 이벤트가 새 세션을 닫지 않는다.
- [ ] npm test 실행으로 실패 확인.
- [ ] Telnet 상태 머신 구현: ECHO/SGA 수락, TTYPE 응답, NAWS 창 크기 전송, 나머지는 거절. 서브협상 버퍼 상한 8192 바이트. IAC escape 송수신.
- [ ] 스트리밍 디코더와 소켓 세대 ID 적용. 연결 제한 시간 10초. 오류/해제 시 큐 초기화 이벤트.
- [ ] 모의 TCP 서버 테스트 및 TypeScript 검사 통과 확인.

## Task 2: 명령과 자동반응
**Files:** src/core/macros.ts, src/core/queue.ts, src/core/triggers.ts, tests/macros.test.ts, tests/triggers.test.ts.
**Interfaces:** expand(input,bindings,delayMs): CommandAction[]; CommandQueue.enqueue(actions), stop(); TriggerEngine.feed(text,now): string[]; reset(). CommandAction은 send(text) 또는 delay(ms).
- [ ] 실패 테스트: a|b는 순서대로 두 명령, $$는 $, $A1/$S1은 해당 바인딩 확장, 순환 참조는 오류, $,는 지연 액션.
- [ ] 실패 테스트: 중지 후 대기 액션 전송 없음, 최대 1000 액션 초과는 거절, 연결 해제는 큐 비움.
- [ ] 실패 테스트: 청크에 나뉜 트리거 문구 감지, 동일 문구 재검사 중복 없음, 줄바꿈 없는 프롬프트 감지, 재실행 대기 시간 적용, ANSI 색상은 일치 대상에서 제외.
- [ ] 테스트 실패 확인 후 구현. 매크로 깊이 10, 기본 명령 간격 150ms, $, 기본 지연 500ms. 모두 UI 도움말에 명시.
- [ ] 자동반응 최근 텍스트 8192자 상한, 규칙별 기본 대기 2000ms, 기본 꺼짐. 정규식 미지원.
- [ ] 전체 core 테스트 통과 확인.

## Task 3: 데스크톱 화면 및 저장
**Files:** src/main.ts, src/preload.ts, src/shared/types.ts, src/core/settings.ts, src/renderer/index.html, src/renderer/main.ts, src/renderer/style.css, tests/settings.test.ts.
**Interfaces:** window.mud의 connect/disconnect/send/stop/saveSettings/loadSettings/importAliases/toggleLog/resize 및 data/status 이벤트. 모든 입력은 메인 프로세스에서 타입과 크기를 검증한다.
- [ ] 실패 테스트: 손상된 JSON은 기본 설정으로 복구하며 원본 파일 보존. 포트는 1~65535, 인코딩은 cp949/utf8만 수락. 비밀 입력은 명령 기록에 추가하지 않는다.
- [ ] 메인/preload IPC와 사용자 데이터 JSON 저장 구현. 비밀번호·실행 스크립트·임의 파일 접근을 렌더러 API에 포함하지 않는다.
- [ ] 단일 화면 구현: 연결 도구막대, 상태, 터미널, 입력창, 10개 단축버튼, 설정 패널. 전체 중지 버튼을 항상 표시.
- [ ] 한글 composition 상태 및 KeyboardEvent.isComposing 처리. 입력 기록 위/아래 탐색, 비밀 입력 수동 토글 및 Telnet ECHO 반영.
- [ ] 단축키 Alt/Shift+F1~F10, F8 설정, F11 전체화면. 키 충돌 시 사용자 재지정 가능.
- [ ] 폰트/크기, 인코딩, 명령 간격, 매크로/자동반응 편집, 프로필 저장. ALIAS.TXT 파일 선택 가져오기와 문장 추천.
- [ ] 로그 저장 시작/종료 및 오류 표시. 비밀 입력은 로컬 echo·명령 기록·로그에 기록하지 않는다. 서버 출력 로그 범위를 설명한다.
- [ ] 개발 앱을 실행해 연결/해제, ANSI 커서 동작, 설정 재실행 복원, IME와 복사/스크롤을 검사한다.

## Task 4: 통합 검증과 배포
**Files:** scripts/mock-server.ts, README.md, docs/verification.md, package.json의 패키징 설정.
- [ ] 로컬 모의 서버 시나리오: 협상, 한글/색상, 프롬프트, 비밀 입력 요청, 갑작스러운 연결 종료.
- [ ] 모든 core 테스트, TypeScript 검사, production 빌드 통과 확인.
- [ ] 실제 퇴마요새 초기 접속만 수행해 인코딩 확인. 로그인/계정 생성은 수행하지 않는다.
- [ ] Windows x64 배포 패키지 생성 및 실행 확인. 실패하면 원인과 남은 검증을 기록.
- [ ] 독립 코드 검토에서 통신 경계, IPC 검증, 비밀 입력, 큐 중지를 중점 점검하고 발견 사항 수정.
- [ ] README에 설치·실행, 원본과의 호환 범위, 매크로 문법, 자동반응, 개발/빌드 명령 작성.
- [ ] 검증 기록에 실제 실행한 명령과 성공/미검증 항목을 구분해 전달.

## 계획 자체 검토
설계의 각 기능을 Task 1~4에 배정했다. 프로토콜과 순수 로직을 먼저 안정화하고 UI를 붙인다. 현재 작업 폴더에는 Git 저장소가 없으므로 커밋/브랜치 통합은 전제하지 않는다. 빌드 도구 설치와 실행 환경은 구현 시작 시 검증한다.
