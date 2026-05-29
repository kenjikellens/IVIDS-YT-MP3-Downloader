/**
 * ui/renderer.js — Unified Frontend Application Controller
 * 
 * Dynamically detects the runtime environment (Electron vs. Web Browser)
 * and directs folder browse triggers, download starts, cancels, and real-time
 * progress/log updates to either Electron secure IPC APIs or standard Python REST/SSE routes.
 */

/** @type {EventSource|null} Reference to the active SSE download stream (Browser Mode only) */
var activeEventSource = null;

/**
 * Toggles the visibility of the advanced settings panel in the UI.
 * Toggles the 'visible' class on the settings panel container and updates the chevron.
 */
function toggleAdvanced() {
    var panel = document.getElementById('advanced-panel');
    var chevron = document.getElementById('advanced-chevron');
    if (panel) {
        var isVisible = panel.classList.toggle('visible');
        if (chevron) {
            chevron.textContent = isVisible ? '▲' : '▼';
        }
    }
}

/**
 * Changes the active user interface theme.
 * Updates the global document root class and saves the preference to local storage.
 * 
 * @param {string} theme - The target theme name ('light' or 'dark')
 */
function changeTheme(theme) {
    var themeBtn = document.getElementById('theme-btn');
    if (theme === 'light') {
        document.documentElement.classList.add('light-theme');
        if (themeBtn) {
            themeBtn.textContent = '🌙';
            themeBtn.title = 'Switch to Dark Mode';
        }
    } else {
        document.documentElement.classList.remove('light-theme');
        if (themeBtn) {
            themeBtn.textContent = '☀️';
            themeBtn.title = 'Switch to Light Mode';
        }
    }
    try {
        localStorage.setItem('app-theme', theme);
    } catch (e) {
        // Catch and ignore local storage write permissions errors in sandboxed browser runs
    }
}

/**
 * Toggles the active theme between light and dark modes.
 * Reads the current theme selection from storage and switches it.
 */
function toggleTheme() {
    var currentTheme = 'dark';
    try {
        currentTheme = localStorage.getItem('app-theme') || 'dark';
    } catch (e) {
        // Fallback to default theme on storage read permission failure
    }
    var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    changeTheme(nextTheme);
}

/**
 * Updates the text label displaying the target save directory path.
 * 
 * @param {string} path - The absolute folder path
 */
function setOutputDir(path) {
    var dirElement = document.getElementById('dir-path');
    if (dirElement) {
        dirElement.textContent = path;
    }
}

/**
 * Handles directory choosing dialog triggering.
 * Routes to Electron native dialog API if in Electron, or Python filedialog API if in browser.
 */
async function browseDirectory() {
    try {
        var isElectron = !!window.electronAPI;
        var folderPath = null;

        if (isElectron) {
            // Electron context bridge dialog call
            folderPath = await window.electronAPI.selectDirectory();
        } else {
            // Fetch GET request to Python tk.filedialog wrapper
            var response = await fetch('/api/select-directory');
            if (!response.ok) throw new Error('Network error selecting folder');
            var data = await response.json();
            folderPath = data.path;
        }

        if (folderPath) {
            setOutputDir(folderPath);
            addLog('Output folder set to: ' + folderPath);
        }
    } catch (err) {
        addLog('[Error] Failed to select directory: ' + err.message);
    }
}

/**
 * Initiates the download task.
 * Reads form data, disables UI controls, and triggers the download runner.
 */
