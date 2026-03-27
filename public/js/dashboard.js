// Local storage key
const PLAYER_PREF_KEY = 'multistream_player_enabled';
let playerEnabled = localStorage.getItem(PLAYER_PREF_KEY) !== 'false'; // Default true
let flvPlayer = null;
let flvjsLoaded = false;
let streamCheckInterval = null;

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    const playerToggle = document.getElementById('playerToggle');
    if (playerToggle) {
        playerToggle.checked = playerEnabled;
    }
    updatePlayerVisibility();
    loadStatus();
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
        const response = await fetch('/api/config');
        const config = await response.json();
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

                div.innerHTML = `
            <div class="platform-info">
              <span>${displayName}</span>
              <span class="${platform.enabled ? 'enabled' : 'disabled'}">
                ${platform.enabled ? '✓ Enabled' : '✗ Disabled'}
                ${!hasKey && !isRecording ? ' (No key configured)' : ''}
              </span>
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

    _configCache = config;
    let html = '';

    // Platforms Config
    html += '<h4 class="mb-4">Platforms</h4>';
    html += '<div class="grid-auto">';

    Object.entries(config.platforms).forEach(([name, platform]) => {
        if (name === 'recording' || name === 'browser_debug') return;

        const displayName = name.split('_').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');

        html += `
            <div class="card p-4">
                <div class="flex justify-between items-center mb-2">
                    <h5 class="mb-0 font-bold">${displayName}</h5>
                    ${platform.enabled ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-neutral">Disabled</span>'}
                </div>

                <div class="flex flex-col gap-2 text-sm">
                    <div>
                        <span class="text-muted block mb-1">RTMP URL</span>
                        <input type="text" value="${platform.rtmpUrl || ''}" id="rtmp-${name}"
                               class="bg-surface-hover border border-color rounded p-2 text-sm w-full font-mono">
                    </div>

                    <div>
                        <span class="text-muted block mb-1">Stream Key</span>
                        <div class="flex gap-2">
                            <input type="password" value="${platform.streamKey || ''}" id="key-${name}"
                                   class="bg-surface-hover border border-color rounded p-2 text-sm flex-1">
                            <button class="btn btn-secondary btn-sm" onclick="toggleKeyVisibility('key-${name}')" title="Show/Hide Key">👁️</button>
                        </div>
                    </div>

                    ${platform.settings && Object.keys(platform.settings).length > 0 ? `
                        <div class="mt-2">
                            <span class="text-muted block mb-1">Advanced Settings</span>
                            <div class="flex flex-col gap-1">
                                ${Object.entries(platform.settings).map(([k, v]) => `
                                    <div class="flex gap-2 items-center">
                                        <span class="text-secondary" style="min-width: 110px; font-size: 0.75em;">${k}</span>
                                        <input type="text" value="${v}" id="setting-${name}-${k}"
                                               class="bg-surface-hover border border-color rounded p-1 flex-1 font-mono" style="font-size: 0.75em;">
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <div class="flex justify-end mt-2">
                        <button class="btn btn-primary btn-sm" onclick="savePlatformConfig('${name}')">Save</button>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';

    // Global Config Section
    html += '<h4 class="mt-8 mb-4">Global Configuration</h4>';
    html += '<div class="grid-2">';

    if (config.server) {
        html += `
            <div class="card p-4">
                <h5 class="mb-2 font-bold">Server</h5>
                <div class="flex flex-col gap-2 text-sm">
                    ${Object.entries(config.server).map(([k, v]) => `
                        <div class="flex justify-between items-center border-b border-color pb-1 last:border-0">
                            <span class="text-muted">${k}</span>
                            <input type="number" value="${v}" id="server-${k}"
                                   class="bg-surface-hover border border-color rounded p-1 font-mono" style="width: 110px; text-align: right; font-size: 0.85em;">
                        </div>
                    `).join('')}
                </div>
                <div class="flex justify-end mt-3">
                    <button class="btn btn-primary btn-sm" onclick="saveGlobalConfig('server')">Save</button>
                </div>
            </div>
        `;
    }

    if (config.transcription) {
        html += `
            <div class="card p-4">
                <h5 class="mb-2 font-bold">Transcription</h5>
                <div class="flex flex-col gap-2 text-sm">
                    ${Object.entries(config.transcription).map(([k, v]) => {
                        if (typeof v === 'boolean') {
                            return `
                                <div class="flex justify-between items-center border-b border-color pb-1 last:border-0">
                                    <span class="text-muted">${k}</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="transcription-${k}" ${v ? 'checked' : ''}>
                                        <span class="toggle-slider"></span>
                                    </label>
                                </div>
                            `;
                        }
                        return `
                            <div class="flex justify-between items-center border-b border-color pb-1 last:border-0">
                                <span class="text-muted">${k}</span>
                                <input type="text" value="${v}" id="transcription-${k}"
                                       class="bg-surface-hover border border-color rounded p-1 font-mono" style="width: 110px; text-align: right; font-size: 0.85em;">
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="flex justify-end mt-3">
                    <button class="btn btn-primary btn-sm" onclick="saveGlobalConfig('transcription')">Save</button>
                </div>
            </div>
        `;
    }

    html += '</div>';

    container.innerHTML = html;
}

async function savePlatformConfig(platformName) {
    const rtmpInput = document.getElementById(`rtmp-${platformName}`);
    const keyInput = document.getElementById(`key-${platformName}`);

    const body = {};
    if (rtmpInput) body.rtmpUrl = rtmpInput.value;
    if (keyInput) body.streamKey = keyInput.value;

    const settingInputs = document.querySelectorAll(`[id^="setting-${platformName}-"]`);
    if (settingInputs.length > 0) {
        body.settings = {};
        settingInputs.forEach(input => {
            const key = input.id.slice(`setting-${platformName}-`.length);
            body.settings[key] = input.value;
        });
    }

    try {
        const response = await fetch(`/api/platforms/${platformName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await response.json();
        if (result.success) {
            UI.showToast('Settings saved', 'success');
        } else {
            UI.showToast('Failed to save: ' + (result.error || 'unknown error'), 'error');
        }
    } catch (error) {
        UI.showToast('Error saving settings', 'error');
    }
}

async function saveGlobalConfig(section) {
    if (!_configCache || !_configCache[section]) return;

    const data = {};
    Object.keys(_configCache[section]).forEach(key => {
        const input = document.getElementById(`${section}-${key}`);
        if (input) {
            if (input.type === 'checkbox') data[key] = input.checked;
            else if (input.type === 'number') data[key] = Number(input.value);
            else data[key] = input.value;
        }
    });

    try {
        const response = await fetch('/api/config/global', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [section]: data })
        });
        const result = await response.json();
        if (result.success) {
            UI.showToast('Settings saved', 'success');
        } else {
            UI.showToast('Failed to save: ' + (result.error || 'unknown error'), 'error');
        }
    } catch (error) {
        UI.showToast('Error saving settings', 'error');
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
    } catch (error) {
        console.error('Error updating format:', error);
        alert('Error updating format');
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
            alert(result.message);
        }
        // No need to reload whole status for this
    } catch (error) {
        console.error('Error toggling test mode:', error);
        checkbox.checked = !checkbox.checked;
        alert('Failed to toggle test mode');
    } finally {
        checkbox.disabled = false;
    }
}
