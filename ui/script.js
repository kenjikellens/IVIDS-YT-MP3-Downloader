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

/** @type {Object} The current language translation key-value mappings dictionary */
var currentLocaleData = {};

/**
 * Retrieves the translation string for a given key from the loaded locale dictionary.
 * Falls back to the provided default value if the key does not exist.
 */
function getTranslation(key, defaultValue) {
    if (currentLocaleData && currentLocaleData[key] !== undefined) {
        return currentLocaleData[key];
    }
    return defaultValue;
}

/**
 * Updates the text content and placeholder attributes of all localized DOM elements.
 * Triggers re-rendering of active previews and download histories using the new translation.
 */
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
        var key = el.getAttribute('data-i18n');
        var trans = getTranslation(key, '');
        if (trans) {
            el.textContent = trans;
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
        var key = el.getAttribute('data-i18n-placeholder');
        var trans = getTranslation(key, '');
        if (trans) {
            el.setAttribute('placeholder', trans);
        }
    });
    
    renderDownloadHistory();
    if (loadedTracks && loadedTracks.length > 0) {
        renderPreview(loadedTracks);
    }
    syncCustomSelects();
}

/**
 * Asynchronously fetches the JSON locale file for the selected language code.
 * Falls back to English on failure and triggers the DOM translation updates.
 */
