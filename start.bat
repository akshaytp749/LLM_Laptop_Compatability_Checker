@echo off
echo =========================================
echo Starting LLM Compatibility Checker
echo =========================================

echo Starting Backend server on port 5000...
start cmd /k "cd backend && call venv\Scripts\activate.bat && python app.py"

echo Starting Frontend server on port 5173...
start cmd /k "cd frontend && npm run dev"

echo.
echo Waiting for the backend to come up...
set RETRIES=0

:wait_backend
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5000/api/system_stats | Out-Null; exit 0 } catch { exit 1 }" >NUL 2>&1
if not errorlevel 1 goto ready
set /a RETRIES+=1
if %RETRIES% GEQ 30 (
    echo Backend did not respond after 30 seconds - opening the browser anyway.
    goto ready
)
timeout /t 1 /nobreak > NUL
goto wait_backend

:ready
echo Opening http://localhost:5173 in your default browser...
start http://localhost:5173

echo.
pause
