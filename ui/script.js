/**
 * ui/script.js — Unified Frontend Application Controller
 * 
 * Manages navigation tabs, advanced panels, automatic and manual metadata card previews,
 * download triggers, local storage download history tracking, and responsive mobile sidebar togglers.
 * Integrates Electron secure ContextBridge IPC and Python fallback HTTP Server REST/SSE routes.
 */

/** @type {EventSource|null} Reference to active SSE download stream (Browser Mode fallback only) */
var activeEventSource = null;

/** @type {Array<Object>} Currently loaded tracks metadata array */
var loadedTracks = [];

/** @type {number|null} Debounce timer handle for URL input auto-load triggering */
var autoLoadDebounceTimer = null;

/**
 * Toggles the advanced settings dropdown panel visibility.
 * Toggles 'visible' utility class on the panel container and flips the chevron.
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
 * Toggles the navigation tabs between pages.
 * Handles home download settings card layouts and download history lists toggling.
 * 
 * @param {string} targetPageId - The ID of the page section ('page-home' or 'page-downloads')
 */
function navigateTo(targetPageId) {
    document.querySelectorAll('.page').forEach(function(page) {
        page.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.classList.remove('active');
    });

    var activePage = document.getElementById(targetPageId);
    if (activePage) {
        activePage.classList.add('active');
    }

    if (targetPageId === 'page-home') {
        document.getElementById('nav-home').classList.add('active');
    } else if (targetPageId === 'page-downloads') {
        document.getElementById('nav-downloads').classList.add('active');
        renderDownloadHistory();
    }
    
    closeSidebar();
}

/**
 * Toggles the mobile navigation drawer menu drawer open/closed states.
 */
function toggleSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('visible');
    }
}

/**
 * Closes the mobile navigation drawer sidebar and hides the overlay backdrop.
 */
function closeSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
    }
}

/**
 * Applies the selected color theme classes to the application HTML node.
 * Stores the chosen theme preferences in the LocalStorage.
 * 
 * @param {string} theme - Theme name option ('dark' or 'light')
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
    } catch (e) {}
}

/**
 * Flips the color theme class mapping settings.
 */
function toggleTheme() {
    var currentTheme = 'dark';
    try {
        currentTheme = localStorage.getItem('app-theme') || 'dark';
    } catch (e) {}
    var nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    changeTheme(nextTheme);
}

/**
 * Configures the save location directory path label element.
 * 
 * @param {string} folderPath - Target OS directory location
 */
function setOutputDir(folderPath) {
    var dirElement = document.getElementById('dir-path');
    if (dirElement) {
        dirElement.textContent = folderPath;
    }
}

/**
 * Prompts native OS directory browser dialogs.
 * Integrates Electron ContextBridge dialogue APIs or Python REST filedialog dialog triggers.
 */
