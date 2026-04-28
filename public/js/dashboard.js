// Local storage key
const PLAYER_PREF_KEY = 'multistream_player_enabled';
let playerEnabled = localStorage.getItem(PLAYER_PREF_KEY) !== 'false'; // Default true
let flvPlayer = null;
let flvjsLoaded = false;
let streamCheckInterval = null;

// Draft configuration for unsaved changes
let draftConfig = {
    platforms: {},
    server: {},
    transcription: {}
};

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    const playerToggle = document.getElementById('playerToggle');
    if (playerToggle) {
        playerToggle.checked = playerEnabled;
    }
    updatePlayerVisibility();
    loadStatus();

    // Auto-refresh every 5 seconds
    setInterval(loadStatus, 5000);
});

function togglePlayer(enabled) {
    playerEnabled = enabled;
    localStorage.setItem(PLAYER_PREF_KEY, enabled);
    updatePlayerVisibility();

    if (enabled) {
        loadStatus(); // Re-trigger load to setup player if needed
    } else {
        // Destroy player if disabled
        if (flvPlayer) {
            flvPlayer.destroy();
            flvPlayer = null;
        }
    }
}

function updatePlayerVisibility() {
    const container = document.getElementById('playerContainer');
    const statusText = document.getElementById('playerStatusText');
    const videoWrapper = document.getElementById('videoWrapper');

    if (!container || !statusText || !videoWrapper) return;

    if (playerEnabled) {
        container.style.display = 'block';
        statusText.style.display = 'none';
        videoWrapper.classList.add('visible');
    } else {
        container.style.display = 'none';
        statusText.style.display = 'block';
        videoWrapper.classList.remove('visible');
    }
}

async function reloadConfig() {
    const btn = document.getElementById('reloadButton');
    const status = document.getElementById('reloadStatus');

    btn.disabled = true;
    status.className = 'reload-status';
    status.textContent = 'Reloading...';

    try {
        const response = await fetch('/api/reload-config', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            status.textContent = 'Success!';
            status.classList.add('reload-success');
            loadStatus(); // Refresh platform status
        } else {
            status.textContent = 'Failed: ' + data.message;
            status.classList.add('reload-error');
        }
    } catch (error) {
        status.textContent = 'Error: ' + error.message;
        status.classList.add('reload-error');
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            // Clear success message after a few seconds
            if (status.classList.contains('reload-success')) {
                setTimeout(() => {
                    status.textContent = '';
                    status.className = 'reload-status';
                }, 3000);
            }
        }, 500);
    }
}

