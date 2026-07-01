@echo off
SETLOCAL EnableDelayedExpansion

:: Check if Python is installed
SET PY_CMD=
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    SET PY_CMD=py
) else (
    where python >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        SET PY_CMD=python
    )
)

if "!PY_CMD!" == "" (
    echo [FOUT] Python is niet gevonden op dit systeem.
    echo Installeer Python van https://www.python.org/ en vink "Add Python to PATH" aan.
    pause
    exit /b
)

:: Install requirements from requirements.txt
echo [1/3] Python bibliotheken controleren en installeren...
!PY_CMD! -m pip install -r "%~dp0requirements.txt"

echo [2/3] Python backend server wordt gestart...
echo [3/3] Je browser wordt zo direct geopend.

:: Run StartUp.py
!PY_CMD! StartUp.py
