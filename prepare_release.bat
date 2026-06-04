@echo off
rem ===========================================================================
rem File: prepare_release.bat
rem Description: Compiles and packages the IVIDS YT MP3 Downloader Electron app
rem              and the WebView Android app.
rem              Moves the compiled .exe and .apk to the root directory
rem              and cleans up the dist/, build/, and gradle build directories.
rem ===========================================================================

echo ==============================================
echo Cleaning previous builds...
echo ==============================================
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build
if exist android\build rmdir /s /q android\build
if exist android\app\build rmdir /s /q android\app\build

rem 1. Verify Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [Error] Node.js is not installed or not in PATH! Please install Node.js first.
    pause
    exit /b %errorlevel%
)

rem 2. Install dependencies if node_modules is missing
if not exist "node_modules" (
    echo node_modules folder is missing. Installing dependencies...
    call npm.cmd install
    if %errorlevel% neq 0 (
        echo [Error] npm install failed!
        pause
        exit /b %errorlevel%
    )
)

rem 3. Build the Electron application into a portable EXE
echo ==============================================
echo Packaging Electron application...
echo ==============================================
call npm.cmd run dist
if %errorlevel% neq 0 (
    echo [Error] Electron-builder packaging failed!
    pause
    exit /b %errorlevel%
)

echo Moving executable to root directory...
move "dist\IVIDS YT MP3 Downloader.exe" ".\" >nul

rem 4. Sync web UI assets to Android project assets
echo Syncing UI assets to Android project...
if not exist "android\app\src\main\assets" mkdir "android\app\src\main\assets"
xcopy /s /e /y "ui" "android\app\src\main\assets\ui\" >nul

rem 5. Build the Android WebView app APK
echo ==============================================
echo Building Android App (APK)...
echo ==============================================
pushd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 (
    echo [Error] Android gradle build failed!
    popd
    pause
    exit /b %errorlevel%
)
popd

echo Moving APK to root directory...
move "android\app\build\outputs\apk\debug\app-debug.apk" ".\IVIDS.apk" >nul

rem 6. Stop Gradle Daemon to release file locks
echo Stopping Gradle Daemon...
pushd android
call gradlew.bat --stop >nul
popd

rem 7. Clean build and temporary folders
echo Cleaning up build and cache folders...
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build
if exist android\build rmdir /s /q android\build
if exist android\app\build rmdir /s /q android\app\build

echo ==============================================
echo Build Completed Successfully!
echo Portable EXE: IVIDS YT MP3 Downloader.exe
echo Android APK: IVIDS.apk
echo ==============================================
pause
