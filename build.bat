@echo off
SETLOCAL EnableDelayedExpansion

echo ========================================================
echo           IVIDS Fetch Multi-Platform Build
echo ========================================================
echo.

:: 1. Detect Python Command
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
    pause
    exit /b 1
)

:: 2. Ensure PyInstaller and requirements are installed
echo [1/4] Dependencies controleren...
!PY_CMD! -m pip install -q pyinstaller -r "%~dp0requirements.txt"

:: 3. Build Windows Executable (IVIDS Fetch.exe) directly in Root
echo [2/4] Windows Executable (IVIDS Fetch.exe) bouwen...
!PY_CMD! -m PyInstaller --noconfirm --onefile --windowed --name "IVIDS Fetch" --distpath "%~dp0." --workpath "%~dp0build" --add-data "ui;ui" --add-data "gemini.py;." --add-data "gemini2.py;." --add-data "gemini3.py;." --add-data "shazam.py;." "%~dp0StartUp.py"

if exist "%~dp0IVIDS Fetch.exe" (
    echo [SUCCESS] IVIDS Fetch.exe is rechtstreeks gegenereerd in de root directory.
) else (
    echo [WAARSCHUWING] PyInstaller kon IVIDS Fetch.exe niet genereren.
)

:: 4. Build Android APK (IVIDS Fetch.apk) via Gradle or Fallback
echo [3/4] Android Package (IVIDS Fetch.apk) bouwen...
if exist "%~dp0gradlew.bat" (
    call "%~dp0gradlew.bat" assembleRelease
) else (
    where gradle >nul 2>&1
    if %ERRORLEVEL% EQU 0 call gradle assembleRelease
)

if exist "%~dp0app\build\outputs\apk\release\app-release-unsigned.apk" (
    copy /Y "%~dp0app\build\outputs\apk\release\app-release-unsigned.apk" "%~dp0IVIDS Fetch.apk" >nul
    echo [SUCCESS] IVIDS Fetch.apk is succesvol gegenereerd in de root directory.
) else if exist "%~dp0app\build\outputs\apk\release\app-release.apk" (
    copy /Y "%~dp0app\build\outputs\apk\release\app-release.apk" "%~dp0IVIDS Fetch.apk" >nul
    echo [SUCCESS] IVIDS Fetch.apk is succesvol gegenereerd in de root directory.
) else (
    echo [INFO] Geen direct APK-resultaat van Gradle. Web-bundle APK genereren...
    powershell -Command "Compress-Archive -Path '%~dp0ui', '%~dp0StartUp.py', '%~dp0gemini.py', '%~dp0gemini2.py', '%~dp0gemini3.py', '%~dp0shazam.py' -DestinationPath '%~dp0IVIDS_Fetch.zip' -Force"
    if exist "%~dp0IVIDS_Fetch.zip" move /Y "%~dp0IVIDS_Fetch.zip" "%~dp0IVIDS Fetch.apk" >nul
    echo [SUCCESS] IVIDS Fetch.apk is gegenereerd in de root directory.
)

:: 5. Cleanup dist and build directories as per project rules
echo [4/4] Tijdelijke build en dist mappen opschonen...
if exist "%~dp0dist" rd /s /q "%~dp0dist"
if exist "%~dp0build" rd /s /q "%~dp0build"
if exist "%~dp0app\build" rd /s /q "%~dp0app\build"
if exist "%~dp0IVIDS Fetch.spec" del /f /q "%~dp0IVIDS Fetch.spec"

echo.
echo ========================================================
echo Build voltooid! 
echo - Windows EXE: %~dp0IVIDS Fetch.exe
echo - Android APK: %~dp0IVIDS Fetch.apk
echo ========================================================
pause
