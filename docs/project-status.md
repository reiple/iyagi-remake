> 최신 변경: [v0.2.1 채팅 입력 개선](chat-input-update.md). 아래는 v0.2 구현 시점의 구조와 기록입니다.

# 현재 구현 상태 — 2026-11-11

## 프로젝트 개요
이야기멀티의 사용 흐름과 수집 자료를 참고해 만든 Windows용 독립 MUD 클라이언트다. 기본 접속 대상은 퇴마요새 `xmud.ddnsfree.com:6666`이며 CP949를 사용한다. 현재 버전은 0.2.0이다. 원본 실행 파일이나 수집한 게임 스크립트·도움말을 배포에 포함하지 않는다.

## 구현한 기능
| 영역 | 현재 제공 기능 |
|---|---|
| 통신 | TCP/Telnet, 분할 수신, CP949/UTF-8, IAC 처리, TTYPE/NAWS |
| 화면 | xterm.js 터미널, 창 크기 반영, 한글 입력, 전체화면 |
| 명령 | 명령 기록, 순차 명령 큐, 단축키/버튼, 매크로, 문자열 자동반응 |
| 설정 | 입력값 검증, 저장 전 백업, ALIAS.TXT 가져오기 |
| 기록 | 수신 갈무리, 수동 및 Telnet 협상 기반 비밀 입력 |
| 혼잣말 | SCS 가져오기·편집·번역·실행, include/define, 오류 위치 표시 |
| 실행 제어 | Worker 격리, 일시정지/재개/중지, 연결 해제·비밀 입력 시 중지 |

## 구조
- `src/core`: Telnet 파서, TCP 연결/인코딩, 명령 큐/매크로/자동반응, 설정 검증.
- `src/main.ts`: 창·연결·설정·갈무리·스크립트 서비스와 IPC 조정.
- `src/preload.ts`: 렌더러에서 허용된 요청만 전달하는 브리지.
- `src/renderer`: 터미널 및 설정/혼잣말 화면.
- `src/script/source.ts`: 인코딩/문서 형식 해독과 전처리.
- `src/script/compiler.ts`: 소스 위치를 보존하는 토큰화·파싱 및 AST 생성.
- `src/script/runtime.ts`, `transmit.ts`: AST 실행, 상태 감지, 문자열/시간/송신 처리.
- `src/script/worker.ts`, `service.ts`: 실행 격리, 수명 관리, IPC 및 송신/출력 제한.
- `tests`: 통신·명령·설정·소스·번역기·실행기·서비스 테스트.

스크립트 처리 흐름은 파일 → 해독 → 헤더/매크로 전처리 → AST 번역 → Worker 실행 → 메인 프로세스의 연결 전송 순서다. 원본 SCF를 생성하거나 실행하지 않는다.

## 분석 결과와 호환성 한계
실제 SCS 129개에서 중복을 제거한 101개 중 93개가 자체 번역기에 통과했다. 8개는 문자열/인코딩 또는 미지원 구문 관련 오류로 실패했다. 이 수치는 문법 번역 결과이며 자동사냥의 실행 호환률이 아니다.

지연 1단위=10ms, 찾을글의 공백 구분/백틱 공백 치환/첫 감지 보존은 수집 소스에 근거한 잠정 프로필이다. 원본과 동적 비교는 아직 수행하지 않았다. 기존 SCF, 직접 OS·메모리·파일 접근, 원본 전체 API, 여러 동시 세션은 지원하지 않는다.

## 검증 이력
- v0.1: 핵심 테스트 9개, 로컬 TCP/UI 검증, 실제 서버 초기 배너 수신. 사용자도 실행 동작을 확인했다.
- v0.2: 전체 테스트 30개, 타입 검사와 빌드 통과. 개발 및 배포 실행 파일에서 모의 서버 기반 혼잣말 흐름을 검증했다.
- 수집 자동사냥 스크립트를 실제 서버에서 실행하거나 계정으로 로그인하는 자동 검증은 하지 않았다.
- 상세 기록: [검증 기록](verification.md), [혼잣말 구현 기록](monologue-progress.md).

## 재현과 배포
일반 개발 환경은 Node.js 22.12 이상과 npm이 필요하다. 저장소 루트에서 다음을 실행한다.

```powershell
npm ci
npm test
npm run check
npm run build
npm start
npm run pack -- --config.directories.output=release-v0.2
node scripts/ui-test.mjs
node scripts/script-ui-test.mjs
```

배포 실행 파일 검사:

```powershell
$env:APP_EXECUTABLE=(Resolve-Path 'release-v0.2/win-unpacked/Iyagi Mud.exe').Path
node scripts/script-ui-test.mjs
Remove-Item Env:APP_EXECUTABLE
```

UI 테스트는 로컬 TCP 모의 서버를 사용한다. Windows GUI 세션이 필요하다. `scripts/probe.ts`는 실제 서버에 접속하므로 일반 테스트 명령과 분리되어 있다. `scripts/smoke.mjs`는 기존 `release` 경로의 기본 화면 검사다.

`이야기 실행.cmd`는 `release-v0.2`를 참조한다. `npm run pack`만 실행하면 기본 출력 폴더는 `release`이므로 위 경로 지정 명령을 사용한다. 배포 시 win-unpacked 폴더 전체가 필요하다. 코드 서명/설치 프로그램은 제공하지 않는다.

## 저장소에 포함하지 않는 항목
`node_modules`, `dist`, 배포 EXE, 개발 도구 캐시, Electron 테스트 프로필, 실제 계정/개인 설정, 원본 EXE/SCS/SCF/도움말은 포함하지 않는다. `docs/research`의 JSON은 파일명·해시·분석/번역 결과 메타데이터이며 원본 스크립트 본문이 아니다. 그 안의 로컬 경로는 분석 당시 기록이다. `scripts/check-script-corpus.ts` 재실행에는 해당 개인 자료가 별도로 필요하다. 일반 테스트는 해당 자료 없이 실행한다.

## 다음 작업
1. 실제 사용하는 SCS를 선정해 원본과 시간·패턴·문자열 동작을 비교한다.
2. 번역 실패한 8개 파일의 손상/인코딩/미지원 구문을 개별 확인한다.
3. 장시간 연결, 실제 입력기, 갈무리 오류 및 설정 복구를 추가 검증한다.
4. 결과에 따라 API 호환 범위를 확장하고 배포 서명/설치 방식을 결정한다.

## 문서 목록
- [사용법](../README.md), [혼잣말 사용법](monologue-guide.md)
- [원본 조사](iyagi-original-analysis.md), [혼잣말 타당성](monologue-feasibility.md)
- [수집 자료 재분석](research/monologue-corpus-reanalysis.md)
- [클라이언트 설계](superpowers/specs/2026-11-10-mud-client-design.md)
- [클라이언트 구현 계획](superpowers/plans/2026-11-10-mud-client.md), [혼잣말 구현 계획](superpowers/plans/2026-11-10-monologue.md)

과거 조사 및 실행 기록은 작성 시점의 상태를 담는다. 현재 상태는 이 문서와 v0.2 구현 기록을 우선한다.

## 저장소 등록 전 재검증 (2026-11-11)
전체 테스트 30개, TypeScript 검사, esbuild 빌드를 다시 실행해 모두 통과했다. GitHub 저장소는 `https://github.com/reiple/iyagi-remake`이며 초기 브랜치는 `main`이다.
