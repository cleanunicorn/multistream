import ffmpeg from 'fluent-ffmpeg';
import logger from '../utils/logger.js';
import { loadConfig, configEvents } from '../config/config.js';
import fs from 'fs';
import path from 'path';

export class StreamManager {
  constructor() {
    this.activeStreams = new Map();
    this.config = loadConfig();
    
    // Listen for config changes
    configEvents.on('configReloaded', (newConfig) => {
      this.handleConfigReload(newConfig);
    });
  }

  startStream(streamPath, args) {
    const streamKey = this.extractStreamKey(streamPath);
    
    if (this.activeStreams.has(streamKey)) {
      logger.warn(`Stream ${streamKey} already active`);
      return;
    }

    const inputUrl = `rtmp://localhost:1935${streamPath}`;
    const ffmpegCommands = [];

    // Create ffmpeg commands for each platform
    const platforms = this.getEnabledPlatforms();
    
    platforms.forEach(platform => {
      const command = this.createFFmpegCommand(inputUrl, platform);
      if (command) {
        ffmpegCommands.push({ platform, command });
      }
    });

    // Add recording if enabled
    if (this.config.recording.enabled) {
      const recordingCommand = this.createRecordingCommand(inputUrl, streamKey);
      if (recordingCommand) {
        ffmpegCommands.push({ platform: 'recording', command: recordingCommand });
      }
    }

    this.activeStreams.set(streamKey, ffmpegCommands);
    logger.info(`Started restreaming to ${ffmpegCommands.length} platforms`);
  }

  stopStream(streamPath) {
    const streamKey = this.extractStreamKey(streamPath);
    const commands = this.activeStreams.get(streamKey);
    
    if (!commands) {
      return;
    }

    commands.forEach(({ platform, command }) => {
      try {
        command.kill('SIGINT');
        logger.info(`Stopped ${platform} stream`);
      } catch (error) {
        logger.error(`Error stopping ${platform} stream:`, error);
      }
    });

    this.activeStreams.delete(streamKey);
  }

  createFFmpegCommand(inputUrl, platform) {
    const platformConfig = this.config.platforms[platform];
    
    if (!platformConfig || !platformConfig.enabled || !platformConfig.streamKey) {
      return null;
    }

    // Special handling for browser_debug platform
    if (platform === 'browser_debug') {
      return this.createBrowserDebugCommand(inputUrl);
    }

    const outputUrl = `${platformConfig.rtmpUrl}/${platformConfig.streamKey}`;
    
    const command = ffmpeg(inputUrl)
      .inputOptions([
        '-re'
      ])
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize'
      ])
      .output(outputUrl)
      .on('start', (cmd) => {
        logger.info(`FFmpeg started for ${platform}:`, cmd);
      })
      .on('error', (err) => {
        logger.error(`FFmpeg error for ${platform}:`, err);
      })
      .on('end', () => {
        logger.info(`FFmpeg ended for ${platform}`);
      });

    command.run();
    return command;
  }

  getEnabledPlatforms() {
    return Object.keys(this.config.platforms).filter(
      platform => this.config.platforms[platform].enabled
    );
  }

  extractStreamKey(streamPath) {
    const parts = streamPath.split('/');
    return parts[parts.length - 1] || 'stream';
  }

  getActiveStreams() {
    const streams = [];
    this.activeStreams.forEach((commands, key) => {
      streams.push({
        key,
        platforms: commands.map(c => c.platform)
      });
    });
    return streams;
  }

  createRecordingCommand(inputUrl, streamKey) {
    // Create recordings directory if it doesn't exist
    const recordingPath = path.resolve(this.config.recording.path);
    if (!fs.existsSync(recordingPath)) {
      fs.mkdirSync(recordingPath, { recursive: true });
      logger.info(`Created recording directory: ${recordingPath}`);
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${streamKey}_${timestamp}.${this.config.recording.format}`;
    const outputPath = path.join(recordingPath, filename);

    const command = ffmpeg(inputUrl)
      .inputOptions([
        '-re'
      ])
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-movflags', '+faststart'
      ])
      .output(outputPath)
      .on('start', (cmd) => {
        logger.info(`Recording started: ${outputPath}`);
        logger.debug(`Recording FFmpeg command:`, cmd);
      })
      .on('error', (err) => {
        logger.error(`Recording error:`, err);
      })
      .on('end', () => {
        logger.info(`Recording completed: ${outputPath}`);
      });

    command.run();
    return command;
  }

  createBrowserDebugCommand(inputUrl) {
    const outputUrl = `http://localhost:${this.config.server.httpStreamingPort}/live/stream.flv`;
    
    const command = ffmpeg(inputUrl)
      .inputOptions([
        '-re'
      ])
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize'
      ])
      .output(outputUrl)
      .on('start', (cmd) => {
        logger.info(`Browser debug stream started`);
        logger.debug(`Browser debug FFmpeg command:`, cmd);
      })
      .on('error', (err) => {
        logger.error(`Browser debug stream error:`, err);
      })
      .on('end', () => {
        logger.info(`Browser debug stream ended`);
      });

    command.run();
    return command;
  }

  handleConfigReload(newConfig) {
    logger.info('Handling configuration reload in StreamManager');
    
    const oldConfig = this.config;
    this.config = newConfig;
    
    // Check each active stream
    this.activeStreams.forEach((commands, streamKey) => {
      const streamPath = `/live/${streamKey}`;
      
      // Find platforms that changed state
      const platformsToStop = [];
      const platformsToStart = [];
      
      Object.keys(newConfig.platforms).forEach(platform => {
        const wasEnabled = oldConfig.platforms[platform]?.enabled && oldConfig.platforms[platform]?.streamKey;
        const isEnabled = newConfig.platforms[platform]?.enabled && newConfig.platforms[platform]?.streamKey;
        
        if (wasEnabled && !isEnabled) {
          // Platform was disabled
          platformsToStop.push(platform);
        } else if (!wasEnabled && isEnabled) {
          // Platform was enabled
          platformsToStart.push(platform);
        } else if (wasEnabled && isEnabled) {
          // Check if settings changed
          const oldSettings = JSON.stringify(oldConfig.platforms[platform]);
          const newSettings = JSON.stringify(newConfig.platforms[platform]);
          
          if (oldSettings !== newSettings) {
            platformsToStop.push(platform);
            platformsToStart.push(platform);
          }
        }
      });
      
      // Stop changed platforms
      const remainingCommands = commands.filter(({ platform, command }) => {
        if (platformsToStop.includes(platform)) {
          try {
            command.kill('SIGINT');
            logger.info(`Stopped ${platform} stream due to config change`);
          } catch (error) {
            logger.error(`Error stopping ${platform} stream:`, error);
          }
          return false;
        }
        return true;
      });
      
      // Start new platforms
      const inputUrl = `rtmp://localhost:1935${streamPath}`;
      platformsToStart.forEach(platform => {
        const command = this.createFFmpegCommand(inputUrl, platform);
        if (command) {
          remainingCommands.push({ platform, command });
          logger.info(`Started ${platform} stream due to config change`);
        }
      });
      
      // Update the active streams map
      this.activeStreams.set(streamKey, remainingCommands);
      
      logger.info(`Configuration reload complete. Active platforms: ${remainingCommands.map(c => c.platform).join(', ')}`);
    });
  }
}