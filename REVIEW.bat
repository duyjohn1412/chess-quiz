@echo off
cd /d "%~dp0"
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python tools\serve_local.py --mode review
  goto :end
)
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 tools\serve_local.py --mode review
  goto :end
)
echo [Loi] Can cai Python 3 de mo Review Server cuc bo.
pause
exit /b 1
:end
pause