function startDownload() {
    var urlInput = document.getElementById('url-input');
    var url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
        addLog('[Warning] Please enter a YouTube URL.');
        return;
    }

    var formatSelect = document.getElementById('format-select');
    var qualitySelect = document.getElementById('quality-select');
    var startRangeInput = document.getElementById('start-range');
    var endRangeInput = document.getElementById('end-range');

    var format = formatSelect ? formatSelect.value : 'mp3';
    var quality = qualitySelect ? qualitySelect.value : '192k';
    
    var startVal = startRangeInput ? startRangeInput.value.trim() : '';
    var endVal = endRangeInput ? endRangeInput.value.trim() : '';
    
    var startIdx = startVal ? parseInt(startVal) : 1;
    var endIdx = endVal ? parseInt(endVal) : -1;
    
    if (isNaN(startIdx)) startIdx = 1;
    if (isNaN(endIdx)) endIdx = -1;

    var dirElement = document.getElementById('dir-path');
    var outputDir = dirElement ? dirElement.textContent.trim() : '';

    // Lock visual components during download execution
    var downloadBtn = document.getElementById('btn-download');
    var cancelBtn = document.getElementById('btn-cancel');
    var consoleElement = document.getElementById('console');

    if (downloadBtn) downloadBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = false;
    if (consoleElement) consoleElement.innerHTML = '';
    
    setProgress(0);
    addLog('Initializing download job...');

    var options = {
        url: url,
        outputDir: outputDir,
        format: format,
        quality: quality,
        startIdx: startIdx,
        endIdx: endIdx
    };

    var isElectron = !!window.electronAPI;
    if (isElectron) {
        // Electron IPC request
        window.electronAPI.startDownload(options);
    } else {
        // SSE EventSource request to Python HTTP server
        var queryParams = new URLSearchParams(options);
        var source = new EventSource('/api/download?' + queryParams.toString());
        activeEventSource = source;

        // Listen for live standard output log events
        source.addEventListener('log', function(e) {
            try {
                var msg = JSON.parse(e.data);
                addLog(msg);
            } catch (err) {}
        });

        // Listen for overall progress updates
        source.addEventListener('progress', function(e) {
            try {
                var percent = JSON.parse(e.data);
                setProgress(percent);
            } catch (err) {}
        });

        // Listen for status descriptions
        source.addEventListener('status', function(e) {
            try {
                var data = JSON.parse(e.data);
                setStatus(data.status, data.track);
            } catch (err) {}
        });

        // Listen for execution completion
        source.addEventListener('complete', function(e) {
            try {
                var data = JSON.parse(e.data);
                onComplete(data.success, data.errorMsg);
            } catch (err) {}
            source.close();
            activeEventSource = null;
        });

        // Handle error terminations
        source.addEventListener('error', function(e) {
            onComplete(false, 'Connection lost or stream terminated.');
            source.close();
            activeEventSource = null;
        });
    }
}

/**
 * Signals backend processes to cancel active download jobs.
 * Clears EventSource connections in browser mode, or posts cancel IPC in Electron.
 */
async function cancelDownload() {
    addLog('Sending cancel request...');
    
    var isElectron = !!window.electronAPI;
    if (isElectron) {
        // Send cancel event to Electron main process
        window.electronAPI.cancelDownload();
    } else {
        // Close EventSource stream and fetch cancel endpoint on Python server
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }
        try {
            await fetch('/api/cancel');
        } catch (err) {}
    }
}

/**
 * Updates the visual progress fill bar width.
 * 
 * @param {number} percent - Completion percentage integer (0 - 100)
 */
function setProgress(percent) {
    var fill = document.getElementById('progress-fill');
    if (fill) {
        fill.style.width = percent + '%';
    }
}

/**
 * Sets status message values on the headers.
 * 
 * @param {string} status - Diagnostic operation step text
 * @param {string} track - Active video/audio track title name
 */
function setStatus(status, track) {
    var statusText = document.getElementById('status-text');
    var trackText = document.getElementById('track-text');
    
    if (statusText) statusText.textContent = 'Status: ' + status;
    if (trackText) trackText.textContent = track;
}

/**
 * Restores visual control buttons and prints final results to log viewers.
 * 
 * @param {boolean} success - True if download queue completed successfully
 * @param {string|null} errorMsg - Optional summary details if success is false
 */
function onComplete(success, errorMsg) {
    var downloadBtn = document.getElementById('btn-download');
    var cancelBtn = document.getElementById('btn-cancel');

    if (downloadBtn) downloadBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = true;

    if (success) {
        setProgress(100);
        setStatus('Completed', 'Finished!');
        addLog('[Success] All tasks finished successfully!');
    } else {
        setStatus('Failed', '');
        if (errorMsg) {
            addLog('[Error] ' + errorMsg);
        } else {
            addLog('[Warning] Job was cancelled.');
        }
    }
}

/**
 * Prints tagged, color-coded strings to the scrollable terminal console log.
 * 
 * @param {string} msg - Standard log string
 */
function addLog(msg) {
    var el = document.createElement('div');
    el.className = 'log-line';
    
    if (msg.indexOf('[Success]') !== -1) {
        el.className += ' log-success';
    } else if (msg.indexOf('[Error]') !== -1) {
        el.className += ' log-error';
    } else if (msg.indexOf('[Warning]') !== -1) {
        el.className += ' log-warn';
    }
    
    el.textContent = msg;
    
    var consoleContainer = document.getElementById('console');
    if (consoleContainer) {
        consoleContainer.appendChild(el);
        consoleContainer.scrollTop = consoleContainer.scrollHeight;
    }
}

// ===== YouTube Preview Helpers =====

/** @type {number|null} Debounce timer handle for URL input preview updates */
var previewDebounceTimer = null;

/**
 * Extracts a YouTube video ID or playlist ID from a given URL string.
 * Returns an object with `type` ('video' or 'playlist') and the corresponding `id`.
 *
 * @param {string} url - The YouTube URL to parse
 * @returns {{ type: string, id: string } | null} Parsed result or null if no match
 */
