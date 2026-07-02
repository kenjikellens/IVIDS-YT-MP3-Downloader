/**
 * ui/js/pipeline.js — Pipeline Orchestrator Controller
 * 
 * Orchestrates download and sort pipelines sequentially.
 * Communicates with backend endpoints for downloading, scanning, and categorising.
 */

var pipelineShouldStop = false;
var pipelineActiveControllers = [];
var pipelineLoadedTracks = [];
var pipelineEventSource = null;

/**
 * Initialises all button and input listeners on the Pipeline page.
 */
function initPipelinePage() {
    var btnBrowseDl = document.getElementById('btn-pipeline-browse-download');
    var btnBrowseTarget = document.getElementById('btn-pipeline-browse-target');
    var btnStart = document.getElementById('btn-pipeline-start');
    var btnCancel = document.getElementById('btn-pipeline-cancel');
    var btnLoadInfo = document.getElementById('btn-pipeline-load-info');

    if (btnBrowseDl) btnBrowseDl.addEventListener('click', () => handlePipelineBrowse('download'));
    if (btnBrowseTarget) btnBrowseTarget.addEventListener('click', () => handlePipelineBrowse('target'));
    if (btnStart) btnStart.addEventListener('click', startPipeline);
    if (btnCancel) btnCancel.addEventListener('click', cancelPipeline);
    if (btnLoadInfo) btnLoadInfo.addEventListener('click', loadPipelineMetadata);

    // Register file input change listeners for Electron OS folder dialog support
    var dlInput = document.getElementById('pipeline-download-input');
    if (dlInput) {
        dlInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files.length > 0) {
                var folderPath = e.target.files[0].path;
                if (folderPath) {
                    var el = document.getElementById('pipeline-download-path');
                    if (el) el.textContent = folderPath;
                    localStorage.setItem('pipeline-download-dir', folderPath);
                }
            }
        });
    }

    var targetInput = document.getElementById('pipeline-target-input');
    if (targetInput) {
        targetInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files.length > 0) {
                var folderPath = e.target.files[0].path;
                if (folderPath) {
                    var el = document.getElementById('pipeline-target-path');
                    if (el) el.textContent = folderPath;
                    localStorage.setItem('pipeline-target-dir', folderPath);
                }
            }
        });
    }

    // Register paste and debounced input events for YouTube URL input
    var urlInput = document.getElementById('pipeline-url-input');
    if (urlInput) {
        urlInput.addEventListener('input', function() {
            if (urlInput._ignoreNextInput) {
                urlInput._ignoreNextInput = false;
                return;
            }
            clearTimeout(autoLoadDebounceTimer);
            autoLoadDebounceTimer = setTimeout(loadPipelineMetadata, 500);
        });
        urlInput.addEventListener('paste', function() {
            clearTimeout(autoLoadDebounceTimer);
            autoLoadDebounceTimer = setTimeout(loadPipelineMetadata, 50);
            urlInput._ignoreNextInput = true;
        });
    }

    // Media type change listener (updates quality options display)
    var mediaTypeSelect = document.getElementById('pipeline-media-type-select');
    if (mediaTypeSelect) {
        mediaTypeSelect.addEventListener('change', updatePipelineMediaToggles);
    }

    // Playlist toolbar select all / deselect all triggers
    var btnSelectAll = document.getElementById('btn-pipeline-select-all');
    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', () => togglePipelineSelectAll(true));
    }

    var btnDeselectAll = document.getElementById('btn-pipeline-deselect-all');
    if (btnDeselectAll) {
        btnDeselectAll.addEventListener('click', () => togglePipelineSelectAll(false));
    }

    // Restore saved paths
    try {
        var dlDir = localStorage.getItem('pipeline-download-dir') || '';
        var targetDir = localStorage.getItem('pipeline-target-dir') || '';
        if (dlDir) document.getElementById('pipeline-download-path').textContent = dlDir;
        if (targetDir) document.getElementById('pipeline-target-path').textContent = targetDir;
    } catch(e) {}

    // Synchronize custom dropdown selectors
    syncCustomSelects();
}

/**
 * Handles browse directory click events for Pipeline paths (download / target).
 * 
 * @param {string} type - Path type selection ('download' | 'target')
 */
