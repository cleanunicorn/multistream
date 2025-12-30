// Local storage key
const PLAYER_PREF_KEY = 'multistream_player_enabled';
let playerEnabled = localStorage.getItem(PLAYER_PREF_KEY) !== 'false'; // Default true
let flvPlayer = null;
let flvjsLoaded = false;
let streamCheckInterval = null;

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('playerToggle').checked = playerEnabled;
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
        platformsDiv.innerHTML = '';

        Object.entries(config.platforms).forEach(([name, platform]) => {
            const div = document.createElement('div');
            div.className = 'platform';
            const displayName = name.split('_').map(word =>
                word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ');

            const hasKey = (platform.streamKey && platform.streamKey.length > 0) || platform.hasKey || name === 'browser_debug';
            const canToggle = hasKey;

            div.innerHTML = `
        <div class="platform-info">
          <span>${displayName}</span>
          <span class="${platform.enabled ? 'enabled' : 'disabled'}">
            ${platform.enabled ? '✓ Enabled' : '✗ Disabled'}
            ${!hasKey && name !== 'recording' ? ' (No key configured)' : ''}
          </span>
          ${name === 'recording' ? `
            <select onchange="updateRecordingFormat(this.value)" style="margin-left: 10px; padding: 2px;">
              <option value="mp4" ${platform.format === 'mp4' ? 'selected' : ''}>MP4</option>
              <option value="mkv" ${platform.format === 'mkv' ? 'selected' : ''}>MKV</option>
              <option value="flv" ${platform.format === 'flv' ? 'selected' : ''}>FLV</option>
            </select>
          ` : ''}
          ${name === 'twitch' ? `
            <div style="margin-left: 15px; display: flex; align-items: center; font-size: 0.9em;">
              <input type="checkbox" id="twitchTestMode" 
                ${platform.test_mode ? 'checked' : ''} 
                onchange="toggleTestMode('${name}', this)">
              <label for="twitchTestMode" style="margin-left: 5px; cursor: pointer;" title="Appends ?bandwidthtest=true to stream key">Test Mode (No Live)</label>
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

        // Check if browser_debug is enabled AND player is locally enabled
        if (config.platforms.browser_debug && config.platforms.browser_debug.enabled && playerEnabled) {
            setupVideoPlayer();
            startStreamCheck();
        } else if (!playerEnabled && streamCheckInterval) {
            clearInterval(streamCheckInterval);
            streamCheckInterval = null;
        }

        updateConfigDisplay(config);
    } catch (error) {
        console.error(error);
        document.getElementById('platforms').innerHTML = 'Error loading status';
        document.getElementById('configContainer').innerHTML = 'Error loading config';
    }
}

function updateConfigDisplay(config) {
    const container = document.getElementById('configContainer');
    let html = '<table class="config-table">';
    html += '<tr><th>Platform</th><th>RTMP URL</th><th>Stream Key</th><th>Settings</th></tr>';

    Object.entries(config.platforms).forEach(([name, platform]) => {
        if (name === 'recording' || name === 'browser_debug') return;

        const displayName = name.split('_').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');

        // Format settings
        const settingsHtml = platform.settings && Object.keys(platform.settings).length > 0
            ? `<pre class="settings-json">${JSON.stringify(platform.settings, null, 2)}</pre>`
            : '<span class="text-muted">Default</span>';

        html += `
            <tr>
                <td><strong>${displayName}</strong></td>
                <td><code class="url-code">${platform.rtmpUrl}</code></td>
                <td>
                    <div class="key-container">
                        <input type="password" readonly value="${platform.streamKey || ''}" id="key-${name}" class="stream-key-input">
                        <button class="icon-button" onclick="toggleKeyVisibility('key-${name}')" title="Show/Hide Key">👁️</button>
                    </div>
                </td>
                <td>${settingsHtml}</td>
            </tr>
        `;
    });

    html += '</table>';

    // Global Config Section
    html += '<div class="global-config">';
    html += '<h4>Global Configuration</h4>';

    if (config.server) {
        html += '<div class="config-block"><h5>Server</h5>';
        html += `<pre class="settings-json">${JSON.stringify(config.server, null, 2)}</pre></div>`;
    }

    if (config.transcription) {
        html += '<div class="config-block"><h5>Transcription</h5>';
        html += `<pre class="settings-json">${JSON.stringify(config.transcription, null, 2)}</pre></div>`;
    }

    html += '</div>';

    container.innerHTML = html;
}

function toggleKeyVisibility(elementId) {
    const input = document.getElementById(elementId);
    if (input.type === 'password') {
        input.type = 'text';
    } else {
        input.type = 'password';
    }
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
