/**
 * ui/js/organiser.js — Standalone Music Organiser Controller
 * 
 * Scans directories, queries Gemini API, runs Shazam audio fallbacks,
 * and finalises tagging/moving files into sorted period templates.
 */

var organiserShouldStop = false;
var organiserActiveControllers = [];
var organiserEventSource = null;

/**
 * Initialises all button and input listeners on the Music Organiser page.
 */
function initOrganiserPage() {
    var btnBrowseSource = document.getElementById('btn-organiser-browse-source');
    var btnBrowseTarget = document.getElementById('btn-organiser-browse-target');
    var btnStart = document.getElementById('btn-organiser-start');
    var btnCancel = document.getElementById('btn-organiser-cancel');

    if (btnBrowseSource) btnBrowseSource.addEventListener('click', () => handleOrganiserBrowse('source'));
    if (btnBrowseTarget) btnBrowseTarget.addEventListener('click', () => handleOrganiserBrowse('target'));
    if (btnStart) btnStart.addEventListener('click', startOrganiser);
    if (btnCancel) btnCancel.addEventListener('click', stopOrganiser);

    // Register file input change listeners for Electron OS folder dialog support
    var sourceInput = document.getElementById('organiser-source-input');
    if (sourceInput) {
        sourceInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files.length > 0) {
                var folderPath = e.target.files[0].path;
                if (folderPath) {
                    var el = document.getElementById('organiser-source-path');
                    if (el) el.textContent = folderPath;
                    localStorage.setItem('organiser-source', folderPath);
                }
            }
        });
    }

    var targetInput = document.getElementById('organiser-target-input');
    if (targetInput) {
        targetInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files.length > 0) {
                var folderPath = e.target.files[0].path;
                if (folderPath) {
                    var el = document.getElementById('organiser-target-path');
                    if (el) el.textContent = folderPath;
                    localStorage.setItem('organiser-target', folderPath);
                }
            }
        });
    }

    // Restore saved paths
    try {
        var sourceDir = localStorage.getItem('organiser-source') || '';
        var targetDir = localStorage.getItem('organiser-target') || '';
        if (sourceDir) document.getElementById('organiser-source-path').textContent = sourceDir;
        if (targetDir) document.getElementById('organiser-target-path').textContent = targetDir;
    } catch(e) {}

    // Synchronize custom dropdown selectors
    syncCustomSelects();
}

/**
 * Triggers directory selection dialogs. Toggles native hidden inputs in Electron
 * or calls fallback REST API directory services.
 * 
 * @param {string} type - Folder select type ('source' | 'target')
 */
async function handleOrganiserBrowse(type) {
    var isElectron = !!window.electronAPI;
    if (isElectron) {
        var inputId = type === 'source' ? 'organiser-source-input' : 'organiser-target-input';
        var input = document.getElementById(inputId);
        if (input) input.click();
    } else {
        try {
            var response = await fetch('/api/select-directory');
            if (!response.ok) throw new Error('Network error selecting folder');
            var data = await response.json();
            var folderPath = data.path;
            if (folderPath) {
                var pathEl = document.getElementById(type === 'source' ? 'organiser-source-path' : 'organiser-target-path');
                if (pathEl) pathEl.textContent = folderPath;
                localStorage.setItem(`organiser-${type}`, folderPath);
            }
        } catch (err) {
            addOrganiserLog("[Error] Failed to select folder: " + err.message);
        }
    }
}

/**
 * Aborts all active file execution threads or API queries.
 */
function stopOrganiser() {
    organiserShouldStop = true;
    var cancelBtn = document.getElementById('btn-organiser-cancel');
    if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.textContent = "Stopping...";
    }
    organiserActiveControllers.forEach(c => {
        try { c.abort(); } catch(e) {}
    });
    organiserActiveControllers = [];
}

/**
 * Commits the sorting task, scanning the source folder and scheduling Gemini queries sequentially.
 */
