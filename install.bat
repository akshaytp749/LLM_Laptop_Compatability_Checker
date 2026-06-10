@echo off
setlocal
echo =========================================
echo Installing LLM Compatibility Checker
echo =========================================

echo.
echo [1/4] Checking prerequisites...
where python >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Python was not found on PATH.
    echo Install it from https://www.python.org/downloads/ and re-run this script.
    goto fail
)
where npm >NUL 2>&1
if errorlevel 1 (
    echo ERROR: Node.js / npm was not found on PATH.
    echo Install it from https://nodejs.org/ and re-run this script.
    goto fail
)

echo.
echo [2/4] Setting up Python Backend...
cd backend
if not exist venv (
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create the Python virtual environment.
        cd ..
        goto fail
    )
)
call venv\Scripts\activate.bat
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install Python dependencies.
    cd ..
    goto fail
)
cd ..

echo.
echo [3/4] Setting up Node Frontend...
cd frontend
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install Node dependencies.
    cd ..
    goto fail
)
cd ..

echo.
echo =========================================
echo [4/4] Installation Complete!
echo Run start.bat to launch the app.
echo =========================================
pause
exit /b 0

:fail
echo.
echo Installation FAILED - see the error above.
pause
exit /b 1
