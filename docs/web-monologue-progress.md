# 혼잣말 웹앱 작업 기록 — 2026-11-18

## 작업 결과

기존 Windows 데스크톱 앱과 별도로 여러 캐릭터의 퇴마요새 접속과 혼잣말을 관리하는 웹앱을 `web-monologue/`에 추가했다. 기존 TCP/Telnet·CP949 연결과 SCS 해독·번역·Worker 실행 엔진을 재사용하며, 이번 변경에서 데스크톱 앱의 동작과 버전은 변경하지 않았다.

캐릭터별 이름·암호 저장, 접속·종료, 소스·헤더 업로드와 번역, 혼잣말 시작·중지, 텍스트 입출력과 혼잣말 입력 응답을 제공한다. 텍스트 화면은 버튼을 눌렀을 때만 열린다. 브라우저나 다이얼로그를 닫아도 서버가 실행 중이면 연결과 Worker가 유지된다.

## 구현 구조

| 위치 | 역할 |
| --- | --- |
| `web-monologue/src/sessions.ts` | 캐릭터별 Connection·ScriptService·출력 버퍼와 파일 저장 관리 |
| `web-monologue/src/login.ts` | 공지사항, 이름·암호 입력, 접속 확인과 광장 이동 상태 처리 |
| `web-monologue/src/store.ts` | AES-256-GCM 암호화 계정 저장·복구 |
| `web-monologue/src/server.ts`, `main.ts` | 로컬 HTTP API, 정적 파일 제공과 서버 수명 관리 |
| `web-monologue/public/` | 한국어 캐릭터 목록과 추가·파일 지정·텍스트 다이얼로그 |
| `web-monologue/build.mjs` | 기존 엔진을 포함하는 독립 서버·Worker 번들 |
| `web-monologue/Dockerfile`, `compose.yaml` | 비루트 컨테이너, 상태 확인, 데이터 볼륨, 재시작 정책 |

기본 웹 주소는 `http://localhost:3000`이며 호스트 공개 범위는 `127.0.0.1`이다. 별도 웹 로그인 기능은 제공하지 않는다. 캐릭터 암호와 업로드 소스는 서버 데이터 디렉터리에 보관하며, API는 암호를 반환하지 않는다. 암호화 키와 계정 파일은 함께 백업해야 한다.

## 로그인 순서 보정

실제 게임 서버 안내와 사용자 확인에 맞춰 다음 순서를 적용했다.

1. 초기 엔터 안내에서 엔터 두 번으로 시작 화면과 공지사항을 넘긴다.
2. 이름·암호 입력 안내를 받은 뒤 해당 정보를 한 번씩 전송한다.
3. 로그인 성공 안내만으로 혼잣말 실행을 허용하지 않고 `[리턴을 누르세요]`를 기다린다.
4. 해당 문구를 수신한 뒤 접속 체크용 리턴 한 번과 `광장`을 차례로 전송한다.
5. 준비 상태로 전환한 뒤 혼잣말 실행을 허용한다. 안내의 분할 수신, 반복 수신, 수동 로그인 완료 확인에도 중복 전송하지 않는다.

사용자는 실제 계정으로 로그인과 접속 확인이 완료됐다고 확인했다. 자동 테스트는 실제 계정 대신 로컬 TCP 모의 서버를 사용한다.

## 파일 지정 오류 수정

사용자가 `(150)묘지_멸겁화.scs`와 `USE_SKILL.H`를 선택했을 때 `파일 이름이 올바르지 않습니다.` 오류를 보고했다. 원인은 서버의 소스 파일명 허용 문자에 괄호가 빠져 있던 것이다.

소스 파일명에 괄호를 허용했다. 허용 확장자 `.scs`·`.txt`, 이름 길이 제한, 경로 이탈 방지, 헤더 파일명 검사는 유지했다. 같은 파일명과 헤더 이름에 별도의 최소 소스를 넣은 테스트가 수정 전 실패하는 것을 확인한 뒤, 번역·저장과 서버 재시작 후 복구까지 통과시켰다. 사용자 원본 스크립트 본문이나 암호는 저장소에 포함하지 않는다.

수정본을 로컬 Node 서버에 적용하고 `/health` 정상 응답과 저장된 캐릭터 복구를 확인했다. 서버 재시작으로 게임 접속은 종료되며, 다시 접속하고 실행하는 절차는 사용자가 수행한다.

## 병합 전 코드 리뷰 반영

