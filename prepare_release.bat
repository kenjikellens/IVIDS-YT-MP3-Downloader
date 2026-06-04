@echo off
rem ===========================================================================
rem File: prepare_release.bat
rem Description: Compiles and packages the IVIDS YT MP3 Downloader Electron app.
rem              Checks for node_modules, runs npm install if missing,
rem              packages the app as a portable Windows EXE, moves it to the root,
rem              and cleans up the dist/ and build/ directories.
rem ===========================================================================

echo ==============================================
echo Building IVIDS YT MP3 Downloader (Electron)
echo ==============================================

rem Clean previous builds
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

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
echo Packaging application using electron-builder...
call npm.cmd run dist
if %errorlevel% neq 0 (
    echo [Error] Electron-builder packaging failed!
    pause
    exit /b %errorlevel%
)

rem 4. Move executable to root and clean build folders
echo Moving executable to root directory...
move "dist\IVIDS YT MP3 Downloader.exe" ".\" >nul
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

echo ==============================================
echo Build Completed Successfully!
echo Portable EXE: IVIDS YT MP3 Downloader.exe
echo ==============================================
pause
