/**
 * ui/script.js — SPA Router & Shell Controller
 * 
 * Manages dynamic page routing (fetching HTML templates under ui/pages/),
 * sidebar navigation active states, color theme styling propagation, 
 * titlebar minimize/maximize/close controls, and Electron/Browser IPC bridges.
 */

/** @type {EventSource|null} Reference to active SSE download stream (Browser Mode fallback only) */
var activeEventSource = null;

/** @type {Array<Object>} Currently loaded tracks metadata array */
var loadedTracks = [];

/** @type {number|null} Debounce timer handle for URL input auto-load triggering */
var autoLoadDebounceTimer = null;

/** @type {number} Total tracks in active download job */
var totalQueueTracks = 0;
/** @type {number} Completed tracks in active download job */
var completedQueueTracks = 0;
/** @type {number} Overall percentage progress */
var currentOverallProgressPercent = 0;
/** @type {Object} Map of track ID to last progress percentage */
var activeTrackProgressMap = {};
/** @type {string} Last known status string */
var currentStatusString = 'Idle';

// Define layout template routes and initialisation lifecycles
const routes = {
    'home': { url: 'pages/home.html', init: initHomePage },
    'pipeline': { url: 'pages/pipeline.html', init: initPipelinePage },
    'ytdl': { url: 'pages/ytdl.html', init: initYtdlPage },
    'organiser': { url: 'pages/organiser.html', init: initOrganiserPage },
    'settings': { url: 'pages/settings.html', init: initSettingsPage }
};

/**
 * Loads the HTML template fragment dynamically and runs its page initialization.
 * 
 * @param {string} routeKey - Route destination name ('home' | 'pipeline' | 'ytdl' | 'organiser' | 'settings')
 */
async function navigateTo(routeKey) {
    var route = routes[routeKey];
    if (!route) return;

    var container = document.getElementById('main-content');
    if (!container) return;

    // Show loading spinner during fetch
    container.innerHTML = `
        <div style="display: flex; height: 100%; align-items: center; justify-content: center; flex-direction: column; gap: 16px;">
            <div class="spinner"></div>
            <p>Loading...</p>
        </div>
    `;

    try {
        // Cache-busting parameter to prevent Electron caching HTML fragment files
        var response = await fetch(route.url + '?v=' + Date.now());
        if (!response.ok) throw new Error("Could not fetch page fragment: " + route.url);
        var html = await response.text();

        container.innerHTML = html;

        // Run the specific page controller's lifecycle initialization
        await route.init();

        // Propagate active translations on newly loaded DOM elements
        if (typeof applyTranslations === 'function') {
            applyTranslations();
        }

        // Initialize custom selects for elements inside the fragment
        if (typeof initializeCustomSelects === 'function') {
            initializeCustomSelects();
        }

        // Update sidebar select state
        updateSidebarActiveState(routeKey);

    } catch (err) {
        container.innerHTML = `
            <div style="padding: 24px; color: var(--accent-red); text-align: center;">
                <h3>Error Loading Page</h3>
                <p>${err.message}</p>
            </div>
        `;
    }

    closeSidebar();
}

/**
 * Updates the CSS class decoration of the active sidebar navigation item.
 * 
 * @param {string} routeKey - Active page identifier
 */
function updateSidebarActiveState(routeKey) {
    document.querySelectorAll('.sidebar .nav-item').forEach(function(item) {
        item.classList.remove('active');
    });

    var activeNavItem = document.getElementById('nav-' + routeKey);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    }
}

/**
 * Toggles the mobile navigation sidebar menu.
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
 * Closes the mobile navigation sidebar.
 */
function closeSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
    }
}

// Initialise core app shell elements on DOM ready
document.addEventListener('DOMContentLoaded', async function() {
    
    // 1. Titlebar buttons & Electron IPC binding
    var btnMin = document.getElementById('btn-minimize');
    var btnMax = document.getElementById('btn-maximize');
    var btnClose = document.getElementById('btn-close');
    var isElectron = !!window.electronAPI;

    if (isElectron) {
        if (btnMin) btnMin.addEventListener('click', () => window.electronAPI.minimize());
        if (btnMax) btnMax.addEventListener('click', () => window.electronAPI.maximize());
        if (btnClose) btnClose.addEventListener('click', () => window.electronAPI.close());

        // Electron IPC download progress handlers
        window.electronAPI.onProgress((percent) => {
            if (typeof setProgress === 'function') setProgress(percent);
        });
        window.electronAPI.onTrackProgress((data) => {
            if (typeof updateTrackProgress === 'function') updateTrackProgress(data.id, data.title, data.percent);
        });
        window.electronAPI.onStatus((data) => {
            if (typeof setStatus === 'function') setStatus(data.status, data.track);
        });
        window.electronAPI.onComplete((data) => {
            if (typeof onComplete === 'function') onComplete(data.success, data.errorMsg);
        });
    } else {
        // Web Browser mode overrides
        var titlebar = document.getElementById('app-titlebar');
        if (titlebar) titlebar.style.display = 'none';
        document.documentElement.classList.add('browser-mode');
    }

    // 2. Hamburger button (mobile views)
    var hamburgerBtn = document.getElementById('hamburger-btn');
    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', toggleSidebar);
    }

    var sidebarOverlay = document.getElementById('sidebar-overlay');
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // 3. Navigation Sidebar Links
    var navHome = document.getElementById('nav-home');
    if (navHome) navHome.addEventListener('click', () => navigateTo('home'));

    var navPipeline = document.getElementById('nav-pipeline');
    if (navPipeline) navPipeline.addEventListener('click', () => navigateTo('pipeline'));

    var navYtdl = document.getElementById('nav-ytdl');
    if (navYtdl) navYtdl.addEventListener('click', () => navigateTo('ytdl'));

    var navOrganiser = document.getElementById('nav-organiser');
    if (navOrganiser) navOrganiser.addEventListener('click', () => navigateTo('organiser'));

    var navSettings = document.getElementById('nav-settings');
    if (navSettings) navSettings.addEventListener('click', () => navigateTo('settings'));

    // 4. Restore saved color theme
    var savedTheme = 'dark';
    try {
        savedTheme = localStorage.getItem('app-theme') || 'dark';
    } catch(e) {}
    if (typeof changeTheme === 'function') {
        changeTheme(savedTheme);
    }

    // 5. Load localization preference
    var savedLang = 'en';
    try {
        savedLang = localStorage.getItem('app-lang') || 'en';
    } catch(e) {}
    if (typeof loadLanguage === 'function') {
        await loadLanguage(savedLang);
    }

    // 6. Restore CLI logs visibility preference
    var cliLogsVisible = 'true';
    try {
        cliLogsVisible = localStorage.getItem('cli-logs-visible') || 'true';
    } catch(e) {}
    if (cliLogsVisible === 'true') {
        document.body.classList.remove('hide-cli');
    } else {
        document.body.classList.add('hide-cli');
    }

    // 7. Navigate to initial home screen
    await navigateTo('home');
});
