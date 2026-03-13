@echo off
echo =========================================
echo Installing LLM Compatibility Checker
echo =========================================

echo.
echo [1/3] Setting up Python Backend...
cd backend
python -m venv venv
call venv\Scripts\activate.bat
pip install -r requirements.txt
cd ..

echo.
echo [2/3] Setting up Node Frontend...
cd frontend
call npm install
cd ..

echo.
echo =========================================
echo [3/3] Installation Complete! 
echo Run start.bat to launch the app.
echo =========================================
pause