async function browseDirectory() {
    try {
        var isElectron = !!window.electronAPI;
        var folderPath = null;

        if (isElectron) {
            folderPath = await window.electronAPI.selectDirectory();
        } else {
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
 * Parses track durations in seconds into formatted MM:SS length values.
 * 
 * @param {number|null} durationSeconds - Video duration count in seconds
 * @returns {string} Formatted length string
 */
function formatDuration(durationSeconds) {
    if (!durationSeconds || isNaN(durationSeconds)) return 'Unknown';
    var minutes = Math.floor(durationSeconds / 60);
    var seconds = Math.floor(durationSeconds % 60);
    if (seconds < 10) seconds = '0' + seconds;
    return minutes + ':' + seconds;
}

/**
 * Triggers backend flat-playlist queries to parse metadata.
 * Populates single or playlist track preview cards list with checkboxes.
 */
async function loadMetadata() {
    var urlInput = document.getElementById('url-input');
    var url = urlInput ? urlInput.value.trim() : '';
    if (!url) return;

    var btnLoad = document.getElementById('btn-load-info');
    if (btnLoad) {
        btnLoad.disabled = true;
        btnLoad.textContent = 'Loading...';
    }

    addLog('Fetching metadata details for URL...');

    // Switch previews panel states to empty/loading placeholder
    showPreviewState('empty');
    document.getElementById('state-empty').innerHTML = '<p>Loading tracks metadata...</p>';

    try {
        var isElectron = !!window.electronAPI;
        var tracks = [];

        if (isElectron) {
            var res = await window.electronAPI.fetchMetadata(url);
            if (res.error) throw new Error(res.error);
            tracks = res.tracks || [];
        } else {
            var res = await fetch('/api/fetch-metadata?url=' + encodeURIComponent(url));
            if (!res.ok) throw new Error('Network error loading metadata');
            var data = await res.json();
            if (data.error) throw new Error(data.error);
            tracks = data.tracks || [];
        }

        loadedTracks = tracks;
        renderPreview(tracks);
    } catch (err) {
        addLog('[Error] Failed loading metadata: ' + err.message);
        document.getElementById('state-empty').innerHTML = 
            '<svg class="preview-empty-icon" viewBox="0 0 24 24" width="44" height="44">' +
                '<path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM9.5 16.5l7-4.5-7-4.5v9z"/>' +
            '</svg>' +
            '<p style="color:var(--accent-red);">[Error] ' + err.message + '</p>';
    } finally {
        if (btnLoad) {
            btnLoad.disabled = false;
            btnLoad.textContent = 'Load Info';
        }
    }
}

/**
 * Toggles preview state displays (empty, single, playlist) inside the right panel.
 * 
 * @param {string} state - Preview state selection ('empty' | 'single' | 'playlist')
 */
function showPreviewState(state) {
    document.getElementById('state-empty').style.display = 'none';
    document.getElementById('state-single').style.display = 'none';
    document.getElementById('state-playlist').style.display = 'none';

    if (state === 'empty') {
        document.getElementById('state-empty').style.display = 'flex';
    } else if (state === 'single') {
        document.getElementById('state-single').style.display = 'flex';
    } else if (state === 'playlist') {
        document.getElementById('state-playlist').style.display = 'flex';
    }
}

/**
 * Loops and renders track card elements inside the preview panel container.
 * Renders a single metadata card if length is 1, or checklist arrays if greater.
 * 
 * @param {Array<Object>} tracks - Array of track metadata objects
 */
function renderPreview(tracks) {
    if (!tracks || tracks.length === 0) {
        showPreviewState('empty');
        document.getElementById('state-empty').innerHTML = 
            '<svg class="preview-empty-icon" viewBox="0 0 24 24" width="44" height="44">' +
                '<path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM9.5 16.5l7-4.5-7-4.5v9z"/>' +
            '</svg>' +
            '<p>No tracks or video information found.</p>';
        return;
    }

    if (tracks.length === 1) {
        // Render Single Video Card Preview
        showPreviewState('single');
        var track = tracks[0];
        var container = document.getElementById('single-video-card');
        
        var thumbUrl = 'https://img.youtube.com/vi/' + track.id + '/mqdefault.jpg';
        var durationText = track.duration ? formatDuration(track.duration) : '';

        var initials = track.channel ? track.channel.substring(0, 2).toUpperCase() : 'YT';

        container.innerHTML = 
            '<div class="video-thumb">' +
                '<img src="' + thumbUrl + '" alt="Thumbnail" onerror="this.src=\'\'">' +
                (durationText ? '<span class="video-duration">' + durationText + '</span>' : '') +
            '</div>' +
            '<div class="video-info">' +
                '<div class="video-info-title">' + track.title + '</div>' +
                '<div class="video-info-channel">' +
                    '<div class="channel-avatar">' + initials + '</div>' +
                    '<span>' + track.channel + '</span>' +
                '</div>' +
                '<div style="font-size:11px; color:var(--text-muted); margin-top: 4px;">Length: ' + durationText + '</div>' +
            '</div>';
    } else {
        // Render Playlist Cards Checklist
        showPreviewState('playlist');
        document.getElementById('track-count-text').textContent = tracks.length + ' tracks found';

        var list = document.getElementById('track-list');
        list.innerHTML = '';

        tracks.forEach(function(t, idx) {
            var label = document.createElement('label');
            label.className = 'track-item';

            var thumbUrl = 'https://img.youtube.com/vi/' + t.id + '/mqdefault.jpg';
            var durationText = t.duration ? formatDuration(t.duration) : 'Unknown';

            label.innerHTML = 
                '<input type="checkbox" class="track-cb" checked data-id="' + t.id + '">' +
                '<div class="track-thumb">' +
                    '<img src="' + thumbUrl + '" alt="" onerror="this.src=\'\'">' +
                '</div>' +
                '<div class="track-info">' +
                    '<div class="track-title">' + (idx + 1) + '. ' + t.title + '</div>' +
                    '<div class="track-artist">' + t.channel + '</div>' +
                    '<div class="track-length">Length: ' + durationText + '</div>' +
                '</div>';

            list.appendChild(label);
        });
    }
}

/**
 * Toggles all selection checkboxes in the playlist checklist panel.
 * 
 * @param {boolean} checked - True to select all checkboxes, false to clear
 */
function toggleSelectAll(checked) {
    document.querySelectorAll('.track-cb').forEach(function(cb) {
        cb.checked = checked;
    });
}

/**
 * Validates the inputs and triggers sequential background download queue schedules.
 */
function startDownload() {
    var urlInput = document.getElementById('url-input');
    var url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
        addLog('[Warning] Please enter a YouTube URL.');
        return;
    }

    var dirElement = document.getElementById('dir-path');
    var outputDir = dirElement ? dirElement.textContent.trim() : '';

    var formatSelect = document.getElementById('format-select');
    var qualitySelect = document.getElementById('quality-select');
    var format = formatSelect ? formatSelect.value : 'mp3';
    var quality = qualitySelect ? qualitySelect.value : '192k';

    // Collect Selected track IDs
    var selectedIds = [];
    document.querySelectorAll('.track-cb').forEach(function(cb) {
        if (cb.checked) {
            var tid = cb.getAttribute('data-id');
            if (tid) selectedIds.push(tid);
        }
    });

    // If playlist items are loaded, require at least one checkbox selection
    if (loadedTracks.length > 1 && selectedIds.length === 0) {
        addLog('[Warning] No playlist tracks are selected for download.');
        return;
    }

    // Toggle active state buttons
    var btnDownload = document.getElementById('btn-download');
    var btnCancel = document.getElementById('btn-cancel');
    var consoleElement = document.getElementById('console');

    if (btnDownload) btnDownload.disabled = true;
    if (btnCancel) btnCancel.disabled = false;
    if (consoleElement) consoleElement.innerHTML = '';

    setProgress(0);
    addLog('Initializing download job...');

    var options = {
        url: url,
        outputDir: outputDir,
        format: format,
        quality: quality,
        startIdx: 1,
        endIdx: -1,
        selectedIds: selectedIds
    };

    var isElectron = !!window.electronAPI;
    if (isElectron) {
        window.electronAPI.startDownload(options);
    } else {
        // SSE EventSource query formatting
        var queryParams = new URLSearchParams({
            url: options.url,
            outputDir: options.outputDir,
            format: options.format,
            quality: options.quality,
            startIdx: 1,
            endIdx: -1
        });
        if (selectedIds.length > 0) {
            queryParams.append('selectedIds', selectedIds.join(','));
        }

        var source = new EventSource('/api/download?' + queryParams.toString());
        activeEventSource = source;

        source.addEventListener('log', function(e) {
            try {
                var msg = JSON.parse(e.data);
                addLog(msg);
            } catch (err) {}
        });

        source.addEventListener('progress', function(e) {
            try {
                var percent = JSON.parse(e.data);
                setProgress(percent);
            } catch (err) {}
        });

        source.addEventListener('status', function(e) {
            try {
                var data = JSON.parse(e.data);
                setStatus(data.status, data.track);
            } catch (err) {}
        });

        source.addEventListener('complete', function(e) {
            try {
                var data = JSON.parse(e.data);
                onComplete(data.success, data.errorMsg);
            } catch (err) {}
            source.close();
            activeEventSource = null;
        });

        source.addEventListener('error', function(e) {
            onComplete(false, 'Connection lost or stream terminated.');
            source.close();
            activeEventSource = null;
        });
    }
}

/**
 * Signals backend download managers to cancel active execution streams.
 */
async function cancelDownload() {
    addLog('Sending cancel request...');
    var isElectron = !!window.electronAPI;
    if (isElectron) {
        window.electronAPI.cancelDownload();
    } else {
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
 * Updates visual progress percentage fill-bar width indicators.
 * 
 * @param {number} percent - Completion percent value (0 - 100)
 */
function setProgress(percent) {
    var fill = document.getElementById('progress-fill');
    if (fill) {
        fill.style.width = percent + '%';
    }
}

/**
 * Updates the text descriptions inside progress headers.
 * 
 * @param {string} status - Description indicating active process steps
 * @param {string} track - Active filename/track heading description
 */
function setStatus(status, track) {
    var statusText = document.getElementById('status-text');
    var trackText = document.getElementById('track-text');
    if (statusText) statusText.textContent = 'Status: ' + status;
    if (trackText) trackText.textContent = track;
}

/**
 * Restores visual download buttons and logs completions.
 * Adds downloads to history storage arrays on successful completions.
 * 
 * @param {boolean} success - True if queue resolved without fatal crashes
 * @param {string|null} errorMsg - Summary error logs
 */
function onComplete(success, errorMsg) {
    var btnDownload = document.getElementById('btn-download');
    var btnCancel = document.getElementById('btn-cancel');

    if (btnDownload) btnDownload.disabled = false;
    if (btnCancel) btnCancel.disabled = true;

    // Track active target details to save
    var targetTitle = 'YouTube Download';
    var qualitySelect = document.getElementById('quality-select');
    var formatSelect = document.getElementById('format-select');
    var q = qualitySelect ? qualitySelect.value : '192k';
    var f = formatSelect ? formatSelect.value : 'mp3';

    if (loadedTracks.length === 1) {
        targetTitle = loadedTracks[0].title;
    } else if (loadedTracks.length > 1) {
        var selectedCount = 0;
        document.querySelectorAll('.track-cb').forEach(function(cb) {
            if (cb.checked) selectedCount++;
        });
        targetTitle = 'Playlist Queue (' + selectedCount + ' tracks)';
    }

    if (success) {
        setProgress(100);
        setStatus('Completed', 'Finished!');
        addLog('[Success] All tasks finished successfully!');
        
        saveDownloadRecord(targetTitle, f.toUpperCase() + ' • ' + q.replace('k', ' kbps'), true);
    } else {
        setStatus('Failed', '');
        if (errorMsg) {
            addLog('[Error] ' + errorMsg);
            saveDownloadRecord(targetTitle, f.toUpperCase() + ' • ' + q.replace('k', ' kbps') + ' • ' + errorMsg, false);
        } else {
            addLog('[Warning] Job was cancelled.');
            saveDownloadRecord(targetTitle, f.toUpperCase() + ' • ' + q.replace('k', ' kbps') + ' • Cancelled', false);
        }
    }
}

/**
 * Appends standard log lines inside the diagnostic output console box.
 * 
 * @param {string} msg - Log string output
 */
function addLog(msg) {
    var div = document.createElement('div');
    div.className = 'log-line';

    if (msg.indexOf('[Success]') !== -1) {
        div.className += ' log-success';
    } else if (msg.indexOf('[Error]') !== -1) {
        div.className += ' log-error';
    } else if (msg.indexOf('[Warning]') !== -1) {
        div.className += ' log-warn';
    }

    div.textContent = msg;

    var consoleContainer = document.getElementById('console');
    if (consoleContainer) {
        consoleContainer.appendChild(div);
        consoleContainer.scrollTop = consoleContainer.scrollHeight;
    }
}

// ===== LOCALSTORAGE HISTORY TRACKING =====

/**
 * Commits a completed download record into localStorage arrays.
 * 
 * @param {string} title - Target song or playlist identifier name
 * @param {string} meta - Quality, format, and diagnostic descriptions
 * @param {boolean} success - Complete success flag
 */
function saveDownloadRecord(title, meta, success) {
    try {
        var list = JSON.parse(localStorage.getItem('dl-history') || '[]');
        var date = new Date();
        var dateString = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        list.unshift({
            title: title,
            meta: meta + ' • ' + dateString,
            success: success
        });

        // Limit local history cache sizes to last 50 entries
        if (list.length > 50) list.pop();
        localStorage.setItem('dl-history', JSON.stringify(list));
    } catch (e) {}
}

/**
 * Reads local storage history list and renders entries inside the downloads view panel.
 */
function renderDownloadHistory() {
    var emptyState = document.getElementById('downloads-empty-state');
    var listContainer = document.getElementById('downloads-list-items');
    if (!listContainer || !emptyState) return;

    var list = [];
    try {
        list = JSON.parse(localStorage.getItem('dl-history') || '[]');
    } catch (e) {}

    listContainer.innerHTML = '';

    if (list.length === 0) {
        emptyState.style.display = 'flex';
        listContainer.style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        listContainer.style.display = 'flex';

        list.forEach(function(item) {
            var div = document.createElement('div');
            div.className = 'dl-item';

            var svgIcon = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
            var badgeClass = item.success ? 'success' : 'failed';
            var badgeText = item.success ? 'Done' : 'Failed';

            div.innerHTML = 
                '<div class="dl-icon">' + svgIcon + '</div>' +
                '<div class="dl-info">' +
                    '<div class="dl-title">' + item.title + '</div>' +
                    '<div class="dl-meta">' + item.meta + '</div>' +
                '</div>' +
                '<span class="dl-badge ' + badgeClass + '">' + badgeText + '</span>';

            listContainer.appendChild(div);
        });
    }
}

/**
 * Flushes all downloaded elements in local storage history array cache.
 */
function clearDownloadHistory() {
    try {
        localStorage.removeItem('dl-history');
    } catch (e) {}
    renderDownloadHistory();
    addLog('Downloads history cleared.');
}

// ===== APPLICATION INITIAL SETUP =====

window.addEventListener('DOMContentLoaded', async () => {
    // Bind General Action triggers
    var btnBrowse = document.getElementById('btn-browse');
    var advancedToggle = document.getElementById('advanced-toggle');
    var btnDownload = document.getElementById('btn-download');
    var btnCancel = document.getElementById('btn-cancel');
    var themeBtn = document.getElementById('theme-btn');
    var hamburgerBtn = document.getElementById('hamburger-btn');
    var sidebarOverlay = document.getElementById('sidebar-overlay');
    var btnLoadInfo = document.getElementById('btn-load-info');

    // Page navigation anchors
    var navHome = document.getElementById('nav-home');
    var navDownloads = document.getElementById('nav-downloads');
    var btnClearHistory = document.getElementById('btn-clear-history');

    // Checklist toggles
    var btnSelectAll = document.getElementById('btn-select-all');
    var btnDeselectAll = document.getElementById('btn-deselect-all');

    if (btnBrowse) btnBrowse.addEventListener('click', browseDirectory);
    if (advancedToggle) advancedToggle.addEventListener('click', toggleAdvanced);
    if (btnDownload) btnDownload.addEventListener('click', startDownload);
    if (btnCancel) btnCancel.addEventListener('click', cancelDownload);
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    if (btnLoadInfo) btnLoadInfo.addEventListener('click', loadMetadata);
    if (btnClearHistory) btnClearHistory.addEventListener('click', clearDownloadHistory);

    // Sidebar selectors
    if (hamburgerBtn) hamburgerBtn.addEventListener('click', toggleSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);
    if (navHome) navHome.addEventListener('click', () => navigateTo('page-home'));
    if (navDownloads) navDownloads.addEventListener('click', () => navigateTo('page-downloads'));

    // Checklist buttons selection triggers
    if (btnSelectAll) btnSelectAll.addEventListener('click', () => toggleSelectAll(true));
    if (btnDeselectAll) btnDeselectAll.addEventListener('click', () => toggleSelectAll(false));

    // Input changes triggers auto metadata loads
    var urlInput = document.getElementById('url-input');
    if (urlInput) {
        urlInput.addEventListener('input', function() {
            clearTimeout(autoLoadDebounceTimer);
            autoLoadDebounceTimer = setTimeout(loadMetadata, 500);
        });
        urlInput.addEventListener('paste', function() {
            setTimeout(loadMetadata, 50);
        });
    }

    // Load initial theme preference
    var savedTheme = 'dark';
    try {
        savedTheme = localStorage.getItem('app-theme') || 'dark';
    } catch (e) {}
    changeTheme(savedTheme);

    var isElectron = !!window.electronAPI;
    if (isElectron) {
        // Register titlebar buttons handlers
        var minBtn = document.getElementById('btn-minimize');
        var maxBtn = document.getElementById('btn-maximize');
        var closeBtn = document.getElementById('btn-close');

        if (minBtn) minBtn.addEventListener('click', () => window.electronAPI.windowMinimize());
        if (maxBtn) maxBtn.addEventListener('click', () => window.electronAPI.windowMaximize());
        if (closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.windowClose());

        // Register main process callback receivers
        window.electronAPI.onLog((msg) => addLog(msg));
        window.electronAPI.onProgress((percent) => setProgress(percent));
        window.electronAPI.onStatus((data) => setStatus(data.status, data.track));
        window.electronAPI.onComplete((data) => onComplete(data.success, data.errorMsg));

        // Get default folder path
        try {
            var defaultDir = await window.electronAPI.getDefaultDir();
            setOutputDir(defaultDir);
        } catch (e) {
            setOutputDir('C:\\Downloads');
        }
    } else {
        // Browser Mode fallback overrides
        var titlebar = document.getElementById('app-titlebar');
        if (titlebar) titlebar.style.display = 'none';
        document.documentElement.classList.add('browser-mode');

        try {
            var res = await fetch('/api/get-default-dir');
            if (res.ok) {
                var data = await res.json();
                if (data.path) setOutputDir(data.path);
            }
        } catch (e) {
            setOutputDir('/Downloads');
        }
    }
});