async function handlePipelineBrowse(type) {
    var isElectron = !!window.electronAPI;
    if (isElectron) {
        var inputId = type === 'download' ? 'pipeline-download-input' : 'pipeline-target-input';
        var input = document.getElementById(inputId);
        if (input) input.click();
    } else {
        try {
            var response = await fetch('/api/select-directory');
            if (!response.ok) throw new Error('Network error selecting folder');
            var data = await response.json();
            var folderPath = data.path;
            if (folderPath) {
                var pathEl = document.getElementById(type === 'download' ? 'pipeline-download-path' : 'pipeline-target-path');
                if (pathEl) {
                    pathEl.textContent = folderPath;
                    pathEl.title = folderPath;
                }
                localStorage.setItem(type === 'download' ? 'pipeline-download-dir' : 'pipeline-target-dir', folderPath);
            }
        } catch (err) {
            addPipelineLog("[Error] Failed to select folder: " + err.message);
        }
    }
}

/**
 * Toggles the advanced layout formats list visibility on Pipeline media selection changes.
 */
function updatePipelineMediaToggles() {
    var mediaTypeSelect = document.getElementById('pipeline-media-type-select');
    if (mediaTypeSelect) {
        if (mediaTypeSelect.value === 'audio') {
            document.getElementById('pipeline-audio-options').style.display = 'contents';
            document.getElementById('pipeline-video-options').style.display = 'none';
        } else {
            document.getElementById('pipeline-audio-options').style.display = 'none';
            document.getElementById('pipeline-video-options').style.display = 'contents';
        }
    }
}

/**
 * Requests flat playlist metadata details for the Pipeline URL input box.
 */
async function loadPipelineMetadata() {
    var urlInput = document.getElementById('pipeline-url-input');
    var url = urlInput ? urlInput.value.trim() : '';
    if (!url) return;

    var btnLoad = document.getElementById('btn-pipeline-load-info');
    if (btnLoad) {
        btnLoad.disabled = true;
        btnLoad.textContent = 'Loading...';
    }

    addPipelineLog("Fetching metadata details for URL...");

    var previewEmpty = document.getElementById('pipeline-state-empty');
    var previewPlaylist = document.getElementById('pipeline-state-playlist');
    if (previewEmpty) {
        previewEmpty.style.display = 'flex';
        previewEmpty.innerHTML = '<div class="spinner"></div><p>Loading tracks metadata...</p>';
    }
    if (previewPlaylist) previewPlaylist.style.display = 'none';

    try {
        var res = await fetch('/api/fetch-metadata?url=' + encodeURIComponent(url));
        if (!res.ok) throw new Error('Network error loading metadata');
        var data = await res.json();
        if (data.error) throw new Error(data.error);
        
        pipelineLoadedTracks = data.tracks || [];
        renderPipelinePreview(pipelineLoadedTracks);
    } catch (err) {
        addPipelineLog("[Error] Failed loading metadata: " + err.message);
        if (previewEmpty) {
            previewEmpty.innerHTML = 
                '<svg class="preview-empty-icon" viewBox="0 0 24 24" width="44" height="44">' +
                    '<path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM9.5 16.5l7-4.5-7-4.5v9z"/>' +
                '</svg>' +
                '<p style="color:var(--accent-red);">[Error] ' + err.message + '</p>';
        }
    } finally {
        if (btnLoad) {
            btnLoad.disabled = false;
            btnLoad.textContent = 'Load Info';
        }
    }
}

/**
 * Renders loaded playlist details checklist in the Pipeline Preview card container.
 * 
 * @param {Array<Object>} tracks - List of tracks containing id, title, duration, channel.
 */
