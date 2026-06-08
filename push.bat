@echo off
cd /d "%~dp0"
echo === Harness Forge push ===
git add -A
set /p msg=Commit message: 
if "%msg%"=="" set msg=update
git commit -m "%msg%"
git push
echo.
echo Done. Close this window.
pause
