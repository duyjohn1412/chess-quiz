@echo off
cd /d "%~dp0"
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python tools\serve_local.py --mode play
  goto :end
)
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 tools\serve_local.py --mode play
  goto :end
)
echo [Thong bao] Khong tim thay Python, dang thu Vite Preview...
call npx vite preview --host 0.0.0.0 --port 4173 --open
:end
pause