async function loadLanguage(langCode) {
    try {
        var response = await fetch('i18n/' + langCode + '.json');
        if (!response.ok) throw new Error('Failed to load language JSON');
        currentLocaleData = await response.json();
    } catch (e) {
        console.warn('Could not load translations for ' + langCode + ', falling back to English.', e);
        try {
            var fallbackResponse = await fetch('i18n/en.json');
            if (fallbackResponse.ok) {
                currentLocaleData = await fallbackResponse.json();
            }
        } catch (err) {
            console.error('Failed to load fallback English translation.', err);
        }
    }
    applyTranslations();
}


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
    } else if (targetPageId === 'page-settings') {
        document.getElementById('nav-settings').classList.add('active');
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
 * Stores the chosen theme preferences in the LocalStorage and updates the custom switch UI.
 * 
 * @param {string} theme - Theme name option ('dark' or 'light')
 */
function changeTheme(theme) {
    var themeSwitch = document.getElementById('theme-switch');
    if (theme === 'light') {
        document.documentElement.classList.add('light-theme');
        if (themeSwitch) {
            themeSwitch.classList.remove('dark');
            themeSwitch.setAttribute('aria-checked', 'false');
            themeSwitch.title = 'Switch to Dark Mode';
        }
    } else {
        document.documentElement.classList.remove('light-theme');
        if (themeSwitch) {
            themeSwitch.classList.add('dark');
            themeSwitch.setAttribute('aria-checked', 'true');
            themeSwitch.title = 'Switch to Light Mode';
        }
    }
    try {
        localStorage.setItem('app-theme', theme);
    } catch (e) {}
}

/**
 * Flips the color theme class mapping settings and updates local storage.
 * Determines the next theme state and propagates it to the layout.
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
 * Opens the native directory chooser dialog to update the active output save folder.
 * Stores the choice in LocalStorage and logs the outcome to the console.
 */
async function browseDirectory() {
    try {
        var isElectron = !!window.electronAPI;
        if (isElectron) {
            var input = document.getElementById('dir-input');
            if (input) input.click();
        } else {
            var response = await fetch('/api/select-directory');
            if (!response.ok) throw new Error('Network error selecting folder');
            var data = await response.json();
            var folderPath = data.path;
            if (folderPath) {
                setOutputDir(folderPath);
                try {
                    localStorage.setItem('last-dir', folderPath);
                } catch (e) {}
                addLog(getTranslation('log_output_folder_set', 'Output folder set to: ') + folderPath);
            }
        }
    } catch (err) {
        addLog('[Error] ' + getTranslation('log_failed_select_dir', 'Failed to select directory: ') + err.message);
    }
}

/**
 * Opens the native directory chooser dialog to update the default startup download folder.
 * Stores the choice in LocalStorage and updates settings and main path displays.
 */
async function browseDefaultDirectory() {
    try {
        var isElectron = !!window.electronAPI;
        if (isElectron) {
            var input = document.getElementById('settings-dir-input');
            if (input) input.click();
        } else {
            var response = await fetch('/api/select-directory');
            if (!response.ok) throw new Error('Network error selecting folder');
            var data = await response.json();
            var folderPath = data.path;
            if (folderPath) {
                try {
                    localStorage.setItem('custom-dir', folderPath);
                    localStorage.setItem('last-dir', folderPath);
                } catch (e) {}
                setOutputDir(folderPath);
                var settingsDirEl = document.getElementById('settings-dir-path');
                if (settingsDirEl) {
                    settingsDirEl.textContent = folderPath;
                }
                addLog(getTranslation('log_custom_folder_set', 'Custom default folder set to: ') + folderPath);
            }
        }
    } catch (err) {
        addLog('[Error] ' + getTranslation('log_failed_select_default_dir', 'Failed to select default directory: ') + err.message);
    }
}

/**
 * Loads and resolves the initial output download folder path according to the saved mode preference.
 * Auto-detects Electron or REST fallback API environments for system default resolve.
 */
async function initOutputDirectory() {
    var isElectron = !!window.electronAPI;
    var mode = 'standard';
    try {
        mode = localStorage.getItem('dir-mode') || 'standard';
    } catch (e) {}

    var activeDir = null;
    if (mode === 'custom') {
        try {
            activeDir = localStorage.getItem('custom-dir');
        } catch (e) {}
    } else if (mode === 'last') {
        try {
            activeDir = localStorage.getItem('last-dir');
        } catch (e) {}
    }

    if (activeDir) {
        setOutputDir(activeDir);
        var settingsDirEl = document.getElementById('settings-dir-path');
        if (settingsDirEl) {
            settingsDirEl.textContent = activeDir;
        }
    } else {
        try {
            var standardPath = null;
            if (isElectron) {
                standardPath = await window.electronAPI.getDefaultDir();
            } else {
                var res = await fetch('/api/get-default-dir');
                if (res.ok) {
                    var data = await res.json();
                    standardPath = data.path;
                }
            }
            if (standardPath) {
                setOutputDir(standardPath);
                var settingsDirEl = document.getElementById('settings-dir-path');
                if (settingsDirEl) {
                    settingsDirEl.textContent = standardPath;
                }
            }
        } catch (e) {
            var fallback = isElectron ? 'C:\\Downloads' : '/Downloads';
            setOutputDir(fallback);
            var settingsDirEl = document.getElementById('settings-dir-path');
            if (settingsDirEl) {
                settingsDirEl.textContent = fallback;
            }
        }
    }
}

/**
 * Handles directory mode changes from settings, toggles custom browse row visibility, and re-resolves the active path.
 */
async function handleDirModeChange() {
    var modeSelect = document.getElementById('settings-dir-mode');
    if (!modeSelect) return;

    var mode = modeSelect.value;
    try {
        localStorage.setItem('dir-mode', mode);
    } catch (e) {}

    var customRow = document.getElementById('settings-custom-dir-row');
    if (customRow) {
        if (mode === 'custom') {
            customRow.classList.remove('hidden');
        } else {
            customRow.classList.add('hidden');
        }
    }

    await initOutputDirectory();
}

/**
 * Formats a track duration value in seconds to a human-readable MM:SS string.
 * Returns a localized unknown string if duration is invalid or not available.
 */
function formatDuration(durationSeconds) {
    if (!durationSeconds || isNaN(durationSeconds)) return getTranslation('preview_unknown', 'Unknown');
    var minutes = Math.floor(durationSeconds / 60);
    var seconds = Math.floor(durationSeconds % 60);
    if (seconds < 10) seconds = '0' + seconds;
    return minutes + ':' + seconds;
}

/**
 * Requests track list metadata details from the backend for the entered YouTube URL.
 * Renders the preview panel state and prints diagnostic logs to the output console.
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

    addLog(getTranslation('log_fetching_metadata', 'Fetching metadata details for URL...'));

    // Switch previews panel states to empty/loading placeholder
    showPreviewState('empty');
    document.getElementById('state-empty').innerHTML = 
        '<div class="spinner"></div>' +
        '<p>' + getTranslation('preview_loading', 'Loading tracks metadata...') + '</p>';

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
        addLog('[Error] ' + getTranslation('log_failed_metadata', 'Failed loading metadata: ') + err.message);
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
 * Dynamically builds and inserts HTML preview cards for loaded single tracks or playlist checklist items.
 * Translates labels and quantities based on the current active interface language.
 */
function renderPreview(tracks) {
    if (!tracks || tracks.length === 0) {
        showPreviewState('empty');
        document.getElementById('state-empty').innerHTML = 
            '<svg class="preview-empty-icon" viewBox="0 0 24 24" width="44" height="44">' +
                '<path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM9.5 16.5l7-4.5-7-4.5v9z"/>' +
            '</svg>' +
            '<p>' + getTranslation('preview_no_tracks', 'No tracks or video information found.') + '</p>';
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
                '<div style="font-size:11px; color:var(--text-muted); margin-top: 4px;">' + getTranslation('preview_length', 'Length: ') + durationText + '</div>' +
            '</div>';
    } else {
        // Render Playlist Cards Checklist
        showPreviewState('playlist');
        var tracksFoundTemplate = getTranslation('preview_tracks_found', 'tracks found');
        var countText = tracks.length + ' ' + tracksFoundTemplate;
        if (tracksFoundTemplate.includes('{count}')) {
            countText = tracksFoundTemplate.replace('{count}', tracks.length);
        }
        document.getElementById('track-count-text').textContent = countText;

        var list = document.getElementById('track-list');
        list.innerHTML = '';

        tracks.forEach(function(t, idx) {
            var label = document.createElement('label');
            label.className = 'track-item';

            var thumbUrl = 'https://img.youtube.com/vi/' + t.id + '/mqdefault.jpg';
            var durationText = t.duration ? formatDuration(t.duration) : getTranslation('preview_unknown', 'Unknown');

            label.innerHTML = 
                '<input type="checkbox" class="track-cb" checked data-id="' + t.id + '">' +
                '<div class="track-thumb">' +
                    '<img src="' + thumbUrl + '" alt="" onerror="this.src=\'\'">' +
                '</div>' +
                '<div class="track-info">' +
                    '<div class="track-title">' + (idx + 1) + '. ' + t.title + '</div>' +
                    '<div class="track-artist">' + t.channel + '</div>' +
                    '<div class="track-length">' + getTranslation('preview_length', 'Length: ') + durationText + '</div>' +
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
 * Gathers active configuration parameters and initiates background download queue streams.
 * Disables start controls, enables cancel controls, and sets up status stream listener callbacks.
 */
function startDownload() {
    var btnDownload = document.getElementById('btn-download');
    
    // Check if the single button is currently in Cancel state.
    // If it is, clicking it triggers the cancel action instead of a new download.
    if (btnDownload && btnDownload.classList.contains('btn-cancel')) {
        cancelDownload();
        return;
    }

    var urlInput = document.getElementById('url-input');
    var url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
        addLog('[Warning] ' + getTranslation('log_warning_enter_url', 'Please enter a YouTube URL.'));
        return;
    }

    var dirElement = document.getElementById('dir-path');
    var outputDir = dirElement ? dirElement.textContent.trim() : '';

    var mediaTypeSelect = document.getElementById('media-type-select');
    var mediaType = mediaTypeSelect ? mediaTypeSelect.value : 'audio';

    var formatSelect = document.getElementById(mediaType === 'audio' ? 'format-select' : 'video-format');
    var qualitySelect = document.getElementById(mediaType === 'audio' ? 'quality-select' : 'video-quality');
    var format = formatSelect ? formatSelect.value : (mediaType === 'audio' ? 'mp3' : 'mp4');
    var quality = qualitySelect ? qualitySelect.value : (mediaType === 'audio' ? '192k' : 'best');

    var subfolderSelect = document.getElementById('subfolder-select');
    var subfolder = subfolderSelect ? subfolderSelect.value : 'none';

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
        addLog('[Warning] ' + getTranslation('log_warning_no_tracks', 'No playlist tracks are selected for download.'));
        return;
    }

    // Toggle active state on the single download button:
    // Change style to cancel (red theme), change translation key to home_cancel, and update button label.
    var consoleElement = document.getElementById('console');

    if (btnDownload) {
        btnDownload.classList.remove('btn-download');
        btnDownload.classList.add('btn-cancel');
        btnDownload.setAttribute('data-i18n', 'home_cancel');
        btnDownload.textContent = getTranslation('home_cancel', 'Cancel');
    }
    if (consoleElement) consoleElement.innerHTML = '';

    setProgress(0);
    var activeProgressContainer = document.getElementById('active-progress-container');
    if (activeProgressContainer) activeProgressContainer.innerHTML = '';
    addLog(getTranslation('log_init_job', 'Initializing download job...'));

    var savedConcurrency = 1;
    try {
        savedConcurrency = parseInt(localStorage.getItem('app-concurrency')) || 1;
    } catch (e) {}

    var options = {
        url: url,
        outputDir: outputDir,
        mediaType: mediaType,
        subfolder: subfolder,
        format: format,
        quality: quality,
        startIdx: 1,
        endIdx: -1,
        selectedIds: selectedIds,
        concurrency: savedConcurrency
    };

    var isElectron = !!window.electronAPI;
    if (isElectron) {
        window.electronAPI.startDownload(options);
    } else {
        // SSE EventSource query formatting
        var queryParams = new URLSearchParams({
            url: options.url,
            outputDir: options.outputDir,
            mediaType: options.mediaType,
            subfolder: options.subfolder,
            format: options.format,
            quality: options.quality,
            startIdx: 1,
            endIdx: -1,
            concurrency: options.concurrency
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

        source.addEventListener('track-progress', function(e) {
            try {
                var data = JSON.parse(e.data);
                updateTrackProgress(data.id, data.title, data.percent);
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
 * Signals backend download subprocess processes or SSE streams to abort active download tasks.
 * Logs the cancellation request event to the diagnostic console.
 */
async function cancelDownload() {
    addLog(getTranslation('log_cancel_request', 'Sending cancel request...'));
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
 * Updates or creates an individual track's progress bar in the progress section.
 * 
 * @param {string} id - The unique YouTube video ID
 * @param {string} title - The track title
 * @param {number} percent - The download/processing percentage (0 - 100)
 */
function updateTrackProgress(id, title, percent) {
    var container = document.getElementById('active-progress-container');
    if (!container) return;

    var pct = Math.min(100, Math.max(0, Math.round(percent || 0)));
    var blockId = 'pb-' + id;
    var block = document.getElementById(blockId);

    if (!block) {
        block = document.createElement('div');
        block.className = 'track-progress-block';
        block.id = blockId;
        block.innerHTML = 
            '<div class="track-progress-info">' +
                '<span class="track-progress-title">' + title + '</span>' +
                '<span class="track-progress-percent" id="pct-' + id + '">0%</span>' +
            '</div>' +
            '<div class="track-progress-bar-container">' +
                '<div class="track-progress-bar-fill" id="fill-' + id + '" style="width: 0%;"></div>' +
            '</div>';
        container.appendChild(block);
    }

    var fill = document.getElementById('fill-' + id);
    var text = document.getElementById('pct-' + id);

    if (fill) {
        fill.style.width = pct + '%';
    }
    if (text) {
        text.textContent = pct + '%';
    }
}

/**
 * Updates the status header text and active track labels using translated terms.
 * Resolves localized status phrases and prefixes according to the current locale.
 */
function setStatus(status, track) {
    var statusText = document.getElementById('status-text');
    var trackText = document.getElementById('track-text');
    
    var translatedStatus = status;
    if (status === 'Idle') {
        translatedStatus = getTranslation('status_idle', 'Idle');
    } else if (status === 'Querying URL...') {
        translatedStatus = getTranslation('status_querying', 'Querying URL...');
    } else if (status === 'Setup...') {
        translatedStatus = getTranslation('status_setup', 'Setup...');
    } else if (status === 'Completed') {
        translatedStatus = getTranslation('status_completed', 'Completed');
    } else if (status === 'Failed') {
        translatedStatus = getTranslation('status_failed', 'Failed');
    } else if (status && status.startsWith('Downloading track ')) {
        var match = status.match(/Downloading track (\d+) of (\d+)/);
        if (match) {
            var current = match[1];
            var total = match[2];
            var template = getTranslation('status_downloading_track', 'Downloading track {current} of {total}');
            translatedStatus = template.replace('{current}', current).replace('{total}', total);
        } else {
            translatedStatus = getTranslation('status_downloading', 'Downloading');
        }
    }
    
    var translatedTrack = track;
    if (track === 'Finished!') {
        translatedTrack = getTranslation('status_finished', 'Finished!');
    } else if (track === 'Downloading yt-dlp') {
        translatedTrack = getTranslation('status_downloading_ytdlp', 'Downloading yt-dlp');
    } else if (track === 'Downloading FFmpeg') {
        translatedTrack = getTranslation('status_downloading_ffmpeg', 'Downloading FFmpeg');
    }
    
    var prefix = getTranslation('status_prefix', 'Status: ');
    if (statusText) statusText.textContent = prefix + translatedStatus;
    if (trackText) trackText.textContent = translatedTrack;
}

/**
 * Re-enables download control buttons and records execution status details in history lists.
 * Evaluates job outcomes, logs success or error results, and translates progress badges.
 */
function onComplete(success, errorMsg) {
    var btnDownload = document.getElementById('btn-download');

    // Reset the single button state back to Download:
    // Change style to download (green theme), change translation key to home_start, and update button label.
    if (btnDownload) {
        btnDownload.classList.remove('btn-cancel');
        btnDownload.classList.add('btn-download');
        btnDownload.setAttribute('data-i18n', 'home_start');
        btnDownload.textContent = getTranslation('home_start', 'Start Download');
        btnDownload.disabled = false;
    }

    // Track active target details to save
    var targetTitle = 'YouTube Download';
    var mediaTypeSelect = document.getElementById('media-type-select');
    var mediaType = mediaTypeSelect ? mediaTypeSelect.value : 'audio';
    var qualitySelect = document.getElementById(mediaType === 'audio' ? 'quality-select' : 'video-quality');
    var formatSelect = document.getElementById(mediaType === 'audio' ? 'format-select' : 'video-format');
    var q = qualitySelect ? qualitySelect.value : (mediaType === 'audio' ? '192k' : 'best');
    var f = formatSelect ? formatSelect.value : (mediaType === 'audio' ? 'mp3' : 'mp4');

    if (loadedTracks.length === 1) {
        targetTitle = loadedTracks[0].title;
    } else if (loadedTracks.length > 1) {
        var selectedCount = 0;
        document.querySelectorAll('.track-cb').forEach(function(cb) {
            if (cb.checked) selectedCount++;
        });
        var template = getTranslation('dl_playlist_queue', 'Playlist Queue ({count} tracks)');
        targetTitle = template.replace('{count}', selectedCount);
    }

    var metaInfo = '';
    if (f === 'best') {
        metaInfo = getTranslation('dl_meta_original', 'Original Quality');
    } else {
        metaInfo = f.toUpperCase() + ' • ' + q.replace('k', ' kbps');
    }

    if (success) {
        setProgress(100);
        setStatus('Completed', 'Finished!');
        addLog('[Success] ' + getTranslation('log_success_finished', 'All tasks finished successfully!'));
        
        saveDownloadRecord(targetTitle, metaInfo, true);
    } else {
        setStatus('Failed', '');
        if (errorMsg) {
            addLog('[Error] ' + errorMsg);
            saveDownloadRecord(targetTitle, metaInfo + ' • ' + errorMsg, false);
        } else {
            addLog('[Warning] ' + getTranslation('log_warning_cancelled', 'Job was cancelled.'));
            saveDownloadRecord(targetTitle, metaInfo + ' • ' + getTranslation('dl_meta_cancelled', 'Cancelled'), false);
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
            var badgeText = item.success ? getTranslation('dl_badge_done', 'Done') : getTranslation('dl_badge_failed', 'Failed');

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
 * Flushes all recorded download records from LocalStorage cache and clears the UI history lists.
 * Logs the history clear operation to the diagnostic output console.
 */
function clearDownloadHistory() {
    try {
        localStorage.removeItem('dl-history');
    } catch (e) {}
    renderDownloadHistory();
    addLog(getTranslation('log_history_cleared', 'Downloads history cleared.'));
}

/**
 * Enables or disables the quality selection dropdown based on the chosen audio format.
 * Disables the dropdown for original untouched streams since they do not undergo transcoding.
 */
function handleFormatChange() {
    var formatSelect = document.getElementById('format-select');
    var qualitySelect = document.getElementById('quality-select');
    if (formatSelect && qualitySelect) {
        if (formatSelect.value === 'best') {
            qualitySelect.disabled = true;
        } else {
            qualitySelect.disabled = false;
        }
    }
}

// ===== APPLICATION INITIAL SETUP =====

window.addEventListener('DOMContentLoaded', async () => {
    // Bind General Action triggers
    var btnBrowse = document.getElementById('btn-browse');
    var advancedToggle = document.getElementById('advanced-toggle');
    var btnDownload = document.getElementById('btn-download');
    var btnCancel = document.getElementById('btn-cancel');
    var themeSwitch = document.getElementById('theme-switch');
    var hamburgerBtn = document.getElementById('hamburger-btn');
    var sidebarOverlay = document.getElementById('sidebar-overlay');
    var btnLoadInfo = document.getElementById('btn-load-info');

    // Page navigation anchors
    var navHome = document.getElementById('nav-home');
    var navDownloads = document.getElementById('nav-downloads');
    var navSettings = document.getElementById('nav-settings');
    var btnClearHistory = document.getElementById('btn-clear-history');

    // Checklist toggles
    var btnSelectAll = document.getElementById('btn-select-all');
    var btnDeselectAll = document.getElementById('btn-deselect-all');

    if (btnBrowse) btnBrowse.addEventListener('click', browseDirectory);
    if (advancedToggle) advancedToggle.addEventListener('click', toggleAdvanced);
    if (btnDownload) btnDownload.addEventListener('click', startDownload);
    if (btnCancel) btnCancel.addEventListener('click', cancelDownload);
    if (themeSwitch) {
        themeSwitch.addEventListener('click', toggleTheme);
        themeSwitch.addEventListener('keydown', function(e) {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggleTheme();
            }
        });
    }
    if (btnLoadInfo) btnLoadInfo.addEventListener('click', loadMetadata);
    if (btnClearHistory) btnClearHistory.addEventListener('click', clearDownloadHistory);

    // Sidebar selectors
    if (hamburgerBtn) hamburgerBtn.addEventListener('click', toggleSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);
    if (navHome) navHome.addEventListener('click', () => navigateTo('page-home'));
    if (navDownloads) navDownloads.addEventListener('click', () => navigateTo('page-downloads'));
    if (navSettings) navSettings.addEventListener('click', () => navigateTo('page-settings'));

    // Checklist buttons selection triggers
    if (btnSelectAll) btnSelectAll.addEventListener('click', () => toggleSelectAll(true));
    if (btnDeselectAll) btnDeselectAll.addEventListener('click', () => toggleSelectAll(false));

    // Media Type UI Toggles
    var mediaTypeSelect = document.getElementById('media-type-select');
    /**
     * Updates advanced settings panel options display state based on chosen media type.
     * Toggles visibility between audio and video options lists.
     */
    function updateMediaToggles() {
        if (mediaTypeSelect) {
            if (mediaTypeSelect.value === 'audio') {
                document.getElementById('audio-options').style.display = 'contents';
                document.getElementById('video-options').style.display = 'none';
            } else {
                document.getElementById('audio-options').style.display = 'none';
                document.getElementById('video-options').style.display = 'contents';
            }
        }
    }
    if (mediaTypeSelect) {
        mediaTypeSelect.addEventListener('change', updateMediaToggles);
        updateMediaToggles();
    }

    // Format select change trigger
    var formatSelect = document.getElementById('format-select');
    if (formatSelect) {
        formatSelect.addEventListener('change', handleFormatChange);
        handleFormatChange();
    }

    // Input changes triggers auto metadata loads
    var urlInput = document.getElementById('url-input');
    if (urlInput) {
        /**
         * Listens to manual URL keyboard typing or edit events to schedule a debounced metadata reload.
         */
        urlInput.addEventListener('input', function() {
            if (urlInput._ignoreNextInput) {
                urlInput._ignoreNextInput = false;
                return;
            }
            clearTimeout(autoLoadDebounceTimer);
            autoLoadDebounceTimer = setTimeout(loadMetadata, 500);
        });
        /**
         * Listens to paste events to trigger a quick metadata fetch and bypass double-loading from input.
         */
        urlInput.addEventListener('paste', function() {
            clearTimeout(autoLoadDebounceTimer);
            autoLoadDebounceTimer = setTimeout(loadMetadata, 50);
            urlInput._ignoreNextInput = true;
        });
    }

    // Load initial theme preference
    var savedTheme = 'dark';
    try {
        savedTheme = localStorage.getItem('app-theme') || 'dark';
    } catch (e) {}
    changeTheme(savedTheme);

    // Hook up Settings Default Folder browse trigger
    var btnSettingsBrowse = document.getElementById('btn-settings-browse');
    if (btnSettingsBrowse) btnSettingsBrowse.addEventListener('click', browseDefaultDirectory);

    // Load initial default directory mode preference
    var dirModeSelect = document.getElementById('settings-dir-mode');
    if (dirModeSelect) {
        var savedMode = 'standard';
        try {
            savedMode = localStorage.getItem('dir-mode') || 'standard';
        } catch (e) {}
        dirModeSelect.value = savedMode;

        var customRow = document.getElementById('settings-custom-dir-row');
        if (customRow) {
            if (savedMode === 'custom') {
                customRow.classList.remove('hidden');
            } else {
                customRow.classList.add('hidden');
            }
        }

        dirModeSelect.addEventListener('change', handleDirModeChange);
    }

    // Load initial concurrency (multidownload) preference
    var concurrencySelect = document.getElementById('settings-concurrency');
    if (concurrencySelect) {
        // Calculate max allowed concurrency based on system threads (half of threads, capped to 8)
        var threads = navigator.hardwareConcurrency || 4;
        var maxConcurrency = Math.max(1, Math.min(8, Math.floor(threads / 2)));

        // Populate select element options dynamically
        concurrencySelect.innerHTML = '';
        for (var i = 1; i <= maxConcurrency; i++) {
            var opt = document.createElement('option');
            opt.value = i.toString();
            opt.textContent = i.toString();
            concurrencySelect.appendChild(opt);
        }

        var savedConcurrency = '1';
        try {
            savedConcurrency = localStorage.getItem('app-concurrency') || '1';
            // Cap saved preference to max concurrency
            if (parseInt(savedConcurrency) > maxConcurrency) {
                savedConcurrency = maxConcurrency.toString();
                localStorage.setItem('app-concurrency', savedConcurrency);
            }
        } catch (e) {}
        concurrencySelect.value = savedConcurrency;

        /** Saves the selected concurrency level to localStorage when changed. */
        concurrencySelect.addEventListener('change', function() {
            try {
                localStorage.setItem('app-concurrency', concurrencySelect.value);
                addLog(getTranslation('log_concurrency_saved', 'Simultaneous downloads set to: ') + concurrencySelect.value);
            } catch (e) {}
        });
    }

    // Load initial language preference
    var savedLang = 'en';
    try {
        savedLang = localStorage.getItem('app-lang') || 'en';
    } catch (e) {}
    await loadLanguage(savedLang);

    var langSelect = document.getElementById('settings-lang-select');
    if (langSelect) {
        langSelect.value = savedLang;

        langSelect.addEventListener('change', async function() {
            try {
                localStorage.setItem('app-lang', langSelect.value);
                await loadLanguage(langSelect.value);
                addLog(getTranslation('log_lang_saved', 'Language preference saved: ') + langSelect.value.toUpperCase());
            } catch (e) {}
        });
    }

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
        window.electronAPI.onTrackProgress((data) => updateTrackProgress(data.id, data.title, data.percent));
        window.electronAPI.onStatus((data) => setStatus(data.status, data.track));
        window.electronAPI.onComplete((data) => onComplete(data.success, data.errorMsg));

        // Resolve output directory configuration
        await initOutputDirectory();
    } else {
        // Browser Mode fallback overrides
        var titlebar = document.getElementById('app-titlebar');
        if (titlebar) titlebar.style.display = 'none';
        document.documentElement.classList.add('browser-mode');

        // Resolve output directory configuration
        await initOutputDirectory();
    }

    // Register change event listener for the home page directory selection input
    var dirInput = document.getElementById('dir-input');
    if (dirInput) {
        dirInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files.length > 0) {
                var folderPath = e.target.files[0].path;
                if (folderPath) {
                    setOutputDir(folderPath);
                    try {
                        localStorage.setItem('last-dir', folderPath);
                    } catch (err) {}
                    addLog(getTranslation('log_output_folder_set', 'Output folder set to: ') + folderPath);
                }
            }
        });
    }

    // Register change event listener for the settings page directory selection input
    var settingsDirInput = document.getElementById('settings-dir-input');
    if (settingsDirInput) {
        settingsDirInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files.length > 0) {
                var folderPath = e.target.files[0].path;
                if (folderPath) {
                    try {
                        localStorage.setItem('custom-dir', folderPath);
                        localStorage.setItem('last-dir', folderPath);
                    } catch (err) {}
                    setOutputDir(folderPath);
                    var settingsDirEl = document.getElementById('settings-dir-path');
                    if (settingsDirEl) {
                        settingsDirEl.textContent = folderPath;
                    }
                    addLog(getTranslation('log_custom_folder_set', 'Custom default folder set to: ') + folderPath);
                }
            }
        });
    }

    // Initialize custom styled dropdowns
    initializeCustomSelects();
});

/**
 * Automatically wraps and replaces all native HTML select dropdowns with custom styled select elements.
 * Synchronizes options list state, selection changes, and disabled attributes automatically.
 */
function initializeCustomSelects() {
    var selectElements = document.querySelectorAll('select');
    
    selectElements.forEach(function(select) {
        if (select.nextElementSibling && select.nextElementSibling.classList.contains('custom-select')) {
            return;
        }

        select.style.display = 'none';

        var customSelect = document.createElement('div');
        customSelect.className = 'custom-select';
        if (select.id) {
            customSelect.classList.add(select.id + '-custom');
        }
        
        var trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        
        var triggerText = document.createElement('span');
        triggerText.className = 'custom-select-trigger-text';
        
        var arrow = document.createElement('span');
        arrow.className = 'custom-select-arrow';
        arrow.textContent = '▼';
        
        trigger.appendChild(triggerText);
        trigger.appendChild(arrow);
        customSelect.appendChild(trigger);

        var optionsContainer = document.createElement('div');
        optionsContainer.className = 'custom-select-options';
        customSelect.appendChild(optionsContainer);

        /**
         * Rebuilds the custom dropdown option list items from the native select options.
         * Attaches selection listeners and sets the initial active selection value.
         */
        function rebuildOptions() {
            optionsContainer.innerHTML = '';
            var options = select.querySelectorAll('option');
            options.forEach(function(opt) {
                var optDiv = document.createElement('div');
                optDiv.className = 'custom-select-option';
                optDiv.textContent = opt.textContent;
                optDiv.setAttribute('data-value', opt.value);
                
                if (opt.value === select.value) {
                    optDiv.classList.add('selected');
                    triggerText.textContent = opt.textContent;
                }

                optDiv.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (select.disabled) return;
                    
                    select.value = opt.value;
                    var event = new Event('change', { bubbles: true });
                    select.dispatchEvent(event);
                    
                    optionsContainer.classList.remove('open');
                    trigger.classList.remove('focus');
                });

                optionsContainer.appendChild(optDiv);
            });
        }

        /**
         * Updates the selected state and trigger text on selection change.
         * Adds or removes styling highlights on options based on the active selection.
         */
        function updateSelectedState() {
            var selectedOpt = select.querySelector('option[value="' + select.value + '"]') || select.options[select.selectedIndex];
            if (selectedOpt) {
                triggerText.textContent = selectedOpt.textContent;
            }
            optionsContainer.querySelectorAll('.custom-select-option').forEach(function(optDiv) {
                if (optDiv.getAttribute('data-value') === select.value) {
                    optDiv.classList.add('selected');
                } else {
                    optDiv.classList.remove('selected');
                }
            });
        }

        /**
         * Toggles styling and cursor values on the custom trigger based on the native disabled state.
         * Ensures a non-interactive opacity look when the native element is disabled.
         */
        function updateDisabledState() {
            if (select.disabled) {
                trigger.classList.add('disabled');
                trigger.style.opacity = '0.5';
                trigger.style.cursor = 'not-allowed';
            } else {
                trigger.classList.remove('disabled');
                trigger.style.opacity = '1';
                trigger.style.cursor = 'pointer';
            }
        }

        rebuildOptions();
        updateDisabledState();

        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            if (select.disabled) return;

            document.querySelectorAll('.custom-select-options').forEach(function(container) {
                if (container !== optionsContainer) {
                    container.classList.remove('open');
                }
            });
            document.querySelectorAll('.custom-select-trigger').forEach(function(trig) {
                if (trig !== trigger) {
                    trig.classList.remove('focus');
                }
            });

            var isOpen = optionsContainer.classList.toggle('open');
            if (isOpen) {
                trigger.classList.add('focus');
            } else {
                trigger.classList.remove('focus');
            }
        });

        select.addEventListener('change', function() {
            updateSelectedState();
        });

        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') {
                    updateDisabledState();
                } else if (mutation.type === 'childList') {
                    rebuildOptions();
                }
            });
        });
        observer.observe(select, { attributes: true, attributeFilter: ['disabled'], childList: true });

        select.parentNode.insertBefore(customSelect, select.nextSibling);
    });

    if (!window.hasCustomSelectGlobalListener) {
        document.addEventListener('click', function() {
            document.querySelectorAll('.custom-select-options').forEach(function(container) {
                container.classList.remove('open');
            });
            document.querySelectorAll('.custom-select-trigger').forEach(function(trig) {
                trig.classList.remove('focus');
            });
        });
        window.hasCustomSelectGlobalListener = true;
    }
}

/**
 * Synchronizes the visual text of all custom selects with their translated native counterparts.
 * This is called after applying translations to update dropdown option labels dynamically.
 */
function syncCustomSelects() {
    var selectElements = document.querySelectorAll('select');
    selectElements.forEach(function(select) {
        var customSelect = select.nextElementSibling;
        if (customSelect && customSelect.classList.contains('custom-select')) {
            var triggerText = customSelect.querySelector('.custom-select-trigger-text');
            var selectedOpt = select.querySelector('option[value="' + select.value + '"]') || select.options[select.selectedIndex];
            if (selectedOpt && triggerText) {
                triggerText.textContent = selectedOpt.textContent;
            }
            
            var optionsContainer = customSelect.querySelector('.custom-select-options');
            if (optionsContainer) {
                var optDivs = optionsContainer.querySelectorAll('.custom-select-option');
                var options = select.querySelectorAll('option');
                optDivs.forEach(function(optDiv, index) {
                    if (options[index]) {
                        optDiv.textContent = options[index].textContent;
                    }
                });
            }
        }
    });
}
