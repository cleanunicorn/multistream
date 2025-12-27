import express from 'express';
import logger from '../utils/logger.js';
import { loadConfig, configEvents } from '../config/config.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

let streamManager = null;

export function createAPIServer(streamManagerInstance) {
  const app = express();
  const config = loadConfig();
  streamManager = streamManagerInstance;

  app.use(express.json());

  // Enable CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
  });

  // Proxy FLV stream from the HTTP streaming server
  app.use('/live', createProxyMiddleware({
    target: `http://localhost:${config.server.httpStreamingPort}`,
    changeOrigin: true,
    ws: false,
    onError: (err, req, res) => {
      logger.error('Proxy error:', err);
      res.status(502).send('Stream proxy error');
    }
  }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Get current configuration (without sensitive data)
  app.get('/api/config', (req, res) => {
    const config = loadConfig();
    const safeConfig = {
      platforms: {}
    };

    Object.keys(config.platforms).forEach(platform => {
      safeConfig.platforms[platform] = {
        enabled: config.platforms[platform].enabled,
        rtmpUrl: config.platforms[platform].rtmpUrl,
        hasKey: !!config.platforms[platform].streamKey
      };
    });

    res.json(safeConfig);
  });

  // Get active streams
  app.get('/api/streams', (req, res) => {
    if (streamManager) {
      const activeStreams = streamManager.getActiveStreams();
      res.json({
        streams: activeStreams,
        isActive: activeStreams.length > 0
      });
    } else {
      res.json({ streams: [], isActive: false });
    }
  });

  // Trigger manual config reload
  app.post('/api/reload-config', (req, res) => {
    try {
      const newConfig = loadConfig();
      configEvents.emit('configReloaded', newConfig);
      logger.info('Manual configuration reload triggered');
      res.json({
        success: true,
        message: 'Configuration reloaded successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Manual config reload failed:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reload configuration',
        error: error.message
      });
    }
  });

  // Toggle platform enabled/disabled status
  app.post('/api/platforms/:platform/toggle', async (req, res) => {
    try {
      const { platform } = req.params;
      const config = loadConfig();

      // Check if platform exists
      if (!config.platforms[platform]) {
        return res.status(404).json({
          success: false,
          message: `Platform ${platform} not found`
        });
      }

      // Read current config file
      const configPath = path.join(process.cwd(), 'config.yaml');
      const configContent = fs.readFileSync(configPath, 'utf8');
      const yamlConfig = yaml.parse(configContent);

      // Toggle the platform status
      yamlConfig.platforms[platform].enabled = !yamlConfig.platforms[platform].enabled;

      // Write back to file
      const updatedYaml = yaml.stringify(yamlConfig, {
        indent: 2,
        lineWidth: 0
      });
      fs.writeFileSync(configPath, updatedYaml);

      logger.info(`Platform ${platform} toggled to ${yamlConfig.platforms[platform].enabled ? 'enabled' : 'disabled'}`);

      // The file watcher will automatically trigger a config reload
      res.json({
        success: true,
        platform,
        enabled: yamlConfig.platforms[platform].enabled,
        message: `Platform ${platform} ${yamlConfig.platforms[platform].enabled ? 'enabled' : 'disabled'}`
      });
    } catch (error) {
      logger.error('Failed to toggle platform:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to toggle platform',
        error: error.message
      });
    }
  });

  // Simple dashboard
  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Multistream Dashboard</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px;
            background-color: #f0f0f0;
          }
          .container {
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 { color: #333; }
          .info-box {
            background-color: #e8f4f8;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            border-left: 4px solid #0099cc;
          }
          .platform {
            background-color: #f8f8f8;
            padding: 10px;
            margin: 10px 0;
            border-radius: 5px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .platform-info {
            display: flex;
            align-items: center;
            gap: 15px;
          }
          .enabled { color: #28a745; font-weight: bold; }
          .disabled { color: #dc3545; }
          .toggle-switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 24px;
          }
          .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
          }
          .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #ccc;
            transition: .4s;
            border-radius: 24px;
          }
          .toggle-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
          }
          input:checked + .toggle-slider {
            background-color: #28a745;
          }
          input:checked + .toggle-slider:before {
            transform: translateX(26px);
          }
          .toggle-switch.disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .toggle-switch.disabled .toggle-slider {
            cursor: not-allowed;
          }
          code {
            background-color: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
          }
          .video-container {
            background-color: #000;
            border-radius: 5px;
            margin: 20px 0;
            padding: 0;
            overflow: hidden;
            display: none; /* Hidden by default until enabled */
          }
          .video-container.visible {
            display: block;
          }
          #videoPlayer {
            width: 100%;
            max-width: 100%;
            display: block;
          }
          .debug-section {
            margin-top: 30px;
            padding-top: 30px;
            border-top: 2px solid #e0e0e0;
          }
          .stream-status {
            padding: 10px;
            margin: 10px 0;
            border-radius: 5px;
            text-align: center;
            font-weight: bold;
          }
          .stream-active {
            background-color: #d4edda;
            color: #155724;
          }
          .stream-inactive {
            background-color: #f8d7da;
            color: #721c24;
          }
          .reload-section {
            margin: 20px 0;
            padding: 15px;
            background-color: #e8f4f8;
            border-radius: 5px;
          }
          .reload-button {
            background-color: #0099cc;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
          }
          .reload-button:hover {
            background-color: #007aa3;
          }
          .reload-button:disabled {
            background-color: #cccccc;
            cursor: not-allowed;
          }
          .reload-status {
            margin-left: 15px;
            font-weight: bold;
          }
          .reload-success {
            color: #28a745;
          }
          .reload-error {
            color: #dc3545;
          }
          .collapsible {
            cursor: pointer;
            user-select: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .collapsible:hover {
            background-color: #d4f1f9;
          }
          .collapsible::after {
            content: '▼';
            font-size: 12px;
            transition: transform 0.3s ease;
          }
          .collapsible.collapsed::after {
            transform: rotate(-90deg);
          }
          .collapsible-content {
            overflow: hidden;
            transition: max-height 0.3s ease;
          }
          .collapsible-content.collapsed {
            max-height: 0;
          }
          .collapsible-content.expanded {
            max-height: 200px;
          }
          .player-controls {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
            justify-content: space-between;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Multistream Server</h1>
          <div class="info-box">
            <h3 class="collapsible collapsed" onclick="toggleCollapse('obsConfig')">OBS Configuration</h3>
            <div id="obsConfig" class="collapsible-content collapsed">
              <p><strong>Server:</strong> <code>rtmp://localhost:1935/live</code></p>
              <p><strong>Stream Key:</strong> <code>stream</code></p>
            </div>
          </div>
          
          <div class="reload-section">
            <h3>Configuration</h3>
            <p>Configuration file is watched automatically, or you can reload manually:</p>
            <button id="reloadButton" class="reload-button" onclick="reloadConfig()">Reload Config</button>
            <span id="reloadStatus" class="reload-status"></span>
          </div>
          
          <h2>Platform Status</h2>
          <div id="platforms">Loading...</div>
          
          <div class="debug-section">
            <div class="player-controls">
              <h2>Debug Stream Player</h2>
              <label class="toggle-switch">
                <input type="checkbox" id="playerToggle" onchange="togglePlayer(this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div id="playerStatusText" style="margin-bottom: 10px; font-style: italic;">Player is disabled to save resources</div>
            
            <div id="playerContainer" style="display: none;">
              <div id="streamStatus" class="stream-status stream-inactive">Stream Not Active</div>
              <div class="video-container" id="videoWrapper">
                <video id="videoPlayer" controls></video>
              </div>
              <p><small>The debug stream will appear here when browser_debug platform is enabled and a stream is active.</small></p>
            </div>
          </div>
        </div>
        <script>
          // Local storage key
          const PLAYER_PREF_KEY = 'multistream_player_enabled';
          let playerEnabled = localStorage.getItem(PLAYER_PREF_KEY) !== 'false'; // Default true
          
          // Set initial checkbox state
          document.getElementById('playerToggle').checked = playerEnabled;
          updatePlayerVisibility();

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
                
                const hasKey = platform.hasKey || name === 'browser_debug';
                const canToggle = hasKey;
                
                div.innerHTML = \`
                  <div class="platform-info">
                    <span>\${displayName}</span>
                    <span class="\${platform.enabled ? 'enabled' : 'disabled'}">
                      \${platform.enabled ? '✓ Enabled' : '✗ Disabled'}
                      \${!hasKey ? ' (No key configured)' : ''}
                    </span>
                  </div>
                  <label class="toggle-switch \${canToggle ? '' : 'disabled'}">
                    <input type="checkbox" 
                           \${platform.enabled ? 'checked' : ''} 
                           \${canToggle ? '' : 'disabled'}
                           onchange="togglePlatform('\${name}', this)">
                    <span class="toggle-slider"></span>
                  </label>
                \`;
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
            } catch (error) {
              console.error(error);
              document.getElementById('platforms').innerHTML = 'Error loading status';
            }
          }
          
          let flvPlayer = null;
          let flvjsLoaded = false;
          let streamCheckInterval = null;
          
          function setupVideoPlayer() {
            if (!playerEnabled) return;

            if (flvjsLoaded) {
              checkAndPlayStream();
              return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/flv.js@1.6.2/dist/flv.min.js';
            script.onload = () => {
              flvjsLoaded = true;
              checkAndPlayStream();
            };
            document.head.appendChild(script);
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
          
          function initializePlayer() {
            if (flvPlayer || !flvjs.isSupported() || !playerEnabled) return;
            
            const video = document.getElementById('videoPlayer');
            const streamUrl = '/live/stream.flv';
            
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
              const response = await fetch(\`/api/platforms/\${platformName}/toggle\`, {
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
              checkbox.disabled = false;
            }
          }
          
          // Manual config reload function
          async function reloadConfig() {
            const button = document.getElementById('reloadButton');
            const status = document.getElementById('reloadStatus');
            
            button.disabled = true;
            status.textContent = 'Reloading...';
            status.className = 'reload-status';
            
            try {
              const response = await fetch('/api/reload-config', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              
              const result = await response.json();
              
              if (result.success) {
                status.textContent = 'Configuration reloaded successfully!';
                status.className = 'reload-status reload-success';
                // Refresh the platform status
                loadStatus();
              } else {
                status.textContent = \`Failed: \${result.message}\`;
                status.className = 'reload-status reload-error';
              }
            } catch (error) {
              status.textContent = \`Error: \${error.message}\`;
              status.className = 'reload-status reload-error';
            }
            
            button.disabled = false;
            
            // Clear status after 5 seconds
            setTimeout(() => {
              status.textContent = '';
              status.className = 'reload-status';
            }, 5000);
          }
          
          loadStatus();
          setInterval(loadStatus, 5000);
        </script>
      </body>
      </html>
    `);
  });

  return app;
}