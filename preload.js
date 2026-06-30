/**
 * preload.js — Electron Preload Script (Context Bridge)
 * 
 * Runs in the isolated renderer process context prior to loading the HTML UI.
 * Safely exposes a limited window.electronAPI object containing IPC triggers
 * to the renderer process (best security practice).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

    // ---- Actions (renderer → main) ----

    /**
     * Opens the native OS directory picker dialog window.
     * @returns {Promise<string|null>} The chosen directory path or null if cancelled
     */
    selectDirectory: () => ipcRenderer.invoke('select-directory'),

    /**
     * Retrieves the default OS Downloads directory path.
     * @returns {Promise<string>} The path to the Downloads directory
     */
    getDefaultDir: () => ipcRenderer.invoke('get-default-dir'),

    /**
     * Submits download parameters to initiate a queue run in the main process.
     * @param {Object} options - Parameter options
     */
    startDownload: (options) => ipcRenderer.send('start-download', options),

    /**
     * Aborts the active downloader subprocess.
     */
    cancelDownload: () => ipcRenderer.send('cancel-download'),

    /**
     * Queries playlist/video metadata via Electron IPC.
     * @param {string} url - YouTube URL
     * @returns {Promise<Array>} List of video metadata details
     */
    fetchMetadata: (url) => ipcRenderer.invoke('fetch-metadata', url),

    // ---- Window Controls (custom titlebar hooks) ----

    /** Minimizes the application window */
    windowMinimize: () => ipcRenderer.send('window-minimize'),

    /** Toggles maximize/restore sizes on the application window */
    windowMaximize: () => ipcRenderer.send('window-maximize'),

    /** Closes the application window */
    windowClose: () => ipcRenderer.send('window-close'),

    // ---- Event Listeners (main → renderer callbacks) ----

    /**
     * Registers a callback listener to print backend log strings.
     * @param {function(string)} callback - Receives standard console log outputs
     */
    onLog: (callback) => ipcRenderer.on('log', (_event, msg) => callback(msg)),

    /**
     * Registers a callback listener for progress percentage changes.
     * @param {function(number)} callback - Receives progress values from 0 to 100
     */
    onProgress: (callback) => ipcRenderer.on('progress', (_event, percent) => callback(percent)),

    /**
     * Registers a callback listener for individual track progress updates.
     * @param {function(Object)} callback - Receives dict with id, title, and percent
     */
    onTrackProgress: (callback) => ipcRenderer.on('track-progress', (_event, data) => callback(data)),

    /**
     * Registers a callback listener for download track title shifts.
     * @param {function(Object)} callback - Receives dict with status and track title
     */
    onStatus: (callback) => ipcRenderer.on('status', (_event, data) => callback(data)),

    /**
     * Registers a callback listener for download task terminations.
     * @param {function(Object)} callback - Receives dict with success flag and error details
     */
    onComplete: (callback) => ipcRenderer.on('complete', (_event, data) => callback(data))
});
