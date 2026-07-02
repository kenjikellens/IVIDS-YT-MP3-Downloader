# IVIDS YouTube MP3 Playlist Downloader v0.0.1

Welcome to the first official release of the IVIDS YouTube MP3 Playlist Downloader! 
A premium, modern, and beautiful YouTube audio downloader application. Featuring a high-performance backend and a unified glassmorphism UI designed for visual excellence. This application allows you to easily download your favorite YouTube playlists and individual tracks as MP3s with a sleek and dynamic user experience, and utilizes advanced AI models to automatically identify and tag the downloaded files.

This project supports **three parallel pathways** for accessing the downloader:
1. 🐍 **Python Server (`StartUp.py`)**: Runs a lightweight HTTP server serving local files and exposing REST API/SSE streaming for downloads. Accessible from any local/mobile browser (`http://localhost:8080`).
2. 💻 **PC Desktop Standalone App (`IVIDS YT MP3 Downloader.exe`)**: A compiled desktop application powered by Electron.
3. 📱 **Mobile App (`IVIDS.apk`)**: A lightweight WebView Android app wrapping the shared web UI assets.

---

## ✨ Features

- **Modern Glassmorphic UI**: Vibrant gradient aesthetics, harmonious HSL colors, smooth transitions, and premium styling.
- **Dynamic Runtime Detection**: The web UI automatically detects if it is running inside Electron (using secure IPC bridge) or in a browser/Python environment (using SSE streaming).
- **Auto-dependency Resolution**: Automatically searches for, downloads, and configures `yt-dlp.exe` and `ffmpeg` if they are not already installed on your system.
- **Advanced AI Metadata Tagging**: Employs an intelligent cascading model fallback system to search, identify, and tag tracks automatically.
- **Adjustable Concurrency**: Adjust simultaneous downloads or multi-threaded AI processing directly from the settings menu to maximize speed.
- **Range Control**: Download entire playlists or target specific tracks using custom start and end range bounds.
- **Real-Time Logging & Robust Streams**: Detailed download logs stream directly to the interface, featuring resilient auto-reconnect logic for stable sessions.

---

## 🤖 AI Models & Fallback Architecture

To ensure high-availability and accurate metadata extraction, the application integrates with Google's Gemini models. The AI attempts to structure track metadata (title, artist, year, album, track number) using a strictly enforced JSON schema. 

The application utilizes a **load-balanced multi-key setup** (`gemini.py`, `gemini2.py`, `gemini3.py` mapped to different API keys) to prevent rate limits. Each module requests predictions using a **prioritized fallback sequence** depending on the key tier. 

### 🧠 Model Thinking & Reasoning Configuration
To maximize the reliability of the JSON metadata output, **all models utilize "Thinking" (Reasoning) capabilities** configured dynamically based on the model family:
- **Gemini 3.x Models (Flash / Pro / Lite)**: Configured with `ThinkingLevel = LOW` for high-speed, direct deductions.
- **Gemini 2.5 Models**: Configured with a fixed `thinking_budget = 256` tokens to enforce bounded reasoning steps.

**Pro Key Sequence (`gemini.py`)**:
1. `gemini-3.1-flash-lite` (Primary fast model)
2. `gemini-2.5-flash-lite`
3. `gemini-3-flash`
4. `gemini-3.5-flash`
5. `gemini-2.5-flash`
6. `gemini-2.5-pro` (Heavyweight reasoning fallback)

**Free Key Sequence (`gemini2.py`, `gemini3.py`)**:
1. `gemini-3.1-flash-lite` (Primary free model)
2. `gemini-2.5-flash-lite`
3. `gemini-3-flash`
4. `gemini-2.5-flash`
5. `gemini-2.5-pro`

If the requested model is exhausted (e.g., HTTP 429 Rate Limit), the system briefly pauses and automatically cascades down the list until a successful metadata payload is extracted. In addition to Gemini, the application leverages Shazam (`shazam.py`) for audio fingerprinting which also leverages `gemini-3-flash` for post-processing results.

---

## 🚀 Getting Started

### Option 1: Python Web Server (`StartUp.py`)
No Node.js installation required. Just run:
```bash
python StartUp.py
```
This spins up the server on a free port (defaults to `8080`), opens your default web browser automatically, and is ready to process downloads.

### Option 2: Electron Desktop App
To run the Electron desktop interface locally:
1. Install Node dependencies:
   ```bash
   npm install
   ```
2. Start the application:
   ```bash
   npm start
   ```

### Option 3: Android Wrapper
Point a standard Android WebView client to the URL hosted by your Python server (`http://<your-pc-ip>:<port>`).

---

## 🛠️ Build & Packaging

To compile the Electron app into a standalone, portable Windows executable (`dist/IVIDS YT MP3 Downloader.exe`):
Run the provided batch build script:
```cmd
build.bat
```
*Note: This packages the Electron code and static UI resources into a single portable EXE (without bundling Python or PyInstaller dependencies).*

---

## 📂 Project Structure

```text
├── StartUp.py               # Python HTTP server & REST/SSE controllers
├── gemini*.py               # AI metadata extraction modules with fallback logic
├── shazam.py                # Audio fingerprinting identifier
├── main.js                  # Electron Main Process entry point
├── preload.js               # Secure IPC context bridge
├── build.bat                # Automated build and packaging script
├── package.json             # Node package manifest
├── src/
│   └── downloadManager.js   # Main Node.js download controller
├── ui/
│   ├── index.html           # Main markup structure
│   ├── renderer.js          # Unified UI interaction logic
│   ├── script.js            # SPA Routing & application flow
│   └── style.css            # Premium visual CSS stylesheet
└── .gitignore               # Ignored logs, dependencies, and build outputs
```

---

## 📝 License

This project is licensed under the terms of the license files included in this repository.
