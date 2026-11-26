# 이야기 · 혼잣말 웹 관리

캐릭터마다 독립된 퇴마요새 접속과 혼잣말 실행을 제공하는 로컬 웹앱입니다. 기존 데스크톱 앱의 Telnet / CP949 연결과 SCS 번역·실행 엔진을 재사용합니다. 데스크톱 앱을 함께 실행할 필요가 없습니다.

## Docker Compose로 실행

Docker Desktop 또는 Docker Engine과 Compose가 실행 중이어야 합니다. 저장소를 내려받은 다음 이 폴더에서 실행하세요.

```powershell
cd F:\codex\iyagi\web-monologue
docker compose up -d --build
```

브라우저에서 **http://localhost:3000**을 여세요. 실제 경로가 다르면 내려받은 저장소의 `web-monologue` 폴더로 이동하면 됩니다. 다른 폴더에서는 `docker compose -f web-monologue/compose.yaml up -d --build`로 실행할 수 있습니다.

```powershell
docker compose ps          # 실행 상태
docker compose logs -f web # 서버 로그
docker compose stop       # 백그라운드 서버와 모든 게임 접속/실행 종료
docker compose start      # 다시 시작
docker compose down       # 컨테이너 삭제, 캐릭터/소스 데이터는 유지
```

기본 공개 범위는 이 PC의 `127.0.0.1:3000`입니다. 웹 관리용 별도 로그인 기능은 없으며 같은 PC의 사용자가 관리 화면에 접근할 수 있습니다. 인터넷 공개용 구성은 아닙니다. 포트를 바꾸려면 셸 환경 변수 `WEB_PORT`를 지정한 뒤 Compose를 실행하세요.

```powershell
$env:WEB_PORT = '3100'
docker compose up -d
```

## 같은 공유기·사내망의 다른 PC에서 접속

LAN 접속을 켠 PC의 IPv4 주소를 사용합니다. 예를 들어 서버 PC 주소가 `192.168.1.9`이면 다른 PC에서 **http://192.168.1.9:3000**을 여세요. 다른 PC의 `localhost`는 그 PC 자신을 가리킵니다.

이 모드에서는 같은 네트워크에서 접속하는 사람이 저장된 캐릭터와 혼잣말을 관리할 수 있습니다. 신뢰하는 LAN에서 사용하세요. 공유기의 인터넷 포트 포워딩은 필요하지 않습니다.

### 현재 Windows PC에서 Node로 실행

기존 웹 서버를 종료한 뒤, 이 폴더의 PowerShell에서 실행합니다. 서버 재시작은 기존 게임 접속과 혼잣말을 종료하므로 다시 접속·실행해야 합니다.

```powershell
npm run build
.\start-lan.ps1
# LAN 주소가 여러 개라면 이 PC의 주소를 지정합니다.
.\start-lan.ps1 -LanAddress 192.168.1.9 -Port 3000
```

실행 창을 유지하세요. 스크립트는 LAN IPv4 주소를 자동으로 찾고 `LISTEN_HOST=0.0.0.0`, `WEB_ALLOWED_HOSTS=<LAN 주소>`, `PORT=3000`을 설정한 뒤 서버를 실행합니다. 종료 시 이전 환경 변수 값으로 복원합니다. 기본 데이터 위치는 그대로 `data/`이며 `http://localhost:3000`도 유지됩니다.

Windows 방화벽 허용은 최초 한 번 **관리자 PowerShell**에서 실행합니다. 지정한 서버 IPv4 주소의 TCP 포트에 대해 같은 서브넷에서 오는 연결만 허용하며, 네트워크 프로필이나 다른 포트의 방화벽 설정은 바꾸지 않습니다.

```powershell
.\enable-lan-firewall.ps1 -LanAddress 192.168.1.9 -Port 3000
```

DHCP로 서버 IP가 바뀌면 새 주소로 실행하고 방화벽 규칙도 다시 설정하세요. 공유기에서 서버 PC의 IP를 예약하면 같은 주소를 계속 사용할 수 있습니다.

### Docker Compose로 LAN 접속

```powershell
$env:WEB_BIND_HOST = '0.0.0.0'
$env:WEB_ALLOWED_HOSTS = '192.168.1.9'
docker compose up -d --build
```

