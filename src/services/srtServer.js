import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { loadConfig, configEvents } from '../config/config.js';
import { transcribeFile } from '../utils/transcription.js';

/**
 * SRT input server with per-platform audio track routing.
 *
 * OBS sends multiple audio tracks over SRT. Three routing modes are supported
 * per platform (configured in settings):
 *
 *   Default (no special setting)
 *     → Track 1 (0:a:0): full mix including music. Used for live platforms
 *       that don't have special VOD requirements (Kick, TikTok, …).
 *
 *   vodOnly: true
 *     → Track 2 (0:a:1): clean mix, no music. Platform only receives the
 *       VOD-safe audio (YouTube, etc.).
 *
 *   twitchVodTrack: <N>   (integer, 1-based track number sent to Twitch)
 *     → Both tracks are forwarded. The AMF0 metadata key `twitch_vod_track_id`
 *       is injected so Twitch saves the clean track for its VOD archive while
 *       viewers hear the full mix live.
 *       Example: twitchVodTrack: 2  →  -map 0:a:0 -map 0:a:1
 *                                      -metadata:s:a:1 twitch_vod_track_id=2
 *
 * Local recording always uses Track 2 (clean mix) so saved files are VOD-safe.
 * browser_debug always uses Track 1 (full mix) for live monitoring.
 *
 * Because SRT listener mode accepts exactly one incoming connection at a time,
 * all destinations are handled as outputs of a single FFmpeg process.  After
 * each session the listener restarts automatically.
 */
export class SRTServer {
  constructor() {
    this.config = loadConfig();
    this.activeCommand = null;
    this.isRunning = false;
    this.isStreaming = false;
    this.restartTimer = null;

    configEvents.on('configReloaded', (newConfig) => {
      const oldSig = this._getConfigSignature(this.config);
      const newSig = this._getConfigSignature(newConfig);
      const oldEnabled = this.config.server?.srtEnabled;
      const newEnabled = newConfig.server?.srtEnabled;

      this.config = newConfig;

      // Handle enable/disable
      if (!oldEnabled && newEnabled) {
        logger.info('SRT: Server enabled via configuration');
        this.start();
        return;
      } else if (oldEnabled && !newEnabled) {
        logger.info('SRT: Server disabled via configuration');
        this.stop();
        return;
      }

      if (!this.isRunning) return;

      if (oldSig === newSig) {
        logger.debug('SRT: Configuration changed but SRT outputs are unaffected. Skipping restart.');
        return;
      }

      logger.info('SRT: Configuration changed affecting SRT outputs, restarting...');

      // Restart the FFmpeg process so the new config takes effect immediately.
      // If OBS is actively streaming it will briefly disconnect and auto-reconnect.
      // We only kill here — the error handler's _scheduleRestart() handles the
      // actual restart after a short delay so the OS can release the UDP port.
      if (this.activeCommand) {
        try { this.activeCommand.kill('SIGINT'); } catch (_) {}
        // Don't null activeCommand here; the error handler will do it and schedule restart.
      } else if (this.restartTimer) {
        // Idle with a pending restart — cancel it and re-trigger with fresh config.
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
        this.listen();
      } else {
        // No active command and no pending restart — start fresh.
        this.listen();
      }
    });
  }

  start() {
    this.isRunning = true;
    this.listen();
  }

