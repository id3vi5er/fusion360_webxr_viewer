@echo off
setlocal
:: Wechselt in das Verzeichnis der Batch-Datei
cd /d "%~dp0"

echo Starte Fusion 360 WebXR Streamer Server...
echo.

:: Wechselt in den server-Ordner, damit die SSL-Zertifikate dort abgelegt werden
cd server

:: Startet den Server mit dem Python-Interpreter aus dem venv
"..\venv\Scripts\python.exe" main.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo Server wurde mit einem Fehler beendet.
    pause
)
