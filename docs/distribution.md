# 이야기 · MUD Windows 배포 안내

## 받는 사람

1. Windows x64 PC에서 배포 ZIP을 내려받고 **모두 압축 풀기**를 선택합니다. 0.3의 파일 이름은 `Iyagi-Mud-0.3.0-win-x64.zip`입니다.
2. 압축을 푼 폴더에서 `Iyagi Mud.exe`를 실행합니다. 같은 폴더의 DLL과 `resources`, `locales`가 필요하므로 실행 파일을 옮길 때는 폴더 전체를 옮기세요. Node.js와 npm은 필요하지 않습니다.
3. 앱에서 **서버 연결**을 누릅니다. 자세한 사용법은 [프로젝트 README](../README.md)를 참고하세요.

현재 실행 파일에는 코드 서명이 없습니다. Windows가 실행 여부를 물으면 배포자가 안내한 출처와 SHA-256을 먼저 확인하세요. 조직에서 실행을 제한하는 경우 관리자에게 문의하세요.

새 버전은 별도 폴더에 압축을 풀어 실행할 수 있습니다. 개인 설정은 앱 폴더 밖의 사용자 데이터 폴더에 있어 실행 파일을 교체해도 유지됩니다.

## 배포하는 사람

Windows x64 빌드 환경에 Node.js 22.12 이상과 npm을 준비하고 저장소 루트에서 실행합니다.

```powershell
npm ci
npm test
npm run check
npm run dist:win
```

`dist:win`은 현재 소스를 빌드한 뒤 `release/Iyagi-Mud-<버전>-win-x64.zip`을 만듭니다. 버전은 `package.json`에서 가져옵니다. 압축을 새 폴더에 풀고 `Iyagi Mud.exe`가 실행되는지 확인한 뒤 ZIP 전체를 전달하세요. ZIP에는 런타임이 들어 있으며 개인 설정, 접속 기록, 별도로 작성한 혼잣말 파일은 들어가지 않습니다.

배포할 ZIP의 SHA-256을 아래 명령으로 구해 다운로드 링크와 함께 전달하면 받은 사람이 같은 명령으로 파일을 대조할 수 있습니다.

```powershell
Get-FileHash -Algorithm SHA256 .\release\Iyagi-Mud-0.3.0-win-x64.zip
```

GitHub Releases를 이용할 때는 빌드에 사용한 커밋을 대상으로 릴리스를 만들고, ZIP을 릴리스 자산으로 첨부하세요. 릴리스 설명에 변경 사항과 SHA-256을 적으세요.
