@echo off
rem ===========================================================================
rem File: build.bat
rem Description: Compiles and packages the IVIDS YT MP3 Downloader Electron app.
rem              Checks for node_modules, runs npm install if missing,
rem              and packages the app as a portable Windows EXE using electron-builder.
rem ===========================================================================

echo ==============================================
echo Building IVIDS YT MP3 Downloader (Electron)
echo ==============================================

rem Clean previous builds
if exist dist rmdir /s /q dist

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

echo ==============================================
echo Build Completed Successfully!
echo Output directory: dist\
echo Portable EXE: dist\IVIDS YT MP3 Downloader.exe
echo ==============================================
pause
