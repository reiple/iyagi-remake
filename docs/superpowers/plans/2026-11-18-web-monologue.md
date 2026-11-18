# 다중 캐릭터 혼잣말 웹앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Docker Compose로 실행하는 캐릭터별 백그라운드 혼잣말 웹앱을 별도 폴더에 만든다.

**Architecture:** Node HTTP 서버가 기존 Telnet Connection과 ScriptService Worker를 캐릭터별로 소유한다. 브라우저는 JSON API를 호출하며 상태와 출력을 폴링한다. 데이터 볼륨은 암호화한 계정 정보와 업로드 스크립트를 저장한다.

**Tech Stack:** Node.js 24, TypeScript, esbuild, 기존 iconv-lite / 혼잣말 엔진, HTML/CSS/JavaScript, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-18-web-monologue-design.md`

## Global Constraints

- 제품 파일은 `web-monologue/`에 작성하고 기존 데스크톱 엔진의 동작은 변경하지 않는다.
- UI는 한국어이며 암호는 API 응답과 출력에 포함하지 않는다.
- 브라우저/다이얼로그 수명과 접속/Worker 수명을 분리한다.
- 컨테이너 재시작 후 캐릭터와 소스는 복구하지만 게임 접속/실행은 명시적으로 시작한다.

## Review Focus

- 중복 캐릭터와 잘못된 입력: 저장 이전에 거부한다.
- 분할 수신 로그인 안내와 비밀번호 ECHO: 한 번만 응답하고 비밀을 숨긴다.
- 소켓 종료와 Worker 완료: 다른 캐릭터에 영향을 주지 않는다.
- 소스 파일/헤더 이름 경로 이탈과 실행 중 덮어쓰기: 거부한다.
- 닫힌 텍스트 화면에서 입력 대기: 자동으로 창을 열지 않으며 재개 가능하게 보존한다.

### Task 1: 캐릭터 세션과 저장

**Files:** `web-monologue/src/store.ts`, `web-monologue/src/sessions.ts`, `web-monologue/tests/sessions.test.ts`.

**Interfaces:** `SessionManager({dataDir, workerPath, host?, port?})`; `add`, `list`, `connect`, `disconnect`, `configureScript`, `run`, `stop`, `send`, `answer`, `output`, `remove`, `close`.

- [x] 실패하는 다중 세션, 로그인, 저장/복구, 입력 검증 테스트를 작성하고 실행한다.
- [x] 암호화 저장과 독립 세션/Worker 관리, 소스 업로드와 번역을 구현한다.
- [x] 실제 TCP 모의 서버를 사용해 테스트를 통과시킨다.

### Task 2: HTTP API와 웹 UI

**Files:** `web-monologue/src/server.ts`, `web-monologue/src/main.ts`, `web-monologue/public/*`, `web-monologue/tests/http.test.ts`.

**Interfaces:** `createApp({dataDir,workerPath,publicDir,host?,port?})` returns `{server,manager,close}`; `/api/characters`, `/api/characters/:id/:action`.

- [x] API 암호 비노출, 잘못된 Origin/JSON, 관찰 요청 종료 후 실행 유지 테스트를 작성하고 실패를 확인한다.
- [x] 캐릭터 목록, 추가/소스/텍스트 다이얼로그와 요청 검증 API를 구현한다.
- [x] 테스트와 브라우저 UI 검증을 수행한다.

### Task 3: Docker 배포와 문서

**Files:** `web-monologue/{package.json,package-lock.json,build.mjs,Dockerfile,compose.yaml,.dockerignore,README.md,tsconfig.json}`, root `.dockerignore`.

- [x] 기존 엔진을 포함하는 서버/Worker 번들 빌드와 독립 의존성 잠금을 구성한다.
- [x] Docker/Compose 볼륨, 비루트 실행, healthcheck, 재시작 정책을 구성한다.
- [x] 웹앱 테스트, 기존 전체 테스트, 양쪽 타입 검사/빌드, Compose 검증을 실행한다.
- [x] 전체 변경 검토 후 실제 검증 결과와 실행 방법을 기록한다.

## 진행 기록

- 기준 커밋: `9ade180`. 기존 타입 검사는 통과했다. 기본 샌드박스의 TCP 테스트는 실행 제한으로 실패/대기하여 중단했다. TCP 검증은 필요한 실행 권한으로 재시도한다.
- Ruling: 사용자가 실행 방식을 Docker/Compose로 지정했으므로 추가 설계 질문 없이 현재 체크아웃의 별도 폴더에서 구현한다. 새 worktree나 커밋을 만들지 않는다.
- Task 1: complete — 독립 TCP/Worker 및 암호화 저장 검증 통과.
- Task 2: complete — API/입력 대기 복구 검증, 모바일·데스크톱 UI와 실제 탭 종료 후 실행 지속 확인.
- Task 3: complete — 실제 Docker 이미지 빌드, Linux 타입 검사와 7개 테스트, Compose healthy, 컨테이너 재시작 후 데이터 복구 확인.
- Review: 로그인 실패 오인과 저장 실패 시 엔진 롤백 누락을 재현하는 회귀 테스트를 추가한 뒤 수정했다. 최종 Windows 전체 38개 테스트 통과.
- Ruling: Docker 빌드는 기존 엔진을 재사용하므로 저장소 루트를 context로 사용하고 루트 `.dockerignore`에서 필요한 소스만 허용한다.
- 최종 실행: 사용자용 `iyagi-monologue-web-1`을 `127.0.0.1:3000`에서 healthy 상태로 유지한다. 테스트 계정은 별도 QA 볼륨/임시 디렉터리에만 작성했다.

## 후속 수정과 저장소 반영

- 공지사항 엔터 두 번, 이름·암호 입력, `[리턴을 누르세요]` 대기 후 리턴·`광장` 전송 순서로 로그인 상태를 보정했다. 사용자가 실제 로그인과 접속 확인 완료를 확인했다.
- `(150)묘지_멸겁화.scs` 파일명에서 괄호를 거부하는 오류를 회귀 테스트로 재현한 뒤 수정했다. `USE_SKILL.H`와 함께 번역·저장하고 재시작 후 복구하는 테스트를 추가했다.
- 최신 검증: 기존 엔진 31개 + 웹앱 13개, 전체 44개 테스트와 양쪽 타입 검사·빌드, JavaScript 구문 검사, Compose 구성 검사 통과. 현재 Docker 엔진은 꺼져 있으며 로컬 Node 서버를 사용한다.
- 후속 사용자 요청에 따라 최초의 커밋 보류 방침을 종료하고, 최신 `main`에서 `codex/web-monologue` 브랜치를 생성했다. 작업을 문서화하고 한국어 PR을 작성한 뒤 `main`에 병합한다.
- 전체 작업 및 최신 실행 상태: [웹앱 작업 기록](../../web-monologue-progress.md).
- 병합 전 리뷰에서 출력 버퍼 경계의 암호 부분 노출을 모의 TCP 회귀 테스트로 재현하고 수정했다. 최종 검증 대상은 기존 엔진 31개 + 웹앱 14개, 전체 45개 테스트다.