  stop() {
    this.isRunning = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.activeCommand) {
      try { this.activeCommand.kill('SIGINT'); } catch (_) {}
      this.activeCommand = null;
    }
  }

  // ─── private ──────────────────────────────────────────────────────────────

  listen() {
    if (!this.isRunning) return;

    const srtUrl = `srt://0.0.0.0:${this.config.server.srtPort}?mode=listener`;
    const { command, recordingOutputPath } = this._buildCommand(srtUrl);

    if (!command) {
      logger.warn('SRT: no outputs configured – listener not started');
      return;
    }

    this.activeCommand = command;

    command
      .on('start', (cmdLine) => {
        logger.info(`SRT: listening on port ${this.config.server.srtPort} (UDP) – waiting for OBS`);
        logger.debug('SRT FFmpeg command:', cmdLine);
      })
      .on('codecData', () => {
        this.isStreaming = true;
        logger.info('SRT: OBS connected – stream is live');
      })
      .on('error', (err) => {
        const msg = err.message || '';
        const isStop = msg.includes('SIGINT') || msg.includes('code 255') || msg === '';
        if (isStop) {
          logger.info('SRT: stream stopped');
        } else {
          logger.error('SRT: FFmpeg error:', msg);
        }
        if (recordingOutputPath) transcribeFile(recordingOutputPath);
        this.isStreaming = false;
        this.activeCommand = null;
        this._scheduleRestart();
      })
      .on('end', () => {
        logger.info('SRT: stream ended – OBS disconnected');
        if (recordingOutputPath) transcribeFile(recordingOutputPath);
        this.isStreaming = false;
        this.activeCommand = null;
        this._scheduleRestart();
      });

    command.run();
  }

  _scheduleRestart() {
    if (!this.isRunning) return;
    // Brief pause to allow the OS to release the UDP port binding.
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.listen();
    }, 2000);
  }

  /**
   * Build one FFmpeg command with all enabled platform outputs.
   * Returns { command, recordingOutputPath }.
   */
  _buildCommand(srtUrl) {
    const cmd = ffmpeg(srtUrl);
    let hasOutputs = false;
    let recordingOutputPath = null;

    const platforms = Object.keys(this.config.platforms).filter(
      (p) => this.config.platforms[p].enabled && this.config.platforms[p].streamKey
    );

    for (const platform of platforms) {
      const platformConfig = this.config.platforms[platform];

      // ── browser_debug ────────────────────────────────────────────────────
      if (platform === 'browser_debug') {
        const outputUrl = `rtmp://localhost:${this.config.server.rtmpPort}/live/${platformConfig.streamKey}`;
        cmd
          .output(outputUrl)
          .outputOptions([
            '-map', '0:v:0',
            '-map', '0:a:0',    // full mix for live monitoring
            '-c:v', 'copy',
            '-c:a', 'copy',
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
          ]);
        hasOutputs = true;
        continue;
      }

      let outputUrl = `${platformConfig.rtmpUrl}/${platformConfig.streamKey}`;
      if (platform === 'twitch' && platformConfig.test_mode) {
        outputUrl += '?bandwidthtest=true';
        logger.info('SRT: Twitch test mode – appending ?bandwidthtest=true');
      }
      const s = platformConfig.settings || {};

      // ── Twitch dual-track mode ────────────────────────────────────────────
      if (s.twitchVodTrack) {
        const vodTrackId = Number(s.twitchVodTrack);          // 1-based, e.g. 2
        const vodStreamIdx = vodTrackId - 1;                  // 0-based FFmpeg index
        const metaStreamIdx = vodStreamIdx;                   // s:a:<N> in output

        const outputOptions = [
          '-map', '0:v:0',
          '-map', '0:a:0',                                    // Track 1: full mix (live)
          '-map', `0:a:${vodStreamIdx}`,                      // Track N: clean mix (VOD)
          '-metadata:s:a:' + metaStreamIdx, `twitch_vod_track_id=${vodTrackId}`,
          '-f', 'flv',
          '-flvflags', 'no_duration_filesize',
        ];

        if (s.transcode) {
          outputOptions.push('-c:v', 'libx264');
          if (s.videoBitrate) outputOptions.push('-b:v', s.videoBitrate, '-maxrate', s.videoBitrate);
          if (s.bufferSize)   outputOptions.push('-bufsize', s.bufferSize);
          outputOptions.push('-preset', s.preset || 'veryfast');
          if (s.gop) outputOptions.push('-g', String(s.gop));
          if (s.fps) outputOptions.push('-r', String(s.fps));
          // Re-encode both audio streams
          outputOptions.push('-c:a:0', 'aac', '-c:a:1', 'aac');
          if (s.audioBitrate) outputOptions.push('-b:a', s.audioBitrate);
          logger.info(`SRT: transcoding enabled for ${platform} (${s.videoBitrate || 'default'})`);
        } else {
          outputOptions.push('-c:v', 'copy', '-c:a', 'copy');
        }

        cmd.output(outputUrl).outputOptions(outputOptions);
        logger.info(`SRT: Twitch dual-track – VOD track id ${vodTrackId}`);
        hasOutputs = true;
        continue;
      }

      // ── vodOnly: send only the clean/VOD track ────────────────────────────
      // ── default: send only the full-mix track ────────────────────────────
      const audioMap = s.vodOnly ? '0:a:1' : '0:a:0';

      const outputOptions = [
        '-map', '0:v:0',
        '-map', audioMap,
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize',
      ];

      if (s.transcode) {
        outputOptions.push('-c:v', 'libx264');
        if (s.videoBitrate) outputOptions.push('-b:v', s.videoBitrate, '-maxrate', s.videoBitrate);
        if (s.bufferSize)   outputOptions.push('-bufsize', s.bufferSize);
        outputOptions.push('-preset', s.preset || 'veryfast');
        if (s.gop) outputOptions.push('-g', String(s.gop));
        if (s.fps) outputOptions.push('-r', String(s.fps));
        outputOptions.push('-c:a', 'aac');
        if (s.audioBitrate) outputOptions.push('-b:a', s.audioBitrate);
        logger.info(`SRT: transcoding enabled for ${platform} (${s.videoBitrate || 'default'})`);
      } else {
        outputOptions.push('-c:v', 'copy', '-c:a', 'copy');
      }

      cmd.output(outputUrl).outputOptions(outputOptions);
      hasOutputs = true;
    }

    // ── Local recording: always clean/VOD track ───────────────────────────
    if (this.config.recording?.enabled) {
      const recordingPath = path.resolve(this.config.recording.path);
      if (!fs.existsSync(recordingPath)) {
        fs.mkdirSync(recordingPath, { recursive: true });
        logger.info(`SRT: created recording directory: ${recordingPath}`);
      }

      const now = new Date();
      const datePart = now.toISOString().slice(0, 10);
      const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '-');
      const filename = `recording_${datePart}_${timePart}.${this.config.recording.format}`;
      recordingOutputPath = path.join(recordingPath, filename);

      cmd
        .output(recordingOutputPath)
        .outputOptions([
          '-map', '0:v:0',
          '-map', '0:a:1',    // Track 2: clean/VOD-safe mix
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-movflags', '+faststart',
        ]);
      hasOutputs = true;
    }

    if (!hasOutputs) {
      return { command: null, recordingOutputPath: null };
    }

    return { command: cmd, recordingOutputPath };
  }

  _getConfigSignature(config) {
    const srtConfig = {
      srtPort: config.server?.srtPort,
      rtmpPort: config.server?.rtmpPort, // used for browser_debug output
      platforms: {},
      recording: config.recording ? {
        enabled: config.recording.enabled,
        path: config.recording.path,
        format: config.recording.format
      } : null
    };

    for (const [name, p] of Object.entries(config.platforms || {})) {
      if (p.enabled && (p.streamKey || name === 'browser_debug')) {
        srtConfig.platforms[name] = {
          rtmpUrl: p.rtmpUrl,
          streamKey: p.streamKey,
          test_mode: p.test_mode,
          settings: p.settings
        };
      }
    }

    return JSON.stringify(srtConfig);
  }
}
