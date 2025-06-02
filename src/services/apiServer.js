import express from 'express';
import logger from '../utils/logger.js';
import { loadConfig } from '../config/config.js';

export function createAPIServer() {
  const app = express();
  app.use(express.json());
  
  // Enable CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });
  
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
    // This will be implemented when we have access to streamManager
    res.json({ streams: [] });
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
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Multistream Server</h1>
          <div class="info-box">
            <h3>OBS Configuration</h3>
            <p><strong>Server:</strong> <code>rtmp://localhost:1935/live</code></p>
            <p><strong>Stream Key:</strong> <code>stream</code></p>
          </div>
          <h2>Platform Status</h2>
          <div id="platforms">Loading...</div>
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
                div.innerHTML = \`
                  <span>\${name.charAt(0).toUpperCase() + name.slice(1)}</span>
                  <span class="\${platform.enabled ? 'enabled' : 'disabled'}">
                    \${platform.enabled ? '✓ Enabled' : '✗ Disabled'}
                    \${platform.hasKey ? '' : ' (No key configured)'}
                  </span>
                \`;
                platformsDiv.appendChild(div);
              });
            } catch (error) {
              document.getElementById('platforms').innerHTML = 'Error loading status';
            }
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