async function loadStatus() {
    try {
        const [configResponse, streamsResponse] = await Promise.all([
            fetch('/api/config'),
            fetch('/api/streams')
        ]);

        const config = await configResponse.json();
        const streamsData = await streamsResponse.json();
        const activePlatforms = new Set();
        (streamsData.streams || []).forEach(s => {
            (s.platforms || []).forEach(p => activePlatforms.add(p));
        });

        const platformsDiv = document.getElementById('platforms');
        if (platformsDiv) {
            platformsDiv.innerHTML = '';

            Object.entries(config.platforms).forEach(([name, platform]) => {
                const div = document.createElement('div');
                div.className = 'platform';
                const displayName = name.split('_').map(word =>
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join(' ');

                const hasKey = (platform.streamKey && platform.streamKey.length > 0) || platform.hasKey || name === 'browser_debug';
                const canToggle = hasKey;

                const isRecording = name === 'recording';
                const isLive = activePlatforms.has(name) || (name === 'recording' && streamsData.isActive);

                div.innerHTML = `
            <div class="platform-info">
              <span>${displayName}</span>
              <span class="${platform.enabled ? 'enabled' : 'disabled'}">
                ${platform.enabled ? '✓ Enabled' : '✗ Disabled'}
                ${!hasKey && !isRecording ? ' (No key configured)' : ''}
              </span>
              ${isLive ? '<span class="badge badge-success ml-4">LIVE</span>' : ''}
              ${isRecording ? `
                <div style="display: inline-block; margin-left: 10px;">
                    <select onchange="updateRecordingFormat(this.value)" style="padding: 2px 6px; background: var(--bg-body); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; font-size: 0.9em;">
                      <option value="mp4" ${platform.format === 'mp4' ? 'selected' : ''}>MP4</option>
                      <option value="mkv" ${platform.format === 'mkv' ? 'selected' : ''}>MKV</option>
                      <option value="flv" ${platform.format === 'flv' ? 'selected' : ''}>FLV</option>
                    </select>
                </div>
              ` : ''}
              ${name === 'twitch' ? `
                <div style="margin-left: 15px; display: flex; align-items: center; font-size: 0.9em;">
                  <input type="checkbox" id="twitchTestMode" 
                    ${platform.test_mode ? 'checked' : ''} 
                    onchange="toggleTestMode('${name}', this)" style="width: auto;">
                  <label for="twitchTestMode" style="margin-left: 5px; cursor: pointer;" title="Appends ?bandwidthtest=true to stream key">Test Mode</label>
                </div>
              ` : ''}
            </div>
            <label class="toggle-switch ${canToggle ? '' : 'disabled'}">
              <input type="checkbox" 
                     ${platform.enabled ? 'checked' : ''} 
                     ${canToggle ? '' : 'disabled'}
                     onchange="togglePlatform('${name}', this)">
              <span class="toggle-slider"></span>
            </label>
          `;
                platformsDiv.appendChild(div);
            });
        }

        // Check if browser_debug is enabled AND player is locally enabled
        // Only if playerEnabled var exists (global)
        if (typeof playerEnabled !== 'undefined' && config.platforms.browser_debug && config.platforms.browser_debug.enabled && playerEnabled) {
            // Only setup if we are on dashboard where player toggle exists
            if (document.getElementById('playerToggle')) {
                setupVideoPlayer();
                startStreamCheck();
            }
        }
        // Logic for stopping check if on dashboard
        if (typeof playerEnabled !== 'undefined' && !playerEnabled && streamCheckInterval) {
            clearInterval(streamCheckInterval);
            streamCheckInterval = null;
        }

        // Always try to update config display (for settings page)
        updateConfigDisplay(config);
    updateUnsavedChangesBar();
    } catch (error) {
        console.error(error);
        if (document.getElementById('platforms')) document.getElementById('platforms').innerHTML = 'Error loading status';
        if (document.getElementById('configContainer')) document.getElementById('configContainer').innerHTML = 'Error loading config';
    }
}

let _configCache = null;

function updateConfigDisplay(config) {
    const container = document.getElementById('configContainer');
    if (!container) return;

    // Don't re-render if user is currently typing in an input
    if (document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') &&
        container.contains(document.activeElement)) {
        return;
    }

    _configCache = config;
    let html = '';

    // Platforms Config
    html += '<h4 class="mb-4">Platforms</h4>';
    html += '<div class="grid-auto">';

    Object.entries(config.platforms).forEach(([name, platform]) => {
        const displayName = name.split('_').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');

        const draft = draftConfig.platforms[name] || {};
        const isModified = (field) => {
            if (field === 'rtmpUrl') return draft.rtmpUrl !== undefined && draft.rtmpUrl !== platform.rtmpUrl;
            if (field === 'streamKey') return draft.streamKey !== undefined && draft.streamKey !== platform.streamKey;
            if (field === 'enabled') return draft.enabled !== undefined && draft.enabled !== platform.enabled;
            if (field === 'test_mode') return draft.test_mode !== undefined && draft.test_mode !== platform.test_mode;
            if (field.startsWith('setting-')) {
                const key = field.replace('setting-', '');
                return draft.settings?.[key] !== undefined && draft.settings[key] != platform.settings?.[key];
            }
            return false;
        };

        const getVal = (field, original) => {
            if (field === 'rtmpUrl') return draft.rtmpUrl !== undefined ? draft.rtmpUrl : original;
            if (field === 'streamKey') return draft.streamKey !== undefined ? draft.streamKey : original;
            if (field === 'enabled') return draft.enabled !== undefined ? draft.enabled : original;
            if (field === 'test_mode') return draft.test_mode !== undefined ? draft.test_mode : original;
            if (field.startsWith('setting-')) {
                const key = field.replace('setting-', '');
                return draft.settings?.[key] !== undefined ? draft.settings[key] : original;
            }
            return original;
        };

        const enabledVal = getVal('enabled', platform.enabled);

        html += `
            <div class="card p-4">
                <div class="flex justify-between items-center mb-2">
                    <h5 class="mb-0 font-bold">${displayName}</h5>
                    <div class="flex items-center gap-2">
                        ${enabledVal ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-neutral">Disabled</span>'}
                        <label class="toggle-switch">
                            <input type="checkbox" ${enabledVal ? 'checked' : ''}
                                   onchange="updateDraftPlatform('${name}', 'enabled', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>

                <div class="flex flex-col gap-2 text-sm">
                    ${name !== 'recording' ? `
                    <div>
                        <span class="text-muted block mb-1">RTMP URL</span>
                        <input type="text" value="${getVal('rtmpUrl', platform.rtmpUrl || '')}" id="rtmp-${name}"
                               oninput="updateDraftPlatform('${name}', 'rtmpUrl', this.value)"
                               class="bg-surface-hover border ${isModified('rtmpUrl') ? 'border-accent-warning' : 'border-color'} rounded p-2 text-sm w-full font-mono">
                    </div>

                    <div>
                        <span class="text-muted block mb-1">Stream Key</span>
                        <div class="flex gap-2">
                            <input type="password" value="${getVal('streamKey', platform.streamKey || '')}" id="key-${name}"
                                   oninput="updateDraftPlatform('${name}', 'streamKey', this.value)"
                                   class="bg-surface-hover border ${isModified('streamKey') ? 'border-accent-warning' : 'border-color'} rounded p-2 text-sm flex-1">
                            <button class="btn btn-secondary btn-sm" onclick="toggleKeyVisibility('key-${name}')" title="Show/Hide Key">👁️</button>
                        </div>
                    </div>
                    ` : ''}

                    ${name === 'twitch' ? `
                    <div class="flex items-center gap-2 mt-1">
                        <input type="checkbox" id="test-mode-${name}" ${getVal('test_mode', platform.test_mode) ? 'checked' : ''}
                               onchange="updateDraftPlatform('${name}', 'test_mode', this.checked)" style="width: auto;">
                        <label for="test-mode-${name}" class="text-secondary ${isModified('test_mode') ? 'text-accent-warning font-bold' : ''}">Test Mode (?bandwidthtest=true)</label>
                    </div>
                    ` : ''}

                    ${platform.settings && Object.keys(platform.settings).length > 0 ? `
                        <div class="mt-2">
                            <span class="text-muted block mb-1">Advanced Settings</span>
                            <div class="flex flex-col gap-1">
                                ${Object.entries(platform.settings).map(([k, v]) => `
                                    <div class="flex gap-2 items-center">
                                        <span class="text-secondary" style="min-width: 110px; font-size: 0.75em;">${k}</span>
                                        <input type="text" value="${getVal('setting-' + k, v)}" id="setting-${name}-${k}"
                                               oninput="updateDraftPlatformSetting('${name}', '${k}', this.value)"
                                               class="bg-surface-hover border ${isModified('setting-' + k) ? 'border-accent-warning' : 'border-color'} rounded p-1 flex-1 font-mono" style="font-size: 0.75em;">
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    });
    html += '</div>';

    // Global Config Section
    html += '<h4 class="mt-8 mb-4">Global Configuration</h4>';
    html += '<div class="grid-2">';

    if (config.server) {
        const draft = draftConfig.server || {};
        const isModified = (k) => draft[k] !== undefined && draft[k] != config.server[k];
        const getVal = (k, v) => draft[k] !== undefined ? draft[k] : v;

        html += `
            <div class="card p-4">
                <h5 class="mb-2 font-bold">Server</h5>
                <div class="flex flex-col gap-2 text-sm">
                    ${Object.entries(config.server).map(([k, v]) => {
            const val = getVal(k, v);
            if (typeof v === 'boolean') {
                return `
                                <div class="flex justify-between items-center border-b border-color pb-1 last:border-0">
                                    <span class="text-muted ${isModified(k) ? 'text-accent-warning font-bold' : ''}">${k}</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="server-${k}" ${val ? 'checked' : ''}
                                               onchange="updateDraftGlobal('server', '${k}', this.checked)">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                            `;
            }
            return `
                            <div class="flex justify-between items-center border-b border-color pb-1 last:border-0">
                                <span class="text-muted">${k}</span>
                                <input type="number" value="${val}" id="server-${k}"
                                       oninput="updateDraftGlobal('server', '${k}', this.value)"
                                       class="bg-surface-hover border ${isModified(k) ? 'border-accent-warning' : 'border-color'} rounded p-1 font-mono" style="width: 110px; text-align: right; font-size: 0.85em;">
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    if (config.transcription) {
        const draft = draftConfig.transcription || {};
        const isModified = (k) => draft[k] !== undefined && draft[k] !== config.transcription[k];
        const getVal = (k, v) => draft[k] !== undefined ? draft[k] : v;

        html += `
            <div class="card p-4">
                <h5 class="mb-2 font-bold">Transcription</h5>
                <div class="flex flex-col gap-2 text-sm">
                    ${Object.entries(config.transcription).map(([k, v]) => {
            const val = getVal(k, v);
            if (typeof v === 'boolean') {
                return `
                                <div class="flex justify-between items-center border-b border-color pb-1 last:border-0">
                                    <span class="text-muted ${isModified(k) ? 'text-accent-warning font-bold' : ''}">${k}</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="transcription-${k}" ${val ? 'checked' : ''}
                                               onchange="updateDraftGlobal('transcription', '${k}', this.checked)">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                            `;
            }
            return `
                            <div class="flex justify-between items-center border-b border-color pb-1 last:border-0">
                                <span class="text-muted">${k}</span>
                                <input type="text" value="${val}" id="transcription-${k}"
                                       oninput="updateDraftGlobal('transcription', '${k}', this.value)"
                                       class="bg-surface-hover border ${isModified(k) ? 'border-accent-warning' : 'border-color'} rounded p-1 font-mono" style="width: 110px; text-align: right; font-size: 0.85em;">
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    html += '</div>';

    container.innerHTML = html;
}

function updateDraftPlatform(platformName, field, value) {
    if (!draftConfig.platforms[platformName]) {
        draftConfig.platforms[platformName] = {};
    }
    draftConfig.platforms[platformName][field] = value;
    updateUnsavedChangesBar();
}

function updateDraftPlatformSetting(platformName, settingKey, value) {
    if (!draftConfig.platforms[platformName]) {
        draftConfig.platforms[platformName] = {};
    }
    if (!draftConfig.platforms[platformName].settings) {
        draftConfig.platforms[platformName].settings = {};
    }
    draftConfig.platforms[platformName].settings[settingKey] = value;
    updateUnsavedChangesBar();
}

function updateDraftGlobal(section, key, value) {
    if (!draftConfig[section]) {
        draftConfig[section] = {};
    }
    draftConfig[section][key] = value;
    updateUnsavedChangesBar();
}

function hasUnsavedChanges() {
    // Check platforms
    for (const [name, platform] of Object.entries(draftConfig.platforms)) {
        const original = _configCache?.platforms[name] || {};
        if (platform.enabled !== undefined && platform.enabled !== original.enabled) return true;
        if (platform.rtmpUrl !== undefined && platform.rtmpUrl !== original.rtmpUrl) return true;
        if (platform.streamKey !== undefined && platform.streamKey !== original.streamKey) return true;
        if (platform.test_mode !== undefined && platform.test_mode !== original.test_mode) return true;
        if (platform.settings) {
            for (const [k, v] of Object.entries(platform.settings)) {
                if (v != original.settings?.[k]) return true;
            }
        }
    }

    // Check server
    for (const [k, v] of Object.entries(draftConfig.server)) {
        if (v != _configCache?.server?.[k]) return true;
    }

    // Check transcription
    for (const [k, v] of Object.entries(draftConfig.transcription)) {
        if (v !== _configCache?.transcription?.[k]) return true;
    }

    return false;
}

function updateUnsavedChangesBar() {
    let bar = document.getElementById('unsavedChangesBar');
    const hasChanges = hasUnsavedChanges();

    if (hasChanges) {
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'unsavedChangesBar';
            bar.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--bg-surface);
                border: 1px solid var(--accent-warning);
                padding: 12px 24px;
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-lg);
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 20px;
                animation: slideUp 0.3s ease;
            `;
            bar.innerHTML = `
                <span class="text-accent-warning font-bold">⚠️ Unsaved Changes</span>
                <div class="flex gap-2">
                    <button class="btn btn-secondary btn-sm" onclick="discardChanges()">Discard</button>
                    <button class="btn btn-primary btn-sm" onclick="saveBulkConfig()">Save All Changes</button>
                </div>
            `;
            document.body.appendChild(bar);

            // Add animation keyframe if not exists
            if (!document.getElementById('slideUpAnimation')) {
                const style = document.createElement('style');
                style.id = 'slideUpAnimation';
                style.textContent = `
                    @keyframes slideUp {
                        from { transform: translate(-50%, 100px); opacity: 0; }
                        to { transform: translate(-50%, 0); opacity: 1; }
                    }
                `;
                document.head.appendChild(style);
            }
        } else {
            // Re-enable button if it was in saving state
            const btn = bar.querySelector('.btn-primary');
            if (btn && btn.disabled && btn.textContent === 'Saving...') {
                btn.disabled = false;
                btn.textContent = 'Save All Changes';
            }
        }
    } else if (bar) {
        bar.remove();
    }
}

async function saveBulkConfig() {
    const bar = document.getElementById('unsavedChangesBar');
    if (bar) {
        const btn = bar.querySelector('.btn-primary');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }
    }

    try {
        const response = await fetch('/api/config/bulk', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draftConfig)
        });

        let result;
        try {
            result = await response.json();
        } catch (e) {
            result = { error: 'Invalid server response' };
        }

        if (response.ok && result.success) {
            UI.showToast('All changes saved successfully', 'success');
            draftConfig = { platforms: {}, server: {}, transcription: {} };
            loadStatus(); // Refresh everything
        } else {
            const errorMsg = result.details ? `${result.error}: ${result.details}` : (result.error || 'unknown error');
            UI.showToast('Failed to save: ' + errorMsg, 'error');
        }
    } catch (error) {
        console.error('Save error:', error);
        UI.showToast('Error saving settings: ' + error.message, 'error');
    } finally {
        updateUnsavedChangesBar();
    }
}

function discardChanges() {
    if (confirm('Discard all unsaved changes?')) {
        draftConfig = { platforms: {}, server: {}, transcription: {} };
        updateConfigDisplay(_configCache);
        updateUnsavedChangesBar();
        UI.showToast('Changes discarded', 'info');
    }
}

function toggleKeyVisibility(elementId) {
    const input = document.getElementById(elementId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
}

async function updateRecordingFormat(format) {
    try {
        const response = await fetch('/api/recording/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format })
        });

        if (!response.ok) {
            throw new Error('Failed to update format');
        }
        UI.showToast(`Recording format updated to ${format.toUpperCase()}`, 'success');
    } catch (error) {
        console.error('Error updating format:', error);
        UI.showToast('Error updating format', 'error');
        loadStatus(); // Revert UI
    }
}

function setupVideoPlayer() {
    if (!playerEnabled) return;

    if (flvjsLoaded) {
        checkAndPlayStream();
        return;
    }

    // Script is already in HTML, we just check if it's loaded by existence of flvjs
    if (typeof flvjs !== 'undefined') {
        flvjsLoaded = true;
        checkAndPlayStream();
    } else {
        // Wait a bit? Or we assume it was loaded synchronously from header
        // If not, we might need to load it dynamically, but for now let's assume it's in <head>
        console.error('flv.js not found');
    }
}

function checkAndPlayStream() {
    if (!playerEnabled) return;

    // Check stream status first
    fetch('/api/streams')
        .then(res => res.json())
        .then(data => {
            if (data.isActive && !flvPlayer) {
                initializePlayer();
            } else if (!data.isActive) {
                updateStreamStatus(false);
                if (flvPlayer) {
                    flvPlayer.destroy();
                    flvPlayer = null;
                }
            }
        })
        .catch(err => {
            console.error('Error checking stream status:', err);
            updateStreamStatus(false);
        });
}

async function initializePlayer() {
    if (flvPlayer || !flvjs.isSupported() || !playerEnabled) return;

    try {
        // Fetch config to get the correct stream key for debug
        const response = await fetch('/api/config');
        const config = await response.json();
        const streamKey = config.platforms.browser_debug?.streamKey || 'stream';

        const video = document.getElementById('videoPlayer');
        // Use absolute path or relative, but ensure it goes through proxy
        // NMS remuxes RTMP /live/<key> to HTTP /live/<key>.flv
        const streamUrl = window.location.origin + `/live/${streamKey}.flv`;

        flvPlayer = flvjs.createPlayer({
            type: 'flv',
            url: streamUrl,
            isLive: true,
            enableStashBuffer: false,
            stashInitialSize: 128,
            enableWorker: true,
            lazyLoadMaxDuration: 3 * 60,
            seekType: 'range'
        });

        flvPlayer.attachMediaElement(video);
        flvPlayer.load();

        flvPlayer.on(flvjs.Events.METADATA_ARRIVED, () => {
            updateStreamStatus(true);
            flvPlayer.play().catch(e => {
                console.log('Autoplay prevented:', e);
                // Add a play button if autoplay fails
                video.controls = true;
            });
        });

        flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail) => {
            console.error('FLV playback error:', errorType, errorDetail);
            updateStreamStatus(false);
            if (flvPlayer) {
                flvPlayer.destroy();
                flvPlayer = null;
            }
        });
    } catch (error) {
        console.error('Error initializing player:', error);
    }
}

function updateStreamStatus(isActive) {
    const statusEl = document.getElementById('streamStatus');
    if (isActive) {
        statusEl.className = 'stream-status stream-active';
        statusEl.textContent = 'Stream Active';
    } else {
        statusEl.className = 'stream-status stream-inactive';
        statusEl.textContent = 'Stream Not Active';
    }
}

// Check stream status periodically
function startStreamCheck() {
    if (!playerEnabled) return;

    checkAndPlayStream();
    if (streamCheckInterval) clearInterval(streamCheckInterval);
    streamCheckInterval = setInterval(checkAndPlayStream, 3000);
}

// Toggle collapsible sections
function toggleCollapse(elementId) {
    const content = document.getElementById(elementId);
    const header = content.previousElementSibling;

    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        content.classList.add('expanded');
        header.classList.remove('collapsed');
    } else {
        content.classList.remove('expanded');
        content.classList.add('collapsed');
        header.classList.add('collapsed');
    }
}

// Toggle platform enabled/disabled
async function togglePlatform(platformName, checkbox) {
    // Disable the checkbox during the request
    checkbox.disabled = true;

    try {
        const response = await fetch(`/api/platforms/${platformName}/toggle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (!result.success) {
            // Revert checkbox state on failure
            checkbox.checked = !checkbox.checked;
            console.error('Failed to toggle platform:', result.message);
        }

        // Reload status to reflect changes
        setTimeout(loadStatus, 500);
    } catch (error) {
        // Revert checkbox state on error
        checkbox.checked = !checkbox.checked;
        console.error('Error toggling platform:', error);
    } finally {
        // It will be re-rendered by loadStatus, so we don't strictly *need* to re-enable, 
        // but it's good practice in case loadStatus fails or is delayed.
        checkbox.disabled = false;
    }
}

async function toggleTestMode(platformName, checkbox) {
    checkbox.disabled = true;
    try {
        const response = await fetch(`/api/platforms/${platformName}/test-mode`, { method: 'POST' });
        const result = await response.json();

        if (!result.success) {
            checkbox.checked = !checkbox.checked;
            UI.showToast(result.message, 'error');
        } else {
            UI.showToast(result.message, 'success');
        }
        // No need to reload whole status for this
    } catch (error) {
        console.error('Error toggling test mode:', error);
        checkbox.checked = !checkbox.checked;
        UI.showToast('Failed to toggle test mode', 'error');
    } finally {
        checkbox.disabled = false;
    }
}
