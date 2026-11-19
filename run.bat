@echo off
REM AETHER - double-click this file to start the website on Windows.
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo Python was not found. Install Python 3.10 or newer from https://www.python.org
    echo and tick "Add python.exe to PATH" during setup. Then run this file again.
    pause
    exit /b 1
)

echo Installing requirements (only needed the first time)...
python -m pip install -r requirements.txt --quiet --disable-pip-version-check
if errorlevel 1 (
    echo Could not install Flask. Check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo Starting AETHER. Your browser will open at http://127.0.0.1:5000
echo Keep this window open while you use the site. Close it or press Ctrl+C to stop.
echo.
python app.py --open
pause