async function startOrganiser() {
    var sourceEl = document.getElementById('organiser-source-path');
    var targetEl = document.getElementById('organiser-target-path');
    var sourcePath = sourceEl ? sourceEl.textContent : '';
    var targetPath = targetEl ? targetEl.textContent : '';
    
    if (!sourcePath || sourcePath === 'Select folder...' || !targetPath || targetPath === 'Select folder...') {
        alert(getTranslation('organiser_err_paths', 'Please select both source and target folders.'));
        return;
    }

    var startBtn = document.getElementById('btn-organiser-start');
    var cancelBtn = document.getElementById('btn-organiser-cancel');
    var resultsList = document.getElementById('organiser-results');
    var trackCount = document.getElementById('organiser-track-count');

    if (startBtn) startBtn.style.display = 'none';
    if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
        cancelBtn.disabled = false;
        cancelBtn.textContent = getTranslation('home_cancel', 'Stop');
    }
    if (resultsList) resultsList.innerHTML = '';
    
    organiserShouldStop = false;
    organiserActiveControllers = [];
    var consoleEl = document.getElementById('organiser-console');
    if (consoleEl) consoleEl.innerHTML = '';

    // Clear active track loaders container on start
    var activeProgress = document.getElementById('organiser-active-progress');
    if (activeProgress) activeProgress.innerHTML = '';

    // Initialize overall organiser status card states and values
    var organiserCard = document.getElementById('organiser-status-card');
    var organiserStatusText = document.getElementById('organiser-status-text');
    var organiserTrackText = document.getElementById('organiser-track-text');
    var organiserProgressFill = document.getElementById('organiser-progress-fill');

    if (organiserCard) {
        organiserCard.classList.remove('status-idle', 'status-querying', 'status-setup', 'status-downloading', 'status-completed', 'status-failed');
        organiserCard.classList.add('status-setup');
    }
    if (organiserStatusText) {
        organiserStatusText.textContent = getTranslation('status_setup', 'Setup...');
    }
    if (organiserTrackText) {
        organiserTrackText.textContent = '';
    }
    if (organiserProgressFill) {
        organiserProgressFill.style.width = '0%';
    }

    connectOrganiserLogStream();

    try {
        addOrganiserLog("Scanning source directory...");
        var scanRes = await fetch('/api/scan', {
            method: 'POST',
            body: JSON.stringify({ source_dir: sourcePath }),
            headers: { 'Content-Type': 'application/json' }
        });
        if (!scanRes.ok) throw new Error("Failed to scan directory.");
        var scanData = await scanRes.json();
        if (scanData.error) throw new Error(scanData.error);

        var files = scanData.files || [];
        if (organiserTrackText) organiserTrackText.textContent = `0 / ${files.length}`;
        if (trackCount) trackCount.textContent = `0 / ${files.length} items processed`;
        
        if (files.length === 0) {
            if (resultsList) resultsList.innerHTML = "<div class='organiser-result-item'>No new files found.</div>";
            finishOrganiser();
            if (organiserCard) {
                organiserCard.classList.remove('status-setup');
                organiserCard.classList.add('status-idle');
            }
            if (organiserStatusText) organiserStatusText.textContent = getTranslation('status_idle', 'Idle');
            return;
        }

        // Set card status to active processing state
        if (organiserCard) {
            organiserCard.classList.remove('status-setup');
            organiserCard.classList.add('status-downloading');
        }
        if (organiserStatusText) {
            organiserStatusText.textContent = "Processing...";
        }

        var processedCount = 0;

        const processFile = async (file, index, signal) => {
            var item = document.createElement('div');
            item.className = 'organiser-result-item';
            item.innerHTML = `
                <div class="organiser-item-name">[${index+1}/${files.length}] ${file.filename}</div>
                <div class="organiser-item-detail" id="org-status-${index}">Waiting...</div>
            `;
            if (resultsList) resultsList.prepend(item);
            var statusEl = item.querySelector(`#org-status-${index}`);

            // Initialize track progress loader
            updateOrganiserProgress(index, file.filename, 'Preparing', 'active', 10);

            try {
                if (organiserShouldStop) throw new Error("Cancelled");

                if (statusEl) statusEl.textContent = "AI Query...";

                const modules = [
                    "gemini",
                    "gemini2",
                    "gemini3"
                ];

                const startIdx = index % modules.length;
                const activeModules = [];
                for (let i = 0; i < modules.length; i++) {
                    activeModules.push(modules[(startIdx + i) % modules.length]);
                }

                let qData = null;
                let lastErr = null;

                for (let i = 0; i < activeModules.length; i++) {
                    const mod = activeModules[i];
                    if (!mod) continue;

                    const modLabel = mod === "gemini" ? "API 1" : (mod === "gemini2" ? "API 2" : "API 3");
                    const modName = mod === "gemini" ? "Gemini 1" : (mod === "gemini2" ? "Gemini 2" : "Gemini 3");
                    addOrganiserLog(`[${modName}] Query started for: ${file.filename}`);

                    const maxRetries = 3;
                    let backoff = 2000;

                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                        if (organiserShouldStop) throw new Error("Cancelled");

                        updateOrganiserProgress(index, file.filename, `${modLabel}: Querying`, 'active', 30 + (attempt * 15));

                        try {
                            const response = await fetch('/api/gemini', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    module: mod,
                                    filename: file.filename,
                                    folder_name: file.folder_name || 'Onbekend',
                                    tags: file.tags || {}
                                })
                            });
                            
                            if (!response.ok) {
                                const errData = await response.json().catch(() => ({}));
                                throw new Error(errData.error || "HTTP " + response.status);
                            }
                            const resData = await response.json();
                            
                            let result = resData.result || resData;
                            let err = null;
                            if (result.error || result.unknown) {
                                err = result.error || "unknown";
                                result = null;
                            } else if (Array.isArray(resData) && resData.length === 2) {
                                result = resData[0];
                                err = resData[1];
                            }

                            if (result) {
                                qData = result;
                                break;
                            }
                            if (err === "unknown") {
                                addOrganiserLog(`[${modName}] Model could not match ('unknown'). Trying next model...`);
                                lastErr = err;
                                break;
                            }
                            if (err === "exhausted" || (err && String(err).includes('429'))) {
                                addOrganiserLog(`[${modName}] Rate limit reached. Backing off ${backoff/1000}s...`);
                                await new Promise(r => setTimeout(r, backoff));
                                backoff *= 2;
                                lastErr = err;
                                continue;
                            }
                            addOrganiserLog(`[${modName}] Error: ${err}. Trying next model...`);
                            lastErr = err;
                            break;
                        } catch (ex) {
                            addOrganiserLog(`[${modName}] Exception: ${ex.message}. Trying next model...`);
                            lastErr = ex.message;
                            break;
                        }
                    }
                    if (qData) break;
                }

                if (!qData) {
                    addOrganiserLog(`AI text matching failed, attempting Shazam Audio fallback for: ${file.filename}...`);
                    if (statusEl) statusEl.textContent = "AI Audio Query...";
                    updateOrganiserProgress(index, file.filename, 'Shazam API', 'active', 75);

                    const shazamResponse = await fetch('/api/gemini', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            module: "shazam",
                            filepath: file.full_path
                        })
                    });
                    
                    let audioRes = null;
                    let audioErr = null;
                    if (shazamResponse.ok) {
                        const sData = await shazamResponse.json();
                        if (Array.isArray(sData)) {
                            audioRes = sData[0];
                            audioErr = sData[1];
                        } else if (sData.error || sData.unknown) {
                            audioErr = sData.error || "unknown";
                        } else {
                            audioRes = sData;
                        }
                    } else {
                        audioErr = "Shazam API failed with " + shazamResponse.status;
                    }
                    if (audioRes) {
                        qData = audioRes;
                    } else {
                        qData = { unknown: true, error: audioErr || lastErr };
                    }
                }

                if (organiserShouldStop) throw new Error("Cancelled");

                if (statusEl) statusEl.textContent = `Moving & tagging...`;
                updateOrganiserProgress(index, file.filename, 'Moving', 'active', 90);

                var organizeModeSelect = document.getElementById('organiser-mode-select');
                var organizeMode = organizeModeSelect ? organizeModeSelect.value : 'classic_periods';
                var deleteSourceCheckbox = document.getElementById('organiser-delete-source');
                var deleteSource = deleteSourceCheckbox ? deleteSourceCheckbox.checked : false;

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
                    signal: signal
                });
                if (!fRes.ok) throw new Error("Finalize failed");
                var fData = await fRes.json();
                if (fData.error) throw new Error(fData.error);

                item.classList.add('success');
                if (statusEl) statusEl.textContent = `Success`;

                if (qData.unknown) {
                    updateOrganiserProgress(index, file.filename, 'Unknown', 'unknown', 100);
                } else {
                    updateOrganiserProgress(index, file.filename, 'Success', 'complete', 100);
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.message === 'Cancelled') {
                    item.classList.add('warning');
                    if (statusEl) statusEl.textContent = "Cancelled";
                    updateOrganiserProgress(index, file.filename, 'Cancelled', 'failed', 0);
                } else {
                    item.classList.add('failed');
                    if (statusEl) statusEl.textContent = "Error: " + err.message;
                    updateOrganiserProgress(index, file.filename, 'Failed', 'failed', 0);
                }
            } finally {
                processedCount++;
                var overallPercent = Math.round((processedCount / files.length) * 100);
                if (organiserTrackText) organiserTrackText.textContent = `${processedCount} / ${files.length} (${overallPercent}%)`;
                if (organiserProgressFill) organiserProgressFill.style.width = overallPercent + '%';
                if (trackCount) trackCount.textContent = `${processedCount} / ${files.length} items processed`;
            }
        };

        let concurrency = 1;
        try {
            concurrency = parseInt(localStorage.getItem('organiser-concurrency')) || 1;
        } catch(e) {}
        concurrency = Math.max(1, Math.min(4, concurrency));
        let currentIndex = 0;
        
        const worker = async () => {
            while (currentIndex < files.length && !organiserShouldStop) {
                const index = currentIndex++;
                const file = files[index];
                const controller = new AbortController();
                organiserActiveControllers.push(controller);
                
                try {
                    await processFile(file, index, controller.signal);
                } finally {
                    organiserActiveControllers = organiserActiveControllers.filter(c => c !== controller);
                }
            }
        };

        const workers = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        addOrganiserLog(organiserShouldStop ? "Process cancelled." : "[Success] Process completed successfully.");

        if (organiserCard) {
            organiserCard.classList.remove('status-downloading', 'status-setup');
            if (organiserShouldStop) {
                organiserCard.classList.add('status-idle');
                if (organiserStatusText) organiserStatusText.textContent = getTranslation('status_idle', 'Idle');
            } else {
                organiserCard.classList.add('status-completed');
                if (organiserStatusText) organiserStatusText.textContent = getTranslation('status_completed', 'Completed');
            }
        }

    } catch (err) {
        addOrganiserLog("[Error] " + err.message);
        if (organiserCard) {
            organiserCard.classList.remove('status-downloading', 'status-setup');
            organiserCard.classList.add('status-failed');
        }
        if (organiserStatusText) organiserStatusText.textContent = getTranslation('status_failed', 'Failed');
    } finally {
        finishOrganiser();
    }
}

