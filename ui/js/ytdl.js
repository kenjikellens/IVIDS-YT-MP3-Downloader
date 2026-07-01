/**
 * ui/js/ytdl.js — Standalone YouTube Downloader Controller
 * 
 * Manages loading metadata, rendering the playlist track checklists, starting
 * and cancelling concurrent yt-dlp downloads, and real-time status logging.
 */

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

function initYtdlPage() {
    // 1. Hook up Browse save directory chooser trigger
    var btnBrowse = document.getElementById('btn-browse');
    if (btnBrowse) {
        btnBrowse.addEventListener('click', browseDirectory);
    }

    // 2. Hook up input files change listener for directory resolve in Electron mode
    var dirInput = document.getElementById('dir-input');
    if (dirInput) {
        dirInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files.length > 0) {
                var folderPath = e.target.files[0].path;
                if (folderPath) {
                    try {
                        localStorage.setItem('last-dir', folderPath);
                    } catch (err) {}
                    setOutputDir(folderPath);
                    if (typeof addLog === 'function') {
                        addLog(getTranslation('log_output_folder_set', 'Output folder set to: ') + folderPath);
                    }
                }
            }
        });
    }

    // 3. Register paste and debounced input events for YouTube URL input
    var urlInput = document.getElementById('url-input');
    if (urlInput) {
        urlInput.addEventListener('input', function() {
            if (urlInput._ignoreNextInput) {
                urlInput._ignoreNextInput = false;
                return;
            }
            clearTimeout(autoLoadDebounceTimer);
            autoLoadDebounceTimer = setTimeout(loadMetadata, 500);
        });
        urlInput.addEventListener('paste', function() {
            clearTimeout(autoLoadDebounceTimer);
            autoLoadDebounceTimer = setTimeout(loadMetadata, 50);
            urlInput._ignoreNextInput = true;
        });
    }

    // 4. Hook up Advanced Settings Panel accordion disclosure trigger
    var advToggle = document.getElementById('advanced-toggle');
    if (advToggle) {
        advToggle.addEventListener('click', toggleAdvanced);
    }

    // 5. Media type change listener (updates quality options or video settings display)
    var mediaTypeSelect = document.getElementById('media-type-select');
    if (mediaTypeSelect) {
        mediaTypeSelect.addEventListener('change', updateMediaToggles);
    }

    // 6. Action buttons (Download & Cancel)
    var btnDownload = document.getElementById('btn-download');
    if (btnDownload) {
        btnDownload.addEventListener('click', function() {
            if (btnDownload.classList.contains('btn-cancel')) {
                cancelDownload();
            } else {
                startDownload();
            }
        });
    }

    var btnCancel = document.getElementById('btn-cancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', cancelDownload);
    }

    var btnLoadInfo = document.getElementById('btn-load-info');
    if (btnLoadInfo) {
        btnLoadInfo.addEventListener('click', loadMetadata);
    }

    // 7. Playlist toolbar select all / deselect all triggers
    var btnSelectAll = document.getElementById('btn-select-all');
    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', function() {
            document.querySelectorAll('#track-list .track-cb').forEach(function(cb) {
                cb.checked = true;
            });
        });
    }

    var btnDeselectAll = document.getElementById('btn-deselect-all');
    if (btnDeselectAll) {
        btnDeselectAll.addEventListener('click', function() {
            document.querySelectorAll('#track-list .track-cb').forEach(function(cb) {
                cb.checked = false;
            });
        });
    }

    // Run initial preference lookups
    var savedDir = null;
    try {
        savedDir = localStorage.getItem('last-dir') || localStorage.getItem('custom-dir');
    } catch(e) {}
    if (savedDir) {
        setOutputDir(savedDir);
    } else {
        initOutputDirectory();
    }
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

    if (typeof addLog === 'function') {
        addLog(getTranslation('log_fetching_metadata', 'Fetching metadata details for URL...'));
    }

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
        if (typeof addLog === 'function') {
            addLog('[Error] ' + getTranslation('log_failed_metadata', 'Failed loading metadata: ') + err.message);
        }
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
 * 
 * @param {Array<Object>} tracks - The metadata list of tracks
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

        var listContainer = document.getElementById('track-list');
        listContainer.innerHTML = '';

        tracks.forEach(function(track, index) {
            var row = document.createElement('div');
            row.className = 'track-item';
            
            var thumbUrl = 'https://img.youtube.com/vi/' + track.id + '/mqdefault.jpg';
            var num = index + 1;
            var durationText = track.duration ? formatDuration(track.duration) : '';

            row.innerHTML = 
                '<div class="track-left">' +
                    '<input type="checkbox" class="track-cb" id="cb-' + track.id + '" data-id="' + track.id + '" checked>' +
                    '<label class="track-cb-label" for="cb-' + track.id + '"></label>' +
                    '<span class="track-num">' + num + '</span>' +
                    '<div class="track-thumb">' +
                        '<img src="' + thumbUrl + '" alt="Thumbnail" onerror="this.src=\'\'">' +
                    '</div>' +
                    '<div class="track-details">' +
                        '<span class="track-title">' + track.title + '</span>' +
                        '<span class="track-artist">' + track.channel + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="track-right">' +
                    '<span class="track-duration">' + durationText + '</span>' +
                '</div>';

            listContainer.appendChild(row);
        });
    }
}