function renderPipelinePreview(tracks) {
    var previewEmpty = document.getElementById('pipeline-state-empty');
    var previewPlaylist = document.getElementById('pipeline-state-playlist');
    
    if (!tracks || tracks.length === 0) {
        if (previewEmpty) {
            previewEmpty.style.display = 'flex';
            previewEmpty.innerHTML = '<p>No tracks or video information found.</p>';
        }
        if (previewPlaylist) previewPlaylist.style.display = 'none';
        return;
    }

    if (previewEmpty) previewEmpty.style.display = 'none';
    if (previewPlaylist) previewPlaylist.style.display = 'block';

    var countText = document.getElementById('pipeline-track-count-text');
    if (countText) countText.textContent = tracks.length + ' tracks found';

    var list = document.getElementById('pipeline-track-list');
    if (list) {
        list.innerHTML = '';
        tracks.forEach(function(t, idx) {
            var label = document.createElement('label');
            label.className = 'track-item';

            var thumbUrl = 'https://img.youtube.com/vi/' + t.id + '/mqdefault.jpg';
            var durationText = t.duration ? formatDuration(t.duration) : 'Unknown';

            label.innerHTML = 
                '<input type="checkbox" class="pipeline-track-cb" checked data-id="' + t.id + '">' +
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
 * Toggles all selection checkboxes in the Pipeline Preview playlist checklist panel.
 * 
 * @param {boolean} checked - True to select all checklist items, false to clear.
 */
function togglePipelineSelectAll(checked) {
    document.querySelectorAll('.pipeline-track-cb').forEach(cb => cb.checked = checked);
}

/**
 * Commits a message line directly to the Pipeline Console Log panel output list.
 * 
 * @param {string} msg - Log message string.
 */
function addPipelineLog(msg) {
    var consoleEl = document.getElementById('pipeline-console');
    if (!consoleEl) return;
    var div = document.createElement('div');
    div.className = 'log-line';
    if (msg.includes('[Success]')) div.className += ' log-success';
    else if (msg.includes('[Error]')) div.className += ' log-error';
    else if (msg.includes('[Warning]')) div.className += ' log-warn';
    div.textContent = msg;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

/**
 * Emits overall status feedback and updates visual color class wrappers for the Pipeline Status Card.
 */
function setPipelineStatus(status, track, percent) {
    var statusText = document.getElementById('pipeline-status-text');
    var trackText = document.getElementById('pipeline-track-text');
    var progressFill = document.getElementById('pipeline-progress-fill');
    var statusCard = document.getElementById('pipeline-status-card');

    if (statusText) statusText.textContent = "Status: " + status;
    if (trackText) trackText.textContent = track;
    if (progressFill) progressFill.style.width = percent + '%';

    if (statusCard) {
        statusCard.classList.remove('status-idle', 'status-querying', 'status-setup', 'status-downloading', 'status-completed', 'status-failed');
        if (status === 'Idle') statusCard.classList.add('status-idle');
        else if (status === 'Completed') statusCard.classList.add('status-completed');
        else if (status === 'Failed') statusCard.classList.add('status-failed');
        else if (status === 'Processing' || status === 'Downloading') statusCard.classList.add('status-downloading');
        else statusCard.classList.add('status-setup');
    }
}

/**
 * Updates or pre-renders track progress indicators inside the Pipeline's visual queue loaders list.
 */
function updatePipelineTrackProgress(id, title, badgeText, state, percent) {
    var container = document.getElementById('pipeline-active-progress');
    if (!container) return;

    var pct = Math.min(100, Math.max(0, Math.round(percent || 0)));
    var blockId = 'pipe-pb-' + id;
    var block = document.getElementById(blockId);

    if (!block) {
        block = document.createElement('div');
        block.className = 'track-progress-block';
        block.id = blockId;
        block.innerHTML = 
            '<div class="track-progress-info">' +
                '<span class="track-progress-title">' + title + '</span>' +
            '</div>' +
            '<div class="track-progress-right">' +
                '<span class="api-badge" id="pipe-badge-' + id + '">' + badgeText + '</span>' +
                '<div class="track-progress-circle-wrapper">' +
                    '<svg class="track-progress-circle" viewBox="0 0 36 36">' +
                        '<circle cx="18" cy="18" r="15.9155" class="circle-bg" />' +
                        '<circle cx="18" cy="18" r="15.9155" class="circle-fill" id="pipe-fill-circle-' + id + '" stroke-dasharray="0, 100" />' +
                        '<path class="checkmark-path" d="M12 18 l4 4 l8 -8" />' +
                        '<path class="cross-path" d="M12 12 l12 12 M24 12 l-12 12" />' +
                        '<path class="exclamation-path" d="M18 11 v8 M18 25 v2" />' +
                    '</svg>' +
                '</div>' +
            '</div>';
        container.prepend(block);
    }

    var badge = document.getElementById('pipe-badge-' + id);
    if (badge) badge.textContent = badgeText;

    var circle = document.getElementById('pipe-fill-circle-' + id);
    if (circle) circle.setAttribute('stroke-dasharray', pct + ', 100');

    block.classList.remove('complete', 'failed', 'unknown');
    if (state === 'complete') block.classList.add('complete');
    else if (state === 'failed') block.classList.add('failed');
    else if (state === 'unknown') block.classList.add('unknown');
}

/**
 * Signals backend download tasks or active AI processes to abort all Pipeline actions.
 */
async function cancelPipeline() {
    pipelineShouldStop = true;
    addPipelineLog("Cancelling Pipeline...");
    
    var cancelBtn = document.getElementById('btn-pipeline-cancel');
    if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling...';
    }

    if (pipelineEventSource) {
        pipelineEventSource.close();
        pipelineEventSource = null;
    }

    try {
        await fetch('/api/cancel');
    } catch(e) {}

    pipelineActiveControllers.forEach(c => {
        try { c.abort(); } catch(err) {}
    });
    pipelineActiveControllers = [];

    finishPipelineControls();
    setPipelineStatus('Failed', 'Geannuleerd', 0);
}

/**
 * Resets visual start and cancel buttons state when a pipeline finishes or fails.
 */
function finishPipelineControls() {
    var startBtn = document.getElementById('btn-pipeline-start');
    var cancelBtn = document.getElementById('btn-pipeline-cancel');
    if (startBtn) startBtn.style.display = 'inline-block';
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
        cancelBtn.disabled = true;
    }
}

/**
 * Orchestrates the full sequential execution of the Downloader (Step 1) and Organiser (Step 2) workflow.
 */
async function startPipeline() {
    var enableDownloader = document.getElementById('pipeline-enable-downloader').checked;
    var enableOrganiser = document.getElementById('pipeline-enable-organiser').checked;

    if (!enableDownloader && !enableOrganiser) {
        alert("Selecteer ten minste één stap van de pipeline (Stap 1 of Stap 2).");
        return;
    }

    var startBtn = document.getElementById('btn-pipeline-start');
    var cancelBtn = document.getElementById('btn-pipeline-cancel');
    var consoleEl = document.getElementById('pipeline-console');
    var activeProgress = document.getElementById('pipeline-active-progress');

    if (startBtn) startBtn.style.display = 'none';
    if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel';
    }
    if (consoleEl) consoleEl.innerHTML = '';
    if (activeProgress) activeProgress.innerHTML = '';

    pipelineShouldStop = false;
    pipelineActiveControllers = [];

    // Reset visual nodes state
    updateVisualPipeline(null, 'reset');

    if (enableOrganiser) {
        connectPipelineOrganiserLogStream();
    }

    try {
        var workingDir = '';

        if (enableDownloader) {
            var urlInput = document.getElementById('pipeline-url-input');
            var url = urlInput ? urlInput.value.trim() : '';
            if (!url) {
                throw new Error("Voer een geldige YouTube URL in voor Stap 1.");
            }

            var downloadDirEl = document.getElementById('pipeline-download-path');
            workingDir = downloadDirEl ? downloadDirEl.textContent.trim() : '';
            if (!workingDir || workingDir === 'Loading...') {
                throw new Error("Selecteer een tijdelijke downloadmap.");
            }

            setPipelineStatus('Setup...', 'Downloader initialiseren', 10);
            addPipelineLog("[Stap 1/2] Downloader gestart...");

            // Set Step 1 completed, Step 2 active
            updateVisualPipeline(1, 'completed');
            updateVisualPipeline(2, 'active');

            var selectedIds = [];
            document.querySelectorAll('.pipeline-track-cb').forEach(cb => {
                if (cb.checked) {
                    var id = cb.getAttribute('data-id');
                    if (id) selectedIds.push(id);
                }
            });

            if (pipelineLoadedTracks.length > 1 && selectedIds.length === 0) {
                throw new Error("Geen video's geselecteerd in de preview.");
            }

            var mediaTypeSelect = document.getElementById('pipeline-media-type-select');
            var mediaType = mediaTypeSelect ? mediaTypeSelect.value : 'audio';

            var formatSelect = document.getElementById(mediaType === 'audio' ? 'pipeline-format-select' : 'pipeline-video-format');
            var qualitySelect = document.getElementById(mediaType === 'audio' ? 'pipeline-quality-select' : 'pipeline-video-quality');
            var format = formatSelect ? formatSelect.value : (mediaType === 'audio' ? 'mp3' : 'mp4');
            var quality = qualitySelect ? qualitySelect.value : (mediaType === 'audio' ? '192k' : 'best');

            var concurrencySelect = document.getElementById('settings-concurrency');
            var concurrency = concurrencySelect ? parseInt(concurrencySelect.value) || 1 : 1;

            var queryParams = new URLSearchParams({
                url: url,
                outputDir: workingDir,
                mediaType: mediaType,
                subfolder: 'none',
                format: format,
                quality: quality,
                startIdx: 1,
                endIdx: -1,
                concurrency: concurrency
            });
            if (selectedIds.length > 0) {
                queryParams.append('selectedIds', selectedIds.join(','));
            }

            setPipelineStatus('Downloading', 'Downloaden...', 20);

            var downloadSuccess = await new Promise((resolve) => {
                var sse = new EventSource('/api/download?' + queryParams.toString());
                pipelineEventSource = sse;

                sse.addEventListener('log', function(e) {
                    try {
                        var msg = JSON.parse(e.data);
                        addPipelineLog(msg);
                    } catch(err) {}
                });

                sse.addEventListener('progress', function(e) {
                    try {
                        var percent = JSON.parse(e.data);
                        var scaledPct = Math.round(20 + (percent * 0.3));
                        setPipelineStatus('Downloading', `Downloaden... (${percent}%)`, scaledPct);
                    } catch(err) {}
                });

                sse.addEventListener('track-progress', function(e) {
                    try {
                        var data = JSON.parse(e.data);
                        var scaledTrackPct = data.percent === -1 ? -1 : Math.round(data.percent);
                        updatePipelineTrackProgress(data.id, data.title, 'Downloading', scaledTrackPct === 100 ? 'complete' : 'active', scaledTrackPct);
                    } catch(err) {}
                });

                sse.addEventListener('complete', function(e) {
                    try {
                        var data = JSON.parse(e.data);
                        sse.close();
                        pipelineEventSource = null;
                        resolve(data.success);
                    } catch(err) {
                        sse.close();
                        pipelineEventSource = null;
                        resolve(false);
                    }
                });

                sse.addEventListener('error', function() {
                    sse.close();
                    pipelineEventSource = null;
                    resolve(false);
                });
            });

            if (pipelineShouldStop) return;
            if (!downloadSuccess) {
                throw new Error("Downloaden van een of meerdere playlist-items is mislukt.");
            }
            
            addPipelineLog("[Success] Stap 1 voltooid.");
        } else {
            var downloadDirEl = document.getElementById('pipeline-download-path');
            workingDir = downloadDirEl ? downloadDirEl.textContent.trim() : '';
            if (!workingDir || workingDir === 'Loading...') {
                throw new Error("Selecteer een geldige bronmap.");
            }
            addPipelineLog("[Stap 1/2] Sla downloaden over...");
        }

        if (enableOrganiser) {
            var targetDirEl = document.getElementById('pipeline-target-path');
            var targetPath = targetDirEl ? targetDirEl.textContent.trim() : '';
            if (!targetPath || targetPath === 'Select target folder...') {
                throw new Error("Selecteer een geldige uiteindelijke doelmap voor Stap 2.");
            }

            var organizeModeSelect = document.getElementById('pipeline-mode-select');
            var organizeMode = organizeModeSelect ? organizeModeSelect.value : 'classic_periods';
            var deleteSource = document.getElementById('pipeline-delete-source').checked;
            var useShazam = document.getElementById('pipeline-use-shazam').checked;

            setPipelineStatus('Setup...', 'Bestanden scannen...', 55);
            addPipelineLog("[Stap 2/2] Organiseren gestart...");

            // Set Step 2 completed, Step 3 active
            updateVisualPipeline(2, 'completed');
            updateVisualPipeline(3, 'active');

            var scanRes = await fetch('/api/scan', {
                method: 'POST',
                body: JSON.stringify({ source_dir: workingDir }),
                headers: { 'Content-Type': 'application/json' }
            });
            if (!scanRes.ok) throw new Error("Fout bij het scannen van de downloadmap.");
            var scanData = await scanRes.json();
            if (scanData.error) throw new Error(scanData.error);

            var files = scanData.files || [];
            addPipelineLog(`Gevonden bestanden in downloadmap: ${files.length}`);

            if (files.length === 0) {
                addPipelineLog("[Success] Geen nieuwe bestanden te organiseren.");
            } else {
                setPipelineStatus('Processing', `Verwerken... 0/${files.length}`, 60);

                var processedCount = 0;
                var concurrency = 1;
                var currentIndex = 0;

                const processFileWorker = async () => {
                    while (currentIndex < files.length && !pipelineShouldStop) {
                        var index = currentIndex++;
                        var file = files[index];
                        var controller = new AbortController();
                        pipelineActiveControllers.push(controller);

                        updatePipelineTrackProgress('org-' + index, file.filename, 'Organizing', 'active', 10);

                        try {
                            if (pipelineShouldStop) throw new Error("Cancelled");

                            var qData = null;
                            var lastErr = null;

                            var uploaderName = file.tags ? (file.tags.artist || file.tags.album) : null;
                            
                            if (pipelineLoadedTracks.length > 0) {
                                var matched = pipelineLoadedTracks.find(t => t.title && (file.filename.includes(t.title) || t.title.includes(file.filename.replace(/\.[^/.]+$/, ""))));
                                if (matched && matched.channel) {
                                    uploaderName = matched.channel;
                                }
                            }

                            if (organizeMode === 'channel' && uploaderName) {
                                qData = { channel: uploaderName, unknown: false };
                                updatePipelineTrackProgress('org-' + index, file.filename, 'Channel matched', 'active', 70);
                            } else {
                                const modules = ["gemini", "gemini2", "gemini3"];
                                const startIdx = index % modules.length;
                                const activeModules = [];
                                for (let i = 0; i < modules.length; i++) {
                                    activeModules.push(modules[(startIdx + i) % modules.length]);
                                }

                                for (let i = 0; i < activeModules.length; i++) {
                                    const mod = activeModules[i];
                                    if (!mod) continue;

                                    try {
                                        updatePipelineTrackProgress('org-' + index, file.filename, 'AI Querying', 'active', 30 + (i * 15));
                                        
                                        var aiRes = await fetch('/api/gemini', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                module: mod,
                                                filename: file.filename,
                                                folder_name: file.folder_name || 'Onbekend',
                                                tags: file.tags || {}
                                            })
                                        });
                                        if (aiRes.ok) {
                                            var resData = await aiRes.json();
                                            var result = resData.result || resData;
                                            if (result && !result.error && !result.unknown) {
                                                qData = result;
                                                break;
                                            } else {
                                                lastErr = result ? (result.error || "unknown") : "empty";
                                            }
                                        }
                                    } catch (aiErr) {
                                        lastErr = aiErr.message;
                                    }
                                }
                            }

                            if (!qData && useShazam) {
                                updatePipelineTrackProgress('org-' + index, file.filename, 'Shazam API', 'active', 75);
                                try {
                                    var shazamRes = await fetch('/api/gemini', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            module: "shazam",
                                            filepath: file.full_path
                                        })
                                    });
                                    if (shazamRes.ok) {
                                        var sData = await shazamRes.json();
                                        if (sData && !sData.error && !sData.unknown) {
                                            qData = sData;
                                        }
                                    }
                                } catch(shazamErr) {}
                            }

                            if (!qData) {
                                qData = { unknown: true, error: lastErr || "AI categorisatie mislukt" };
                            }

                            if (uploaderName && !qData.uploader && !qData.channel) {
                                qData.uploader = uploaderName;
                            }

                            if (pipelineShouldStop) throw new Error("Cancelled");
                            updatePipelineTrackProgress('org-' + index, file.filename, 'Finalizing', 'active', 90);

                            var fRes = await fetch('/api/finalize', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    file_info: file, 
                                    ai_data: qData, 
                                    target_dir: targetPath,
                                    organize_mode: organizeMode,
                                    delete_source: deleteSource
                                }),
                                signal: controller.signal
                            });
                            if (!fRes.ok) throw new Error("Finalize API returned non-200 code");

                            updatePipelineTrackProgress('org-' + index, file.filename, qData.unknown ? 'Unknown' : 'Success', qData.unknown ? 'unknown' : 'complete', 100);
                        } catch (err) {
                            updatePipelineTrackProgress('org-' + index, file.filename, 'Failed', 'failed', 0);
                            addPipelineLog(`[Warning] Fout bij verwerken van ${file.filename}: ${err.message}`);
                        } finally {
                            pipelineActiveControllers = pipelineActiveControllers.filter(c => c !== controller);
                            processedCount++;
                            var scaledPct = Math.round(60 + ((processedCount / files.length) * 40));
                            setPipelineStatus('Processing', `Verwerken... ${processedCount}/${files.length}`, scaledPct);
                        }
                    }
                };

                var workers = [];
                for (let i = 0; i < concurrency; i++) {
                    workers.push(processFileWorker());
                }
                await Promise.all(workers);
            }

            addPipelineLog("[Success] Stap 2 voltooid.");
        }

        if (pipelineShouldStop) return;
        
        // Pipeline completed successfully, set step 3 and 4 completed
        updateVisualPipeline(3, 'completed');
        updateVisualPipeline(4, 'completed');

        setPipelineStatus('Completed', 'Pipeline voltooid!', 100);
        addPipelineLog("[Success] Gehele pipeline met succes afgerond!");
    } catch (err) {
        addPipelineLog("[Error] Pipeline gestopt wegens fout: " + err.message);
        setPipelineStatus('Failed', 'Mislukt', 0);
    } finally {
        finishPipelineControls();
        if (pipelineEventSource) {
            pipelineEventSource.close();
            pipelineEventSource = null;
        }
    }
}