function finishOrganiser() {
    var startBtn = document.getElementById('btn-organiser-start');
    var cancelBtn = document.getElementById('btn-organiser-cancel');
    if (startBtn) startBtn.style.display = 'inline-block';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

function addOrganiserLog(msg) {
    var consoleEl = document.getElementById('organiser-console');
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
 * Updates or creates a track progress loader inside the organiser panel.
 */
function updateOrganiserProgress(id, filename, actionText, state, percent) {
    var container = document.getElementById('organiser-active-progress');
    if (!container) return;

    var pct = Math.min(100, Math.max(0, Math.round(percent || 0)));
    var blockId = 'org-pb-' + id;
    var block = document.getElementById(blockId);

    if (!block) {
        block = document.createElement('div');
        block.className = 'track-progress-block';
        block.id = blockId;
        block.innerHTML = 
            '<div class="track-progress-info">' +
                '<span class="track-progress-title">' + filename + '</span>' +
            '</div>' +
            '<div class="track-progress-right">' +
                '<span class="api-badge" id="org-badge-' + id + '">' + actionText + '</span>' +
                '<div class="track-progress-circle-wrapper">' +
                    '<svg class="track-progress-circle" viewBox="0 0 36 36">' +
                        '<circle cx="18" cy="18" r="15.9155" class="circle-bg" />' +
                        '<circle cx="18" cy="18" r="15.9155" class="circle-fill" id="org-fill-circle-' + id + '" stroke-dasharray="0, 100" />' +
                        '<path class="checkmark-path" d="M12 18 l4 4 l8 -8" />' +
                        '<path class="cross-path" d="M12 12 l12 12 M24 12 l-12 12" />' +
                        '<path class="exclamation-path" d="M18 11 v8 M18 25 v2" />' +
                    '</svg>' +
                '</div>' +
            '</div>';
        container.prepend(block);
    }

    var badge = document.getElementById('org-badge-' + id);
    if (badge) {
        badge.textContent = actionText;
    }

    var circle = document.getElementById('org-fill-circle-' + id);
    if (circle) {
        circle.setAttribute('stroke-dasharray', pct + ', 100');
    }

    block.classList.remove('complete', 'failed', 'unknown');
    if (state === 'complete') {
        block.classList.add('complete');
    } else if (state === 'failed') {
        block.classList.add('failed');
    } else if (state === 'unknown') {
        block.classList.add('unknown');
    }
}

/**
 * Establishes an SSE event stream connection for printing raw organiser log messages in real-time.
 */
function connectOrganiserLogStream() {
    if (organiserEventSource) {
        organiserEventSource.close();
    }
    organiserEventSource = new EventSource('/api/log_stream');
    organiserEventSource.onmessage = function(event) {
        if (event.data) {
            addOrganiserLog(event.data);
        }
    };
    organiserEventSource.onerror = function() {
        organiserEventSource.close();
    };
}
