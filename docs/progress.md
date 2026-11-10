> 현재 상태 안내 (2026-11-11): 아래는 v0.1 당시 기록입니다. 이후 사용자 실행 확인과 v0.2 배포 UI 검증이 완료되었습니다. [전체 작업 현황](project-status.md)과 [v0.2 검증](monologue-progress.md)을 참고하세요.

# Execution ledger
Plan: docs/superpowers/plans/2026-11-10-mud-client.md
Ruling: Fresh non-Git workspace; implement in place, no worktree or commits.
Ruling: Use esbuild for both bundles instead of Vite; simpler offline file loading with same TypeScript and Electron architecture.
Pre-flight: connection data -> trigger feed and renderer; queue -> connection send; shared settings -> IPC and UI. No interface conflicts.
Task 1: core Telnet and streaming CP949 implementation complete; local TCP test passes with network permission.
Task 2: macros, stop queue, trigger chunk/cooldown tests pass.
Task 3: renderer, config, logging and IPC implemented; packaged app smoke verifies settings and secret input; screenshot captured.
Task 4: actual xmud.ddnsfree.com:6666 initial banner verified in CP949; no login sent. Windows x64 unpacked build succeeded.
Ruling: network-restricted test failure was environmental; rerunning same test with network access passed.
Ruling: Electron postinstall did not download development binary; electron-builder downloaded runtime successfully. Packaged smoke uses release executable.
Final: independent review P1 fixed with RED/GREEN regression. Nine tests, typecheck, UI integration and rebuilt packaged smoke passed. No Git repository; no branch integration required. Remaining manual validations listed in docs/verification.md.
Correction to previous final ledger line: rebuilt packaged smoke did NOT pass. Windows Device Guard explicitly blocked the final executable. Earlier packaged smoke and development UI integration passed. Final binary exists but execution is blocked by OS policy; no bypass attempted.
