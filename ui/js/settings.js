/**
 * ui/js/settings.js — Instellingen Pagina Controller
 * 
 * Beheert de initialisatie, opslag en binding van alle gebruikersvoorkeuren
 * (taal, thema, gelijktijdige downloads, opstart-kwaliteit).
 */

/**
 * Initialiseert alle event-listeners en waarden op de Instellingen-pagina.
 */
async function initSettingsPage() {
    // 1. Hook up Theme Toggle Switch
    var themeSwitch = document.getElementById('theme-switch');
    if (themeSwitch) {
        // Zorg dat de visuele state klopt met localStorage
        var savedTheme = 'dark';
        try {
            savedTheme = localStorage.getItem('app-theme') || 'dark';
        } catch (e) {}
        if (savedTheme === 'light') {
            themeSwitch.classList.remove('dark');
            themeSwitch.setAttribute('aria-checked', 'false');
        } else {
            themeSwitch.classList.add('dark');
            themeSwitch.setAttribute('aria-checked', 'true');
        }

        themeSwitch.addEventListener('click', toggleTheme);
        themeSwitch.addEventListener('keydown', function(e) {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggleTheme();
            }
        });
    }

    // 2. Hook up CLI Logs Switch
    var cliSwitch = document.getElementById('cli-switch');
    if (cliSwitch) {
        var cliLogsVisible = 'true';
        try {
            cliLogsVisible = localStorage.getItem('cli-logs-visible') || 'true';
        } catch (e) {}
        
        if (cliLogsVisible === 'true') {
            document.body.classList.remove('hide-cli');
            cliSwitch.classList.add('dark');
            cliSwitch.setAttribute('aria-checked', 'true');
        } else {
            document.body.classList.add('hide-cli');
            cliSwitch.classList.remove('dark');
            cliSwitch.setAttribute('aria-checked', 'false');
        }

        cliSwitch.addEventListener('click', toggleCli);
        cliSwitch.addEventListener('keydown', function(e) {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggleCli();
            }
        });
    }

    // 3. Hook up Settings Default Folder browse trigger
    var btnSettingsBrowse = document.getElementById('btn-settings-browse');
    if (btnSettingsBrowse) {
        btnSettingsBrowse.addEventListener('click', browseDefaultDirectory);
    }

    // 4. Load initial default directory mode preference
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

    // 5. Load initial concurrency (multidownload) preference
    var concurrencySelect = document.getElementById('settings-concurrency');
    if (concurrencySelect) {
        var threads = navigator.hardwareConcurrency || 4;
        var maxConcurrency = Math.max(1, Math.min(8, Math.floor(threads / 2)));

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
            if (parseInt(savedConcurrency) > maxConcurrency) {
                savedConcurrency = maxConcurrency.toString();
                localStorage.setItem('app-concurrency', savedConcurrency);
            }
        } catch (e) {}
        concurrencySelect.value = savedConcurrency;

        concurrencySelect.addEventListener('change', function() {
            try {
                localStorage.setItem('app-concurrency', concurrencySelect.value);
                if (typeof addLog === 'function') {
                    addLog(getTranslation('log_concurrency_saved', 'Simultaneous downloads set to: ') + concurrencySelect.value);
                }
            } catch (e) {}
        });
    }

    var orgConcurrencySelect = document.getElementById('settings-org-concurrency');
    if (orgConcurrencySelect) {
        var savedOrgConcurrency = '1';
        try {
            savedOrgConcurrency = localStorage.getItem('organiser-concurrency') || '1';
        } catch (e) {}
        orgConcurrencySelect.value = savedOrgConcurrency;

        orgConcurrencySelect.addEventListener('change', function() {
            try {
                localStorage.setItem('organiser-concurrency', orgConcurrencySelect.value);
            } catch (e) {}
        });
    }

    // 6. Load initial language preference
    var langSelect = document.getElementById('settings-lang-select');
    if (langSelect) {
        var savedLang = 'en';
        try {
            savedLang = localStorage.getItem('app-lang') || 'en';
        } catch (e) {}
        langSelect.value = savedLang;

        langSelect.addEventListener('change', async function() {
            try {
                localStorage.setItem('app-lang', langSelect.value);
                await loadLanguage(langSelect.value);
                if (typeof addLog === 'function') {
                    addLog(getTranslation('log_lang_saved', 'Language preference saved: ') + langSelect.value.toUpperCase());
                }
            } catch (e) {}
        });
    }

    // 7. Load default startup audio quality
    var startupAudioSelect = document.getElementById('settings-startup-audio-quality');
    var savedStartupAudio = '192k';
    try {
        savedStartupAudio = localStorage.getItem('app-startup-audio-quality') || '192k';
    } catch (e) {}
    if (startupAudioSelect) {
        startupAudioSelect.value = savedStartupAudio;
        startupAudioSelect.addEventListener('change', function() {
            try {
                localStorage.setItem('app-startup-audio-quality', startupAudioSelect.value);
            } catch (e) {}
        });
    }

    // 8. Load default startup video quality
    var startupVideoSelect = document.getElementById('settings-startup-video-quality');
    var savedStartupVideo = 'best';
    try {
        savedStartupVideo = localStorage.getItem('app-startup-video-quality') || 'best';
    } catch (e) {}
    if (startupVideoSelect) {
        startupVideoSelect.value = savedStartupVideo;
        startupVideoSelect.addEventListener('change', function() {
            try {
                localStorage.setItem('app-startup-video-quality', startupVideoSelect.value);
            } catch (e) {}
        });
    }

    // Synchroniseer custom select elementen
    syncCustomSelects();
    
    // Initialiseer directory pad label
    await initOutputDirectory();
}

/**
 * Toggles the raw CLI command logs display class on the body and saves setting.
 */
function toggleCli() {
    var cliSwitch = document.getElementById('cli-switch');
    var isHidden = document.body.classList.toggle('hide-cli');
    var isVisible = !isHidden;
    
    if (cliSwitch) {
        if (isVisible) {
            cliSwitch.classList.add('dark');
            cliSwitch.setAttribute('aria-checked', 'true');
        } else {
            cliSwitch.classList.remove('dark');
            cliSwitch.setAttribute('aria-checked', 'false');
        }
    }
    try {
        localStorage.setItem('cli-logs-visible', isVisible.toString());
    } catch (e) {}
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
                if (typeof addLog === 'function') {
                    addLog(getTranslation('log_custom_folder_set', 'Custom default folder set to: ') + folderPath);
                }
            }
        }
    } catch (err) {
        if (typeof addLog === 'function') {
            addLog('[Error] ' + getTranslation('log_failed_select_default_dir', 'Failed to select default directory: ') + err.message);
        }
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
