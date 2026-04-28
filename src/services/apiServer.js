import express from 'express';
import { exec } from 'child_process';
import logger from '../utils/logger.js';
import { loadConfig, configEvents, reloadAndNotify } from '../config/config.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { transcribeFile } from '../utils/transcription.js';
import { getSystemStats, getProcessStats } from '../utils/systemStats.js';
import fileUpload from 'express-fileupload';

let streamManager = null;
let srtServer = null;

export function createAPIServer(streamManagerInstance, srtServerInstance = null) {
  const app = express();
  const config = loadConfig();
  streamManager = streamManagerInstance;
  srtServer = srtServerInstance;

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

  // Resource Monitoring Endpoint
  app.get('/api/resources', async (req, res) => {
    try {
      const systemStats = getSystemStats();

      // Get main process stats
      const mainPid = process.pid;

      // Get ffmpeg processes
      const activeProcesses = streamManager ? streamManager.getActiveProcesses() : [];
      const ffmpegPids = activeProcesses.map(p => p.pid);

      const allPids = [mainPid, ...ffmpegPids];
      const processStats = await getProcessStats(allPids);

      res.json({
        system: systemStats,
        processes: {
          main: {
            pid: mainPid,
            stats: processStats[mainPid] || { cpu: 0, memory: 0 }
          },
          streams: activeProcesses.map(proc => ({
            ...proc,
            stats: processStats[proc.pid] || { cpu: 0, memory: 0 }
          }))
        }
      });
    } catch (error) {
      logger.error('Error fetching resource stats:', error);
      res.status(500).json({ error: 'Failed to fetch resource stats' });
    }
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
        streamKey: config.platforms[platform].streamKey || '',
        test_mode: config.platforms[platform].test_mode || false,
        settings: config.platforms[platform].settings || {}
      };
    });

    // Add virtual recording platform
    if (config.recording) {
      safeConfig.platforms.recording = {
        enabled: config.recording.enabled,
        rtmpUrl: 'Local Recording',
        hasKey: true,
        format: config.recording.format || 'mp4',
        settings: {
          path: config.recording.path,
          format: config.recording.format
        }
      };
    } else {
      // Default state if not configured
      safeConfig.platforms.recording = {
        enabled: false,
        rtmpUrl: 'Local Recording',
        hasKey: true,
        settings: {}
      };
    }

    // Add global config
    safeConfig.server = config.server;
    safeConfig.transcription = config.transcription;

    res.json(safeConfig);
  });

  // Get active streams
  app.get('/api/streams', (req, res) => {
    const activeStreams = streamManager ? streamManager.getActiveStreams() : [];
    const srtActive = srtServer ? srtServer.isStreaming : false;
    const srtPlatforms = srtServer ? srtServer.getActivePlatforms() : [];

    // Merge SRT platforms into active streams if SRT is active
    if (srtActive && srtPlatforms.length > 0) {
      // Find if there's already an 'srt' entry or just add it
      activeStreams.push({
        key: 'SRT Input',
        platforms: srtPlatforms
      });
    }

    res.json({
      streams: activeStreams,
      isActive: activeStreams.length > 0 || srtActive,
      srtActive,
      srtPlatforms
    });
  });

  // Trigger manual config reload
  app.post('/api/reload-config', (req, res) => {
    try {
      const reloaded = reloadAndNotify();
      logger.info('Manual configuration reload triggered');
      res.json({
        success: true,
        message: reloaded ? 'Configuration reloaded successfully' : 'Configuration was already up to date',
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

      reloadAndNotify();
      logger.info(`Recording format updated to ${format}`);

      res.json({ success: true, format });
    } catch (error) {
      logger.error('Failed to update recording config:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  // Enable file upload
  app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50GB limit
    abortOnLimit: true,
    createParentPath: true,
    useTempFiles: true,
    tempFileDir: path.join(process.cwd(), 'tmp')
  }));

  app.post('/api/recordings/upload', async (req, res) => {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    let videoFiles = req.files.video;

    // If it's a single file, make it an array for consistent processing
    if (!Array.isArray(videoFiles)) {
      videoFiles = [videoFiles];
    }

    const currentConfig = loadConfig();
    const recPath = currentConfig.recording && currentConfig.recording.path ?
      path.resolve(process.cwd(), currentConfig.recording.path) :
      path.join(process.cwd(), 'recordings');

    // Create directory if not exists
    if (!fs.existsSync(recPath)) {
      fs.mkdirSync(recPath, { recursive: true });
    }

    const uploadedFiles = [];
    const errors = [];

    for (const videoFile of videoFiles) {
      // Check if it's a video
      if (!videoFile.mimetype.startsWith('video/')) {
        errors.push({ name: videoFile.name, error: 'Only video files are allowed!' });
        continue;
      }

      // Determine filename
      const safeName = videoFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const uploadPath = path.join(recPath, safeName);

      try {
        await videoFile.mv(uploadPath);
        logger.info(`File uploaded: ${safeName}`);
        uploadedFiles.push(safeName);
      } catch (err) {
        logger.error(`File upload error for ${videoFile.name}:`, err);
        errors.push({ name: videoFile.name, error: err.message });
      }
    }

    if (uploadedFiles.length === 0 && errors.length > 0) {
      return res.status(500).json({ error: 'All uploads failed', details: errors });
    }

    res.json({
      success: true,
      message: `${uploadedFiles.length} file(s) uploaded successfully.`,
      filenames: uploadedFiles,
      errors: errors.length > 0 ? errors : undefined
    });
  });

  // Update platform configuration
  app.put('/api/platforms/:platform', async (req, res) => {
    try {
      const { platform } = req.params;
      const { rtmpUrl, streamKey, settings } = req.body;

      const configPath = path.join(process.cwd(), 'config.yaml');
      const configContent = fs.readFileSync(configPath, 'utf8');
      const yamlConfig = yaml.parse(configContent);

      if (platform === 'recording') {
        if (!yamlConfig.recording) yamlConfig.recording = {};
        if (settings?.path !== undefined) yamlConfig.recording.path = settings.path;
        if (settings?.format !== undefined) yamlConfig.recording.format = settings.format;
      } else {
        const config = loadConfig();
        if (!config.platforms[platform]) {
          return res.status(404).json({ error: `Platform ${platform} not found` });
        }
        if (!yamlConfig.platforms) yamlConfig.platforms = {};
        if (!yamlConfig.platforms[platform]) yamlConfig.platforms[platform] = {};
        if (rtmpUrl !== undefined) yamlConfig.platforms[platform].rtmpUrl = rtmpUrl;
        if (streamKey !== undefined) yamlConfig.platforms[platform].streamKey = streamKey;
        if (settings !== undefined) {
          if (!yamlConfig.platforms[platform].settings) yamlConfig.platforms[platform].settings = {};
          const coerced = {};
          for (const [k, v] of Object.entries(settings)) {
            if (v === 'true') coerced[k] = true;
            else if (v === 'false') coerced[k] = false;
            else if (v !== '' && !isNaN(Number(v)) && !isNaN(parseFloat(v))) coerced[k] = Number(v);
            else coerced[k] = v;
          }
          Object.assign(yamlConfig.platforms[platform].settings, coerced);
        }
      }

      const updatedYaml = yaml.stringify(yamlConfig, { indent: 2, lineWidth: 0 });
      fs.writeFileSync(configPath, updatedYaml);

      reloadAndNotify();
      logger.info(`Platform ${platform} configuration updated`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to update platform config:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  // Bulk update configuration
  app.put('/api/config/bulk', async (req, res) => {
    try {
      const { platforms, server, transcription } = req.body;

      const configPath = path.join(process.cwd(), 'config.yaml');
      const configContent = fs.readFileSync(configPath, 'utf8');
      const yamlConfig = yaml.parse(configContent);

      // Helper to coerce values
      const coerce = (val) => {
        if (val === 'true' || val === true) return true;
        if (val === 'false' || val === false) return false;
        if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) return Number(val);
        return val;
      };

      // Update platforms
      if (platforms) {
        for (const [name, data] of Object.entries(platforms)) {
          if (name === 'recording') {
            if (!yamlConfig.recording) yamlConfig.recording = {};
            if (data.settings?.path !== undefined) yamlConfig.recording.path = data.settings.path;
            if (data.settings?.format !== undefined) yamlConfig.recording.format = data.settings.format;
            if (data.enabled !== undefined) yamlConfig.recording.enabled = data.enabled;
          } else {
            if (!yamlConfig.platforms) yamlConfig.platforms = {};
            if (!yamlConfig.platforms[name]) yamlConfig.platforms[name] = {};

            if (data.rtmpUrl !== undefined) yamlConfig.platforms[name].rtmpUrl = data.rtmpUrl;
            if (data.streamKey !== undefined) yamlConfig.platforms[name].streamKey = data.streamKey;
            if (data.enabled !== undefined) yamlConfig.platforms[name].enabled = data.enabled;
            if (data.test_mode !== undefined) yamlConfig.platforms[name].test_mode = data.test_mode;

            if (data.settings !== undefined) {
              if (!yamlConfig.platforms[name].settings) yamlConfig.platforms[name].settings = {};
              const coerced = {};
              for (const [k, v] of Object.entries(data.settings)) {
                coerced[k] = coerce(v);
              }
              Object.assign(yamlConfig.platforms[name].settings, coerced);
            }
          }
        }
      }

      // Update server
      if (server) {
        if (!yamlConfig.server) yamlConfig.server = {};
        for (const [k, v] of Object.entries(server)) {
          yamlConfig.server[k] = coerce(v);
        }
      }

      // Update transcription
      if (transcription) {
        if (!yamlConfig.transcription) yamlConfig.transcription = {};
        for (const [k, v] of Object.entries(transcription)) {
          yamlConfig.transcription[k] = coerce(v);
        }
      }

      const updatedYaml = yaml.stringify(yamlConfig, { indent: 2, lineWidth: 0 });
      fs.writeFileSync(configPath, updatedYaml);

      reloadAndNotify();
      logger.info('Bulk configuration update successful');
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to update bulk config:', error);
      res.status(500).json({ error: 'Failed to update configuration', details: error.message });
    }
  });

  // Update global configuration (server, transcription)
  app.put('/api/config/global', async (req, res) => {
    try {
      const { server, transcription } = req.body;

      const configPath = path.join(process.cwd(), 'config.yaml');
      const configContent = fs.readFileSync(configPath, 'utf8');
      const yamlConfig = yaml.parse(configContent);

      if (server) {
        if (!yamlConfig.server) yamlConfig.server = {};
        Object.assign(yamlConfig.server, server);
      }
      if (transcription) {
        if (!yamlConfig.transcription) yamlConfig.transcription = {};
        Object.assign(yamlConfig.transcription, transcription);
      }

      const updatedYaml = yaml.stringify(yamlConfig, { indent: 2, lineWidth: 0 });
      fs.writeFileSync(configPath, updatedYaml);

      reloadAndNotify();
      logger.info('Global configuration updated');
      res.json({ success: true });
    } catch (error) {
      logger.error('Failed to update global config:', error);
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

        reloadAndNotify();
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

      reloadAndNotify();
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

      reloadAndNotify();
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
  // Note: static middleware is set up once at startup.
  // If recording path changes, a full server restart or a dynamic static middleware would be needed.
  // For now, we use the path from startup config for the static mount.
  const startupConfig = loadConfig();
  const recordingPath = startupConfig.recording && startupConfig.recording.path ?
    path.resolve(process.cwd(), startupConfig.recording.path) :
    path.join(process.cwd(), 'recordings');

  if (!fs.existsSync(recordingPath)) {
    fs.mkdirSync(recordingPath, { recursive: true });
  }

  app.use('/recordings-files', express.static(recordingPath));

  // Get list of recordings
  app.get('/api/recordings', (req, res) => {
    try {
      const currentConfig = loadConfig();
      const recPath = currentConfig.recording && currentConfig.recording.path ?
        path.resolve(process.cwd(), currentConfig.recording.path) :
        path.join(process.cwd(), 'recordings');

      if (!fs.existsSync(recPath)) {
        return res.json({ files: [] });
      }

      const files = fs.readdirSync(recPath)
        .filter(file => {
          if (file.startsWith('.')) return false;

          // Filter for video extensions only
          const videoExtensions = ['.mp4', '.mkv', '.flv', '.mov', '.webm', '.ts', '.avi'];
          const ext = path.extname(file).toLowerCase();

          if (!videoExtensions.includes(ext)) return false;

          const stats = fs.statSync(path.join(recPath, file));
          return stats.isFile();
        })
        .map(file => {
          const stats = fs.statSync(path.join(recPath, file));
          const txtFilename = file.substring(0, file.lastIndexOf('.')) + '.txt';
          const hasTranscription = fs.existsSync(path.join(recPath, txtFilename));
          const isProcessing = fs.existsSync(path.join(recPath, txtFilename + '.tmp'));

          return {
            name: file,
            size: stats.size,
            created: stats.birthtime,
            url: `/recordings-files/${file}`,
            hasTranscription,
            isProcessing
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

      const currentConfig = loadConfig();
      const recPath = currentConfig.recording && currentConfig.recording.path ?
        path.resolve(process.cwd(), currentConfig.recording.path) :
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

    const currentConfig = loadConfig();
    const recPath = currentConfig.recording && currentConfig.recording.path ?
      path.resolve(process.cwd(), currentConfig.recording.path) :
      path.join(process.cwd(), 'recordings');

    const filePath = path.join(recPath, filename);
    const txtOutput = filePath.substring(0, filePath.lastIndexOf('.')) + '.txt';
    const tmpOutput = txtOutput + '.tmp';

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Use shared transcription utility
    transcribeFile(filePath, (error) => {
      if (error) {
        // Logging is already handled in transcribeFile
      } else {
        // Success logging already handled
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

    const currentConfig = loadConfig();
    const recPath = currentConfig.recording && currentConfig.recording.path ?
      path.resolve(process.cwd(), currentConfig.recording.path) :
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

    const currentConfig = loadConfig();
    const recPath = currentConfig.recording && currentConfig.recording.path ?
      path.resolve(process.cwd(), currentConfig.recording.path) :
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
    // Re-encoding to ensure frame accuracy and sync
    const ffmpegCommand = `ffmpeg -ss ${startTime} -i "${videoPath}" -t ${duration} -c:v libx264 -c:a aac -preset fast -y "${outputPath}"`;

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
  app.use(express.static(path.join(__dirname, '../../public'), { extensions: ['html'] }));

  return app;
}