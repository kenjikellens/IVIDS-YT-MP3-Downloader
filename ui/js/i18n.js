/**
 * ui/js/i18n.js — Translation & Language Manager
 * 
 * Handles language translation dictionary storage, key resolution, and
 * dynamic localization DOM updates.
 */

/** @type {Object} The current language translation key-value mappings dictionary */
var currentLocaleData = {};

/**
 * Retrieves the translation string for a given key from the loaded locale dictionary.
 * Falls back to the provided default value if the key does not exist.
 * 
 * @param {string} key - The lookup translation key
 * @param {string} defaultValue - Fallback value
 * @returns {string} The translation value
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
    
    // Call dependent module renders if defined
    if (typeof renderDownloadHistory === 'function') {
        renderDownloadHistory();
    }
    if (typeof loadedTracks !== 'undefined' && loadedTracks && loadedTracks.length > 0 && typeof renderPreview === 'function') {
        renderPreview(loadedTracks);
    }
    if (typeof syncCustomSelects === 'function') {
        syncCustomSelects();
    }
}

/**
 * Asynchronously fetches the JSON locale file for the selected language code.
 * Falls back to English on failure and triggers the DOM translation updates.
 * 
 * @param {string} langCode - Language iso code (e.g. 'nl', 'en')
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
