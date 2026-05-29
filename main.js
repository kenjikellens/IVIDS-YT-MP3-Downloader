/**
 * main.js — Electron Main Process
 * 
 * Configures the BrowserWindow window parameters (frameless design), loads
 * the HTML UI, and routes IPC events between the frontend UI (renderer.js)
 * and the Node.js downloadManager backend logic.
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const DownloadManager = require('./src/downloadManager');

/** @type {BrowserWindow|null} Holds reference to the active window */
let mainWindow = null;

/** @type {DownloadManager|null} Holds reference to the active download queue task */
let activeManager = null;

/**
 * Creates the browser window, configures frameless settings and preloads,
 * and loads the static index.html file.
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        minWidth: 780,
        minHeight: 600,
        frame: false,                // Frameless window for custom titlebar
        transparent: false,
        backgroundColor: '#0a0a0a',  // Match neutral dark theme background
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,  // Safe separation between Node and renderer context
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('ui/index.html');
}

// ============================================================
// IPC Handlers — secure communications bridge
// ============================================================

/**
 * Opens a native OS folder chooser dialog and returns the selected path.
 * 
 * @returns {Promise<string|null>} The selected directory path or null if cancelled
 */
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Download Folder'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

/**
 * Returns the default downloads folder location of the OS to the frontend.
 * 
 * @returns {string} The path to the Downloads directory
 */
ipcMain.handle('get-default-dir', () => {
    return app.getPath('downloads');
});

/**
 * Resolves yt-dlp dependencies and queries playlist or video metadata.
 * 
 * @param {string} url - YouTube link URL
 * @returns {Promise<Array|Object>} Array of track details or error dict
 */
ipcMain.handle('fetch-metadata', async (event, url) => {
    try {
        const manager = new DownloadManager({ url, outputDir: '' }, {
            onStatusChange: () => {},
            onLog: () => {}
        });
        const ytDlpPath = await manager.resolveYtDlp();
        const tracks = await manager.fetchTrackList(ytDlpPath);
        return { tracks };
    } catch (err) {
        return { error: err.message };
    }
});

/**
 * Starts a download task inside the Node downloadManager.
 * Pipes log, progress, status, and completion triggers back to the window renderer.
 */
ipcMain.on('start-download', (event, options) => {
    if (activeManager) return;

    activeManager = new DownloadManager(options, {
        onLog: (msg) => {
            mainWindow?.webContents.send('log', msg);
        },
        onProgress: (percent) => {
            mainWindow?.webContents.send('progress', percent);
        },
        onStatusChange: (status, track) => {
            mainWindow?.webContents.send('status', { status, track });
        },
        onComplete: (success, errorMsg) => {
            activeManager = null;
            mainWindow?.webContents.send('complete', { success, errorMsg });
        }
    });

    activeManager.run();
});

/**
 * Stops the active downloader subprocess immediately.
 */
ipcMain.on('cancel-download', () => {
    if (activeManager) {
        activeManager.cancel();
    }
});

// ==== Window Controls listeners for the custom titlebar ====

/**
 * Minimizes the main BrowserWindow window.
 */
ipcMain.on('window-minimize', () => mainWindow?.minimize());

/**
 * Maximizes or restores the main BrowserWindow window size.
 */
ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow?.maximize();
    }
});

/**
 * Closes the application.
 */
ipcMain.on('window-close', () => mainWindow?.close());

// ============================================================
// Application Lifecycle events
// ============================================================

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
