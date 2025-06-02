import ffmpeg from 'fluent-ffmpeg';
import logger from '../utils/logger.js';
import { loadConfig } from '../config/config.js';

export class StreamManager {
  constructor() {
    this.activeStreams = new Map();
    this.config = loadConfig();
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
}