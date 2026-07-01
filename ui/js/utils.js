/**
 * ui/js/utils.js — General Utility & Helper Functions
 * 
 * Houses shared DOM modifiers, formatters, styling functions, and console logger utilities.
 */

/**
 * Formats a track duration value in seconds to a human-readable MM:SS string.
 * Falls back to a translated "Unknown" label if invalid.
 * 
 * @param {number} durationSeconds - Duration in seconds
 * @returns {string} Formatted duration (e.g. "3:45")
 */
function formatDuration(durationSeconds) {
    if (!durationSeconds || isNaN(durationSeconds)) return getTranslation('preview_unknown', 'Unknown');
    var minutes = Math.floor(durationSeconds / 60);
    var seconds = Math.floor(durationSeconds % 60);
    if (seconds < 10) seconds = '0' + seconds;
    return minutes + ':' + seconds;
}

/**
 * Applies the selected color theme classes to the application HTML node.
 * Stores the chosen theme preferences in LocalStorage and updates the theme toggle switch.
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
                if (typeof addLog === 'function') {
                    addLog(getTranslation('log_output_folder_set', 'Output folder set to: ') + folderPath);
                }
            }
        }
    } catch (err) {
        if (typeof addLog === 'function') {
            addLog('[Error] ' + getTranslation('log_failed_select_dir', 'Failed to select directory: ') + err.message);
        }
    }
}

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

        function rebuildOptions() {
            optionsContainer.innerHTML = '';
            var options = select.querySelectorAll('option');
            options.forEach(function(opt) {
                var optionEl = document.createElement('div');
                optionEl.className = 'custom-select-option';
                optionEl.textContent = opt.textContent;
                optionEl.dataset.value = opt.value;
                if (opt.selected) {
                    optionEl.classList.add('selected');
                    triggerText.textContent = opt.textContent;
                }
                
                optionEl.addEventListener('click', function(e) {
                    e.stopPropagation();
                    select.value = optionEl.dataset.value;
                    select.dispatchEvent(new Event('change'));
                    optionsContainer.classList.remove('open');
                });
                optionsContainer.appendChild(optionEl);
            });
        }

        rebuildOptions();

        // Listen for standard changes on native select to update custom UI
        select.addEventListener('change', function() {
            var selectedOpt = select.querySelector('option[value="' + select.value + '"]');
            if (selectedOpt) {
                triggerText.textContent = selectedOpt.textContent;
            }
            optionsContainer.querySelectorAll('.custom-select-option').forEach(function(el) {
                if (el.dataset.value === select.value) {
                    el.classList.add('selected');
                } else {
                    el.classList.remove('selected');
                }
            });
        });

        // Toggle open/closed dropdown lists
        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            if (select.disabled) return;
            
            // Close all other selects first
            document.querySelectorAll('.custom-select-options').forEach(function(s) {
                if (s !== optionsContainer) s.classList.remove('open');
            });
            
            optionsContainer.classList.toggle('open');
        });

        select.parentNode.insertBefore(customSelect, select.nextSibling);
    });

    // Close options list when clicking outside
    document.addEventListener('click', function() {
        document.querySelectorAll('.custom-select-options').forEach(function(s) {
            s.classList.remove('open');
        });
    });
}

/**
 * Synchronizes the visual selection states of the custom dropdown components with the native select values.
 */
function syncCustomSelects() {
    document.querySelectorAll('select').forEach(function(select) {
        var customSelect = select.nextElementSibling;
        if (customSelect && customSelect.classList.contains('custom-select')) {
            var triggerText = customSelect.querySelector('.custom-select-trigger-text');
            var selectedOpt = select.options[select.selectedIndex];
            if (selectedOpt && triggerText) {
                triggerText.textContent = selectedOpt.textContent;
            }
            
            var optionsContainer = customSelect.querySelector('.custom-select-options');
            if (optionsContainer) {
                optionsContainer.querySelectorAll('.custom-select-option').forEach(function(el) {
                    if (el.dataset.value === select.value) {
                        el.classList.add('selected');
                    } else {
                        el.classList.remove('selected');
                    }
                });
            }
        }
    });
}
