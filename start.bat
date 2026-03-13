@echo off
echo =========================================
echo Starting LLM Compatibility Checker
echo =========================================

echo Starting Backend server on port 5000...
start cmd /k "cd backend && call venv\Scripts\activate.bat && python app.py"

echo Starting Frontend server on port 5173...
start cmd /k "cd frontend && npm run dev"

echo.
echo Both servers are starting in new windows...
echo Waiting for servers to initialize before opening browser...
timeout /t 5 /nobreak > NUL

echo Opening http://localhost:5173 in your default browser...
start http://localhost:5173

echo.
pause