function extractYouTubeId(url) {
    if (!url) return null;

    // Match playlist URLs (list= parameter)
    var playlistMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);

    // Match standard video URLs (watch?v=, youtu.be/, embed/, shorts/)
    var videoMatch = url.match(
        /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );

    // Prefer playlist embed if a list param is present
    if (playlistMatch) {
        return { type: 'playlist', id: playlistMatch[1] };
    }
    if (videoMatch) {
        return { type: 'video', id: videoMatch[1] };
    }
    return null;
}

/**
 * Updates the preview panel based on the current URL input value.
 * Shows a YouTube embed iframe for valid URLs, or the empty state placeholder otherwise.
 */
function updatePreview() {
    var urlInput = document.getElementById('url-input');
    var emptyState = document.getElementById('preview-empty');
    var embedContainer = document.getElementById('preview-embed');
    var iframe = document.getElementById('preview-iframe');
    if (!urlInput || !emptyState || !embedContainer || !iframe) return;

    var parsed = extractYouTubeId(urlInput.value.trim());

    if (parsed) {
        var embedSrc = '';
        if (parsed.type === 'playlist') {
            embedSrc = 'https://www.youtube.com/embed/videoseries?list=' + parsed.id;
        } else {
            embedSrc = 'https://www.youtube.com/embed/' + parsed.id;
        }

        // Only reload iframe if the source actually changed
        if (iframe.src !== embedSrc) {
            iframe.src = embedSrc;
        }
        emptyState.style.display = 'none';
        embedContainer.style.display = '';
    } else {
        iframe.src = '';
        emptyState.style.display = '';
        embedContainer.style.display = 'none';
    }
}

// ===== Initial Registration and Setup =====
/**
 * Setup hook running on DOM content loaded.
 * Reconciles the runtime environment (Electron vs browser), fetches directories, and applies themes.
 */
window.addEventListener('DOMContentLoaded', async () => {
    // Bind UI control action event listeners
    var btnBrowse = document.getElementById('btn-browse');
    var advancedToggle = document.getElementById('advanced-toggle');
    var btnDownload = document.getElementById('btn-download');
    var btnCancel = document.getElementById('btn-cancel');
    var themeBtn = document.getElementById('theme-btn');

    if (btnBrowse) btnBrowse.addEventListener('click', browseDirectory);
    if (advancedToggle) advancedToggle.addEventListener('click', toggleAdvanced);
    if (btnDownload) btnDownload.addEventListener('click', startDownload);
    if (btnCancel) btnCancel.addEventListener('click', cancelDownload);
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // Bind URL input listener with debounce to update preview panel
    var urlInput = document.getElementById('url-input');
    if (urlInput) {
        urlInput.addEventListener('input', function () {
            clearTimeout(previewDebounceTimer);
            previewDebounceTimer = setTimeout(updatePreview, 400);
        });
        // Also update on paste immediately
        urlInput.addEventListener('paste', function () {
            setTimeout(updatePreview, 50);
        });
    }

    // Load and apply saved theme preference on DOMContentLoaded
    var savedTheme = 'dark';
    try {
        savedTheme = localStorage.getItem('app-theme') || 'dark';
    } catch (e) {
        // Fallback theme setting in case storage is disallowed
    }
    changeTheme(savedTheme);

    var isElectron = !!window.electronAPI;

    if (isElectron) {
        // 1. Register titlebar window control click actions
        var minBtn = document.getElementById('btn-minimize');
        var maxBtn = document.getElementById('btn-maximize');
        var closeBtn = document.getElementById('btn-close');

        if (minBtn) minBtn.addEventListener('click', () => window.electronAPI.windowMinimize());
        if (maxBtn) maxBtn.addEventListener('click', () => window.electronAPI.windowMaximize());
        if (closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.windowClose());

        // 2. Attach callbacks for Electron main process backend events
        window.electronAPI.onLog((msg) => addLog(msg));
        window.electronAPI.onProgress((percent) => setProgress(percent));
        window.electronAPI.onStatus((data) => setStatus(data.status, data.track));
        window.electronAPI.onComplete((data) => onComplete(data.success, data.errorMsg));

        // 3. Fetch default downloads directory path from Electron
        try {
            var defaultDir = await window.electronAPI.getDefaultDir();
            setOutputDir(defaultDir);
        } catch (err) {
            setOutputDir('Failed to load default directory');
        }
    } else {
        // Web Browser / Python Server Mode: Hide custom titlebar entirely and add browser mode class to body/html
        var titlebar = document.getElementById('app-titlebar');
        if (titlebar) titlebar.style.display = 'none';
        document.documentElement.classList.add('browser-mode');

        // Fetch default downloads directory path from Python REST API
        try {
            var response = await fetch('/api/get-default-dir');
            if (response.ok) {
                var data = await response.json();
                if (data.path) {
                    setOutputDir(data.path);
                }
            }
        } catch (err) {
            setOutputDir('Failed to load default directory');
        }
    }
});