출력 버퍼가 최대 128,000자를 유지하면서 오래된 암호 에코의 앞부분을 먼저 잘라 내면, 나중에 응답을 마스킹할 때 남은 암호 뒷부분을 알아보지 못하는 문제를 발견했다. 실제 계정 대신 모의 TCP 서버와 합성 암호로 재현했다.

완전한 암호 에코를 버퍼에 추가하는 시점에 먼저 마스킹하고 오래된 출력을 잘라 내도록 수정했다. TCP 패킷 끝의 미완성 암호 조각은 다음 패킷과 합쳐 검사하며, 출력 API에서는 해당 조각도 마스킹한다. 완전한 에코·분할 에코가 버퍼 경계를 지나도 암호 일부가 노출되지 않는 회귀 테스트를 추가했다.

## 검증 결과

이번 커밋 준비 단계에서 다음 검증을 다시 실행했다.

| 검증 | 결과 |
| --- | --- |
| 기존 데스크톱 엔진 테스트 | 31개 통과 |
| 웹앱 로그인·세션·저장·HTTP·파일명·암호 마스킹·LAN 회귀 테스트 | 16개 통과 |
| 전체 테스트 | 47개 통과 |
| 기존 앱 및 웹앱 TypeScript 검사 | 통과 |
| 기존 Electron 번들 및 웹 서버·Worker 빌드 | 통과 |
| 브라우저 JavaScript 구문 검사 | 통과 |
| Docker Compose 구성 검사 | 통과 |
| Docker 컨테이너 재실행 | 현재 Docker 엔진이 꺼져 있어 이번 단계에서는 재검증하지 않음 |

이번 환경에서 실행한 명령은 다음과 같다. 로컬 TCP 테스트는 네트워크 사용이 허용된 실행 환경에서 수행했다.

```powershell
node scripts/build.mjs
node web-monologue/build.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p web-monologue/tsconfig.json
node --check web-monologue/public/app.js
node node_modules/tsx/dist/cli.mjs --test tests/*.test.ts web-monologue/tests/*.test.ts
docker compose -f web-monologue/compose.yaml config --quiet
```

이전 구현 단계의 Docker 이미지 빌드, Linux 테스트, 컨테이너 재시작 후 복구 및 브라우저 검증 결과는 [웹앱 검증 기록](../web-monologue/VERIFICATION.md)에 별도 보관했다. 실제 게임에서 사용자 원본 스크립트를 실행하는 동작과 장시간 자동사냥은 이번 자동 검증 범위에 포함하지 않는다.

## 실행과 데이터 보관

후속 LAN 접속 요청에 따라 `WEB_ALLOWED_HOSTS`를 추가했다. 기본값은 localhost·루프백만 허용하며, 명시적으로 등록한 서버 LAN IP·호스트명도 처리할 수 있다. 기존 Origin 검사는 유지한다. Node용 `start-lan.ps1`, 같은 서브넷만 허용하는 Windows 방화벽 스크립트와 Compose용 `WEB_BIND_HOST`를 제공한다. 사용자가 선택한 범위는 같은 공유기·사내망이며 인터넷 공개는 포함하지 않는다. 자세한 명령은 [LAN 사용 안내](../web-monologue/README.md#같은-공유기사내망의-다른-pc에서-접속)를 참고한다.

일반 실행·중지·포트 변경 절차는 [웹앱 사용 안내](../web-monologue/README.md)를 따른다. Docker 방식은 저장소 루트를 빌드 컨텍스트로 사용하고, Compose 데이터 볼륨에 캐릭터와 소스를 보관한다. Docker 없이 실행할 때 기본 데이터 위치는 `web-monologue/data/`다. 두 실행 방식의 저장 위치는 별개이며 자동으로 이동하지 않는다.

현재 작업에서는 로컬 Node 서버를 사용했다. 컨테이너나 PC를 다시 시작해도 저장된 캐릭터와 소스는 복구하지만 게임 로그인과 혼잣말은 자동 재개하지 않는다. 서버 종료·재시작은 연결과 실행을 종료한다.

Git과 Docker 빌드 컨텍스트에서 실제 계정 데이터, 암호화 키, 업로드 소스, 로그, `node_modules/`와 생성된 `dist/`를 제외한다. 테스트용 예시 화면은 [미리보기](web-monologue-preview.jpg)에 있다.

## 관련 문서

- [설계](superpowers/specs/2026-11-18-web-monologue-design.md)
- [구현 계획과 단계별 기록](superpowers/plans/2026-11-18-web-monologue.md)
- [사용 안내](../web-monologue/README.md)
- [상세 검증 이력](../web-monologue/VERIFICATION.md)