`WEB_BIND_HOST`의 기본값은 `127.0.0.1`이므로 설정하지 않으면 로컬 전용입니다. `WEB_ALLOWED_HOSTS`에는 포트나 `http://` 없이 서버 IP·호스트명을 쉼표로 구분해 넣습니다. 예: `192.168.1.9,mud-pc`. 호스트명으로 접속하려면 다른 PC에서도 그 이름을 서버 IP로 해석할 수 있어야 합니다. localhost·루프백은 항상 허용하며, 미등록 Host와 다른 Origin의 요청은 거부합니다.

Docker 없이 직접 환경 변수를 지정해 실행해도 됩니다.

```powershell
$env:LISTEN_HOST = '0.0.0.0'
$env:WEB_ALLOWED_HOSTS = '192.168.1.9'
npm start
```

## Docker 단독 실행

기존 엔진 소스를 함께 번들하므로 **저장소 루트**를 빌드 컨텍스트로 사용합니다.

```powershell
cd F:\codex\iyagi
docker build -t iyagi-web-monologue:local .
docker run -d --name iyagi-monologue --restart unless-stopped --init -p 127.0.0.1:3000:3000 -v iyagi-monologue-data:/app/data iyagi-web-monologue:local
```

## 사용 순서

1. **캐릭터 추가**에서 퇴마요새 캐릭터 이름과 암호를 입력합니다. 목록에 저장되며 이 동작만으로 게임에 접속하지 않습니다.
2. 캐릭터의 **퇴마요새 접속**을 누릅니다. 초기 엔터 안내를 받으면 **엔터 두 번으로 시작 화면과 공지사항을 넘긴 뒤**, 캐릭터 이름과 암호 입력 안내에 자동으로 응답합니다. 로그인 성공 후에는 서버의 **`[리턴을 누르세요]` 문구를 기다린 뒤 접속 체크용 리턴을 한 번 보내고 `광장` 명령으로 이동**합니다. 그 전에는 혼잣말을 실행할 수 없습니다. 서버 안내를 인식하지 못하거나 추가 확인이 필요하면 **텍스트 화면**에서 직접 입력하고 **로그인 완료 확인**을 누르세요. 수동 확인도 리턴 안내가 올 때까지 기다리며, 안내 수신 후 리턴과 `광장`을 한 번씩 전송합니다. 암호를 직접 입력할 때는 **비밀 입력**을 켜세요.
3. **파일 지정**에서 `.scs` 또는 `.txt` 소스와 필요한 `.h` 헤더들을 함께 선택하고 **번역하고 저장**을 누릅니다. UTF-8 / CP949 / 조합형을 자동 감지합니다. 기본 I.H / ENGLISH.H는 별도 업로드 없이 처리합니다. 개별 파일은 2MB, 전체 합계는 4MB, 헤더는 50개까지입니다.
4. 로그인과 번역을 완료한 뒤 **혼잣말 실행**을 누릅니다. 여러 캐릭터를 동시에 실행할 수 있습니다. **혼잣말 중지**는 해당 캐릭터만 중지하며 게임 연결은 유지합니다.
5. **텍스트 화면**을 누르면 게임 입력·출력 다이얼로그가 열립니다. 닫기 또는 Esc로 닫을 수 있습니다. 다이얼로그와 브라우저를 닫아도 연결과 혼잣말은 유지됩니다. 다시 열면 최근 출력 약 128,000자와 진행 중인 입력 요청을 확인할 수 있습니다.
6. 혼잣말이 사용자 응답을 기다리면 목록에 **입력 대기**가 표시됩니다. 텍스트 화면 안의 응답 입력칸에서 이어갈 수 있습니다. 다이얼로그는 자동으로 열리지 않습니다.

텍스트 화면에서 연결을 잃으면 **Enter를 두 번** 눌러 현재 캐릭터로 다시 접속할 수 있습니다. 로그인 후 **↑·↓**로 이 브라우저에서 보낸 캐릭터별 최근 명령 20개를 찾을 수 있습니다. 비밀 입력은 기록에서 제외되며 재접속하면 이전 연결의 기록이 비워집니다. 이야기멀티 전경색 표기 `$#155=114F안녕하세요$#155=7F`는 밝은 노란색으로 표시한 뒤 기본색으로 돌아갑니다.