/**
 * Establishes an SSE event stream connection for printing raw organiser log messages in the pipeline console log.
 */
function connectPipelineOrganiserLogStream() {
    if (pipelineEventSource) {
        pipelineEventSource.close();
    }
    pipelineEventSource = new EventSource('/api/log_stream');
    pipelineEventSource.onmessage = function(event) {
        if (event.data) {
            addPipelineLog(event.data);
        }
    };
    pipelineEventSource.onerror = function() {
        if (typeof addPipelineLog === 'function') {
            addPipelineLog("[Waarschuwing] Netwerkverbinding gepauzeerd/verbroken. Bezig met herverbinden...");
        }
        // Do not close; let EventSource automatically reconnect.
    };
}

/**
 * Updates visual status step nodes on the horizontal process timeline in real-time.
 * 
 * @param {number|null} stepNumber - Step index (1-4)
 * @param {string} state - Update state ('active' | 'completed' | 'reset')
 */
function updateVisualPipeline(stepNumber, state) {
    if (state === 'reset') {
        for (var i = 1; i <= 4; i++) {
            var node = document.getElementById('step-node-' + i);
            if (node) {
                node.classList.remove('active', 'completed');
            }
            var timeline = document.getElementById('timeline-step-' + i);
            if (timeline) {
                timeline.classList.remove('active');
            }
        }
        var conn = document.getElementById('visual-connector-bar');
        if (conn) conn.style.width = '0%';
        var t1 = document.getElementById('timeline-step-1');
        if (t1) t1.classList.add('active');
        var n1 = document.getElementById('step-node-1');
        if (n1) n1.classList.add('active');
        return;
    }

    var node = document.getElementById('step-node-' + stepNumber);
    if (node) {
        if (state === 'active') {
            node.classList.add('active');
            node.classList.remove('completed');
        } else if (state === 'completed') {
            node.classList.add('completed');
            node.classList.remove('active');
        }
    }

    var conn = document.getElementById('visual-connector-bar');
    if (conn) {
        if (stepNumber === 1 && state === 'completed') conn.style.width = '33%';
        else if (stepNumber === 2 && state === 'completed') conn.style.width = '66%';
        else if (stepNumber === 3 && state === 'completed') conn.style.width = '100%';
    }

    for (var i = 1; i <= 3; i++) {
        var timeline = document.getElementById('timeline-step-' + i);
        if (timeline) {
            if (i === stepNumber && state === 'active') {
                timeline.classList.add('active');
            } else if (i === stepNumber && state === 'completed') {
                timeline.classList.remove('active');
            }
        }
    }
}
