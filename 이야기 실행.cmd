@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "iyagiExe=%~dp0release\win-unpacked\Iyagi Mud.exe"
if not exist "%iyagiExe%" (
    echo Run npm run pack to build the Windows app.
    exit /b 1
)
start "" "%iyagiExe%"