실행 중에는 소스를 교체할 수 없습니다. **접속 종료**는 해당 캐릭터의 혼잣말과 연결을 모두 종료합니다. 캐릭터 삭제는 접속과 실행을 종료한 상태에서 할 수 있습니다.

## 백그라운드 실행과 보관 범위

- `docker compose up -d`가 서버를 브라우저와 별도로 실행합니다. 브라우저의 자바스크립트 타이머로 게임을 실행하지 않습니다.
- 브라우저/다이얼로그 종료와 새로고침은 실행에 영향을 주지 않습니다. PC 절전·종료, 컨테이너 종료, 게임 서버의 연결 종료 시에는 접속과 실행이 중단됩니다.
- `restart: unless-stopped`는 Docker 데몬이 다시 시작되면 컨테이너를 재시작합니다. **게임 로그인과 혼잣말은 자동 재개하지 않습니다.** 다시 접속하고 실행하세요.
- 캐릭터 정보와 업로드한 소스는 `monologue-data` 볼륨에 보존합니다. 출력 기록과 실행 진행 위치는 메모리에 있으므로 컨테이너 재시작 후 복구하지 않습니다.
- 암호는 AES-256-GCM으로 암호화합니다. 암호화 키 `credential.key`와 암호화 계정 파일 `characters.json`은 같은 데이터 볼륨에 있으므로 함께 백업하세요. 볼륨을 읽을 수 있는 관리자는 암호도 복호화할 수 있습니다. 암호화 키를 삭제하거나 재생성하면 기존 암호를 읽을 수 없습니다.
- `docker compose down -v`는 저장 데이터까지 삭제하므로 데이터를 보존할 때는 사용하지 마세요.

## 개발 및 검증

Node.js 24 이상이 필요합니다. Docker 없이 실행할 때는 이 폴더에서 다음 명령을 사용합니다.

```powershell
npm ci
npm run build
npm run check
npm test
npm start
```

`npm test`는 실제 게임 계정 대신 로컬 TCP 모의 서버를 사용합니다. 테스트 전에 `npm run build`로 Worker를 생성하세요. 테스트는 현재 작업 폴더와 무관하게 Worker를 찾습니다. 기본 접속 대상은 `xmud.ddnsfree.com:6666`이며 테스트/개발에서는 `MUD_HOST`, `MUD_PORT`를 지정할 수 있습니다. 기본 로컬 서버는 `127.0.0.1:3000`에만 바인딩합니다. Docker 이미지는 내부에서 `0.0.0.0:3000`에 바인딩하고 호스트 공개 범위는 Compose의 포트 설정이 제한합니다.

브라우저 회귀 테스트에는 루트의 npm 개발 의존성과 Chrome이 필요합니다. 웹앱을 빌드한 후 저장소 루트에서 `node --import tsx --test web-monologue/tests/ui-test.mjs`를 실행합니다.

서버 구조:

- `src/sessions.ts`: 캐릭터별 연결, 혼잣말 Worker, 파일 업로드, 출력 버퍼.
- `src/login.ts`: 이름·암호·로그인 안내 상태 처리.
- `src/store.ts`: 암호화 계정 저장과 복구.
- `src/server.ts`: 로컬 HTTP API와 정적 화면.
- `public/`: 한국어 관리 페이지와 다이얼로그.
- `build.mjs`: 기존 엔진을 포함한 독립 서버/Worker 번들 생성.

SCS 호환성은 기존 앱과 동일합니다. SCF 바이너리는 실행하지 않습니다. 실제 퇴마요새 계정 로그인과 장시간 게임 실행은 자동 테스트 범위에 포함하지 않습니다.

테스트와 Docker 실행 결과는 [검증 기록](VERIFICATION.md)을 참고하세요.

전체 구현과 로그인 순서 보정, 괄호가 있는 파일명 오류 수정, 최신 검증 결과는 [작업 기록](../docs/web-monologue-progress.md)에 정리했습니다.

Docker 동작 참고: [Compose 서비스 설정](https://docs.docker.com/reference/compose-file/services/), [백그라운드 실행](https://docs.docker.com/reference/cli/docker/compose/up/).
