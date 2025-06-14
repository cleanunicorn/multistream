import express from 'express';
import logger from '../utils/logger.js';
import { loadConfig, configEvents } from '../config/config.js';
import { createProxyMiddleware } from 'http-proxy-middleware';

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
          .enabled { color: #28a745; font-weight: bold; }
          .disabled { color: #dc3545; }
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
            <h2>Debug Stream Player</h2>
            <div id="streamStatus" class="stream-status stream-inactive">Stream Not Active</div>
            <div class="video-container">
              <video id="videoPlayer" controls></video>
            </div>
            <p><small>The debug stream will appear here when browser_debug platform is enabled and a stream is active.</small></p>
          </div>
        </div>
        <script>
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
                div.innerHTML = \`
                  <span>\${displayName}</span>
                  <span class="\${platform.enabled ? 'enabled' : 'disabled'}">
                    \${platform.enabled ? '✓ Enabled' : '✗ Disabled'}
                    \${platform.hasKey ? '' : ' (No key configured)'}
                  </span>
                \`;
                platformsDiv.appendChild(div);
              });
              
              // Check if browser_debug is enabled
              if (config.platforms.browser_debug && config.platforms.browser_debug.enabled) {
                setupVideoPlayer();
                startStreamCheck();
              }
            } catch (error) {
              document.getElementById('platforms').innerHTML = 'Error loading status';
            }
          }
          
          let flvPlayer = null;
          let flvjsLoaded = false;
          let streamCheckInterval = null;
          
          function setupVideoPlayer() {
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
            if (flvPlayer || !flvjs.isSupported()) return;
            
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