/**
 * Toggles the advanced layout formats list visibility on media selection changes.
 */
function updateMediaToggles() {
    var mediaTypeSelect = document.getElementById('media-type-select');
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

/**
 * Assembles selected download configuration preferences and fires the backend downloader script.
 * Registers fallback EventSource SSE listeners for console logs and track progress loops.
 */
async function startDownload() {
    var urlInput = document.getElementById('url-input');
    var url = urlInput ? urlInput.value.trim() : '';
    if (!url) return;

    var dirEl = document.getElementById('dir-path');
    var outputDir = dirEl ? dirEl.textContent.trim() : '';
    if (!outputDir || outputDir === 'Loading...') return;

    var mediaTypeSelect = document.getElementById('media-type-select');
    var mediaType = mediaTypeSelect ? mediaTypeSelect.value : 'audio';

    var subfolderSelect = document.getElementById('subfolder-select');
    var subfolder = subfolderSelect ? subfolderSelect.value : 'none';

    var formatSelect = document.getElementById(mediaType === 'audio' ? 'format-select' : 'video-format');
    var qualitySelect = document.getElementById(mediaType === 'audio' ? 'quality-select' : 'video-quality');
    var format = formatSelect ? formatSelect.value : (mediaType === 'audio' ? 'mp3' : 'mp4');
    var quality = qualitySelect ? qualitySelect.value : (mediaType === 'audio' ? '192k' : 'best');

    // Filter playlist checkmarks
    var selectedIds = [];
    var checkBoxes = document.querySelectorAll('.track-cb');
    if (checkBoxes.length > 0) {
        checkBoxes.forEach(function(cb) {
            if (cb.checked) {
                selectedIds.push(cb.getAttribute('data-id'));
            }
        });
        if (selectedIds.length === 0) {
            alert('Select at least one track to download.');
            return;
        }
    }

    var btnDownload = document.getElementById('btn-download');
    if (btnDownload) {
        btnDownload.classList.remove('btn-download');
        btnDownload.classList.add('btn-cancel');
        btnDownload.setAttribute('data-i18n', 'home_cancel');
        btnDownload.textContent = getTranslation('home_cancel', 'Cancel');
    }

    var consoleContainer = document.getElementById('console');
    if (consoleContainer) consoleContainer.innerHTML = '';

    totalQueueTracks = selectedIds.length > 0 ? selectedIds.length : (loadedTracks.length > 0 ? loadedTracks.length : 1);
    completedQueueTracks = 0;
    currentOverallProgressPercent = 0;
    activeTrackProgressMap = {};
    currentStatusString = 'Downloading';

    setProgress(0);
    var activeProgressContainer = document.getElementById('active-progress-container');
    if (activeProgressContainer) activeProgressContainer.innerHTML = '';
    if (typeof addLog === 'function') {
        addLog(getTranslation('log_init_job', 'Initializing download job...'));
    }

    var concurrencySelect = document.getElementById('settings-concurrency');
    var concurrency = concurrencySelect ? parseInt(concurrencySelect.value) || 1 : 1;

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
        concurrency: concurrency
    };

    var isElectron = !!window.electronAPI;
    if (isElectron) {
        window.electronAPI.startDownload(options);
    } else {
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
                if (typeof addLog === 'function') addLog(msg);
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
 * Signals backend download subprocess processes or aborts active EventSource connection streams.
 */
async function cancelDownload() {
    if (typeof addLog === 'function') {
        addLog(getTranslation('log_cancel_request', 'Sending cancel request...'));
    }
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
    currentOverallProgressPercent = Math.min(100, Math.max(0, Math.round(percent || 0)));
    setStatus(currentStatusString);
}

/**
 * Updates or creates an individual track's progress bar inside the checklist view panel.
 */
function updateTrackProgress(id, title, percent) {
    var container = document.getElementById('active-progress-container');
    if (!container) return;

    var isFailed = percent === -1;
    var pct = isFailed ? 100 : Math.min(100, Math.max(0, Math.round(percent || 0)));
    var blockId = 'pb-' + id;
    var block = document.getElementById(blockId);

    var oldPct = activeTrackProgressMap[id] || 0;
    activeTrackProgressMap[id] = pct;
    if (oldPct < 100 && (pct === 100 || isFailed)) {
        completedQueueTracks = Math.min(totalQueueTracks, completedQueueTracks + 1);
        setStatus(currentStatusString);
    }

    if (!block) {
        var trackData = loadedTracks ? loadedTracks.find(t => t.id === id) : null;
        var channel = trackData && trackData.channel ? trackData.channel : 'Unknown Channel';
        var durationText = trackData && trackData.duration ? formatDuration(trackData.duration) : '0:00';
        
        var mediaTypeSelect = document.getElementById('media-type-select');
        var mediaType = mediaTypeSelect ? mediaTypeSelect.value : 'audio';
        
        var formatSelect = document.getElementById(mediaType === 'audio' ? 'format-select' : 'video-format');
        var qualitySelect = document.getElementById(mediaType === 'audio' ? 'quality-select' : 'video-quality');
        var format = formatSelect ? formatSelect.value : (mediaType === 'audio' ? 'mp3' : 'mp4');
        var quality = qualitySelect ? qualitySelect.value : (mediaType === 'audio' ? '192k' : 'best');
        
        var qualityStr = quality;
        if (mediaType === 'audio' && !quality.endsWith('k') && !quality.endsWith('bps') && quality !== 'best') {
            qualityStr += 'kbps';
        } else if (mediaType === 'video' && quality !== 'best' && !quality.endsWith('p')) {
            qualityStr += 'p';
        }
        
        var metaString = durationText + ' (' + qualityStr + ') ' + format;
        if (quality === 'best') metaString = durationText + ' (best) ' + format;

        block = document.createElement('div');
        block.className = 'track-progress-block';
        block.id = blockId;
        block.innerHTML = 
            '<div class="track-progress-info">' +
                '<span class="track-progress-title">' + title + '</span>' +
                '<span class="track-progress-artist">' + channel + '</span>' +
            '</div>' +
            '<div class="track-progress-right">' +
                '<span class="track-progress-meta">' + metaString + '</span>' +
                '<div class="track-progress-circle-wrapper">' +
                    '<svg class="track-progress-circle" viewBox="0 0 36 36">' +
                        '<path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />' +
                        '<path class="circle-fill" id="fill-circle-' + id + '" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />' +
                        '<path class="checkmark-path" d="M12 18 l4 4 l8 -8" />' +
                        '<path class="cross-path" d="M12 12 l12 12 M24 12 l-12 12" />' +
                    '</svg>' +
                '</div>' +
            '</div>';
        container.appendChild(block);
    }

    var circle = document.getElementById('fill-circle-' + id);
    if (circle) {
        circle.setAttribute('stroke-dasharray', pct + ', 100');
    }

    if (isFailed) {
        block.classList.remove('complete');
        block.classList.add('failed');
    } else if (pct === 100) {
        block.classList.remove('failed');
        block.classList.add('complete');
    } else {
        block.classList.remove('complete', 'failed');
    }
}

/**
 * Updates the overall status container state, status header text, active track labels,
 * and handles adding CSS state classes to the status card for visual theme changes.
 */
function setStatus(status, track) {
    var statusText = document.getElementById('status-text');
    var trackText = document.getElementById('track-text');
    
    if (status) {
        currentStatusString = status;
    }
    
    var translatedStatus = currentStatusString;
    if (currentStatusString === 'Idle') {
        translatedStatus = getTranslation('status_idle', 'Idle');
    } else if (currentStatusString === 'Querying URL...') {
        translatedStatus = getTranslation('status_querying', 'Querying URL...');
    } else if (currentStatusString === 'Setup...') {
        translatedStatus = getTranslation('status_setup', 'Setup...');
    } else if (currentStatusString === 'Completed') {
        translatedStatus = getTranslation('status_completed', 'Completed');
    } else if (currentStatusString === 'Failed') {
        translatedStatus = getTranslation('status_failed', 'Failed');
    } else if (currentStatusString && (currentStatusString.startsWith('Downloading track ') || currentStatusString.startsWith('Downloading'))) {
        translatedStatus = getTranslation('status_downloading', 'Downloading');
    }
    
    var rightText = '';
    if (track === 'Downloading yt-dlp') {
        rightText = getTranslation('status_downloading_ytdlp', 'Downloading yt-dlp');
    } else if (track === 'Downloading FFmpeg') {
        rightText = getTranslation('status_downloading_ffmpeg', 'Downloading FFmpeg');
    } else if (currentStatusString === 'Completed') {
        rightText = totalQueueTracks + '/' + totalQueueTracks + ' (100%)';
    } else if (currentStatusString === 'Failed') {
        rightText = '';
    } else if (currentStatusString === 'Idle') {
        rightText = '';
    } else if (currentStatusString === 'Querying URL...' || currentStatusString === 'Setup...') {
        rightText = '';
    } else {
        rightText = completedQueueTracks + '/' + totalQueueTracks + ' (' + currentOverallProgressPercent + '%)';
    }
    
    var prefix = getTranslation('status_prefix', 'Status: ');
    if (statusText) statusText.textContent = prefix + translatedStatus;
    if (trackText) trackText.textContent = rightText;

    var overallCard = document.querySelector('.overall-status-card');
    if (overallCard) {
        overallCard.classList.remove('status-idle', 'status-querying', 'status-setup', 'status-downloading', 'status-completed', 'status-failed');
        if (currentStatusString === 'Idle') {
            overallCard.classList.add('status-idle');
        } else if (currentStatusString === 'Querying URL...') {
            overallCard.classList.add('status-querying');
        } else if (currentStatusString === 'Setup...') {
            overallCard.classList.add('status-setup');
        } else if (currentStatusString === 'Completed') {
            overallCard.classList.add('status-completed');
        } else if (currentStatusString === 'Failed') {
            overallCard.classList.add('status-failed');
        } else {
            overallCard.classList.add('status-downloading');
        }
    }
}

/**
 * Re-enables download control buttons and records execution status details in history lists.
 */
function onComplete(success, errorMsg) {
    var btnDownload = document.getElementById('btn-download');
    if (btnDownload) {
        btnDownload.classList.remove('btn-cancel');
        btnDownload.classList.add('btn-download');
        btnDownload.setAttribute('data-i18n', 'home_start');
        btnDownload.textContent = getTranslation('home_start', 'Start Download');
        btnDownload.disabled = false;
    }

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
        if (typeof addLog === 'function') {
            addLog('[Success] ' + getTranslation('log_success_finished', 'All tasks finished successfully!'));
        }
        saveDownloadRecord(targetTitle, metaInfo, true);
    } else {
        setStatus('Failed', '');
        if (errorMsg) {
            if (typeof addLog === 'function') addLog('[Error] ' + errorMsg);
            saveDownloadRecord(targetTitle, metaInfo + ' • ' + errorMsg, false);
        } else {
            if (typeof addLog === 'function') addLog('[Warning] ' + getTranslation('log_warning_cancelled', 'Job was cancelled.'));
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

/**
 * Commits a completed download record into localStorage arrays.
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
 */
function clearDownloadHistory() {
    try {
        localStorage.removeItem('dl-history');
    } catch (e) {}
    renderDownloadHistory();
}
