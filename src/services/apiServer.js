import express from 'express';
import { exec } from 'child_process';
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
        hasKey: !!config.platforms[platform].streamKey,
        test_mode: config.platforms[platform].test_mode || false
      };
    });

    // Add virtual recording platform
    if (config.recording) {
      safeConfig.platforms.recording = {
        enabled: config.recording.enabled,
        rtmpUrl: 'Local Recording',
        hasKey: true,
        format: config.recording.format || 'mp4'
      };
    } else {
      // Default state if not configured
      safeConfig.platforms.recording = {
        enabled: false,
        rtmpUrl: 'Local Recording',
        hasKey: true
      };
    }

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

  // Update recording configuration
  app.post('/api/recording/config', (req, res) => {
    try {
      const { format } = req.body;
      const validFormats = ['mp4', 'mkv', 'flv'];

      if (!validFormats.includes(format)) {
        return res.status(400).json({ error: 'Invalid format' });
      }

      const configPath = path.join(process.cwd(), 'config.yaml');
      const configContent = fs.readFileSync(configPath, 'utf8');
      const yamlConfig = yaml.parse(configContent);

      if (!yamlConfig.recording) {
        yamlConfig.recording = { enabled: true, path: './recordings' };
      }

      yamlConfig.recording.format = format;

      // Write back
      const updatedYaml = yaml.stringify(yamlConfig, {
        indent: 2,
        lineWidth: 0
      });
      fs.writeFileSync(configPath, updatedYaml);

      logger.info(`Recording format updated to ${format}`);

      res.json({ success: true, format });
    } catch (error) {
      logger.error('Failed to update recording config:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  // Toggle platform enabled/disabled status
  app.post('/api/platforms/:platform/toggle', async (req, res) => {
    try {
      const { platform } = req.params;
      const config = loadConfig();

      // Special handling for virtual recording platform
      if (platform === 'recording') {
        const config = loadConfig();
        const configPath = path.join(process.cwd(), 'config.yaml');
        const configContent = fs.readFileSync(configPath, 'utf8');
        const yamlConfig = yaml.parse(configContent);

        // Initialize recording config if missing
        if (!yamlConfig.recording) {
          yamlConfig.recording = {
            enabled: true, // Default to true so the toggle disables it
            path: './recordings',
            format: 'mp4'
          };
        }

        // Toggle
        yamlConfig.recording.enabled = !yamlConfig.recording.enabled;

        // Write back
        const updatedYaml = yaml.stringify(yamlConfig, {
          indent: 2,
          lineWidth: 0
        });
        fs.writeFileSync(configPath, updatedYaml);

        const isEnabled = yamlConfig.recording.enabled;
        logger.info(`Recording toggled to ${isEnabled ? 'enabled' : 'disabled'}`);

        return res.json({
          success: true,
          platform,
          enabled: isEnabled,
          message: `Recording ${isEnabled ? 'enabled' : 'disabled'}`
        });
      }

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

  // Toggle platform test mode
  app.post('/api/platforms/:platform/test-mode', async (req, res) => {
    try {
      const { platform } = req.params;
      const config = loadConfig();

      // Only supported for Twitch currently
      if (platform !== 'twitch') {
        return res.status(400).json({
          success: false,
          message: 'Test mode only supported for Twitch'
        });
      }

      // Read current config file
      const configPath = path.join(process.cwd(), 'config.yaml');
      const configContent = fs.readFileSync(configPath, 'utf8');
      const yamlConfig = yaml.parse(configContent);

      // Initialize if missing
      if (!yamlConfig.platforms[platform]) {
        return res.status(404).json({
          success: false,
          message: `Platform ${platform} not found`
        });
      }

      // Toggle test_mode
      const currentMode = yamlConfig.platforms[platform].test_mode || false;
      yamlConfig.platforms[platform].test_mode = !currentMode;

      // Write back to file
      const updatedYaml = yaml.stringify(yamlConfig, {
        indent: 2,
        lineWidth: 0
      });
      fs.writeFileSync(configPath, updatedYaml);

      logger.info(`Platform ${platform} test mode toggled to ${yamlConfig.platforms[platform].test_mode}`);

      res.json({
        success: true,
        platform,
        test_mode: yamlConfig.platforms[platform].test_mode,
        message: `Twitch Test Mode ${yamlConfig.platforms[platform].test_mode ? 'enabled' : 'disabled'}`
      });
    } catch (error) {
      logger.error('Failed to toggle test mode:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to toggle test mode',
        error: error.message
      });
    }
  });

  // Serve recordings static files
  const recordingPath = config.recording && config.recording.path ?
    path.resolve(process.cwd(), config.recording.path) :
    path.join(process.cwd(), 'recordings');

  if (!fs.existsSync(recordingPath)) {
    fs.mkdirSync(recordingPath, { recursive: true });
  }

  app.use('/recordings-files', express.static(recordingPath));

  // Get list of recordings
  app.get('/api/recordings', (req, res) => {
    try {
      const recPath = config.recording && config.recording.path ?
        path.resolve(process.cwd(), config.recording.path) :
        path.join(process.cwd(), 'recordings');

      if (!fs.existsSync(recPath)) {
        return res.json({ files: [] });
      }

      const files = fs.readdirSync(recPath)
        .filter(file => {
          if (file.startsWith('.')) return false;
          if (file.endsWith('.txt')) return false;
          const stats = fs.statSync(path.join(recPath, file));
          return stats.isFile(); // Only list files, not directories like 'clips'
        })
        .map(file => {
          const stats = fs.statSync(path.join(recPath, file));
          const txtFilename = file.substring(0, file.lastIndexOf('.')) + '.txt';
          const hasTranscription = fs.existsSync(path.join(recPath, txtFilename));

          return {
            name: file,
            size: stats.size,
            created: stats.birthtime,
            url: `/recordings-files/${file}`,
            hasTranscription
          };
        })
        .sort((a, b) => b.created - a.created); // Newest first

      res.json({ files });
    } catch (error) {
      logger.error('Error listing recordings:', error);
      res.status(500).json({ error: 'Failed to list recordings' });
    }
  });

  // Delete recording
  app.delete('/api/recordings/:filename', (req, res) => {
    try {
      const { filename } = req.params;

      // Basic security check to prevent directory traversal
      if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      const recPath = config.recording && config.recording.path ?
        path.resolve(process.cwd(), config.recording.path) :
        path.join(process.cwd(), 'recordings');

      const filePath = path.join(recPath, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      fs.unlinkSync(filePath);
      logger.info(`Deleted recording: ${filename}`);

      // Also delete transcription if exists
      const txtFilename = filename.substring(0, filename.lastIndexOf('.')) + '.txt';
      const txtPath = path.join(recPath, txtFilename);
      if (fs.existsSync(txtPath)) {
        fs.unlinkSync(txtPath);
        logger.info(`Deleted transcription: ${txtFilename}`);
      }

      res.json({ success: true, message: 'File deleted' });
    } catch (error) {
      logger.error('Error deleting recording:', error);
      res.status(500).json({ error: 'Failed to delete recording' });
    }
  });

  // Manual transcription
  app.post('/api/recordings/:filename/transcribe', (req, res) => {
    const { filename } = req.params;

    // Basic security check
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const recPath = config.recording && config.recording.path ?
      path.resolve(process.cwd(), config.recording.path) :
      path.join(process.cwd(), 'recordings');

    const filePath = path.join(recPath, filename);
    const txtOutput = filePath.substring(0, filePath.lastIndexOf('.')) + '.txt';

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const quillCommand = `quill -t ${filePath} ${txtOutput}`;
    logger.info(`Starting manual transcription: ${quillCommand}`);

    exec(quillCommand, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Transcription error for ${filename}:`, error);
        // We don't wait for completion to respond, so we can't easily report error to client here
        // But for this simplified version, we'll respond immediately saying it started
      } else {
        logger.info(`Manual transcription completed for ${filename}`);
      }
    });

    res.json({ success: true, message: 'Transcription started' });
  });

  // Get transcription content
  app.get('/api/recordings/:filename/transcription', (req, res) => {
    const { filename } = req.params;

    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const recPath = config.recording && config.recording.path ?
      path.resolve(process.cwd(), config.recording.path) :
      path.join(process.cwd(), 'recordings');

    // Filename here is the video filename, so we need to change extension
    const txtFilename = filename.substring(0, filename.lastIndexOf('.')) + '.txt';
    const filePath = path.join(recPath, txtFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Transcription not found' });
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Parse highlights
      const lines = content.split('\n');
      const highlights = [];
      const regex = /^\[(\d{2}:\d{2}:\d{2}) -> \d{2}:\d{2}:\d{2}\] (.*)$/;

      lines.forEach(line => {
        const match = line.match(regex);
        if (match) {
          const timestamp = match[1];
          const text = match[2];

          if (text.toLowerCase().includes('clip that')) {
            highlights.push({ timestamp, text });
          }
        }
      });

      res.json({ success: true, content, highlights });
    } catch (error) {
      logger.error('Error reading transcription:', error);
      res.status(500).json({ error: 'Failed to read transcription' });
    }
  });

  // Generate clip
  app.post('/api/recordings/:filename/clip', async (req, res) => {
    const { filename } = req.params;
    const { timestamp } = req.body;

    if (!timestamp || !/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const recPath = config.recording && config.recording.path ?
      path.resolve(process.cwd(), config.recording.path) :
      path.join(process.cwd(), 'recordings');

    const clipsPath = path.join(recPath, 'clips');
    if (!fs.existsSync(clipsPath)) {
      fs.mkdirSync(clipsPath, { recursive: true });
    }

    const videoPath = path.join(recPath, filename);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Convert timestamp to seconds
    const parts = timestamp.split(':').map(Number);
    const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];

    // Calculate start time (2 minutes before)
    const startTime = Math.max(0, seconds - 120);
    // Duration: 4 minutes (2 mins before + 2 mins after)
    const duration = 240;

    const clipFilename = `${filename.replace(/\.[^/.]+$/, "")}_clip_${timestamp.replace(/:/g, '-')}.mp4`;
    const outputPath = path.join(clipsPath, clipFilename);

    // Using ffmpeg to extract clip
    // -ss placed before -i for faster seeking
    const ffmpegCommand = `ffmpeg -ss ${startTime} -i "${videoPath}" -t ${duration} -c copy -y "${outputPath}"`;

    logger.info(`Generating clip: ${ffmpegCommand}`);

    exec(ffmpegCommand, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Error generating clip:`, error);
        return res.status(500).json({ error: 'Failed to generate clip' });
      }

      logger.info(`Clip generated: ${outputPath}`);
      // Assuming recordings-files serves the recordings directory
      // We serve clips from a subdirectory
      res.json({
        success: true,
        message: 'Clip generated',
        url: `/recordings-files/clips/${clipFilename}`
      });
    });
  });




  // Serve static files from 'public' directory
  app.use(express.static('public', { extensions: ['html'] }));

  return app;
}