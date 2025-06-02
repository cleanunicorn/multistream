import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultConfig = {
  platforms: {
    twitch: {
      enabled: false,
      rtmpUrl: 'rtmp://live.twitch.tv/live',
      streamKey: '',
      settings: {}
    },
    youtube: {
      enabled: false,
      rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: '',
      settings: {}
    },
    kick: {
      enabled: false,
      rtmpUrl: 'rtmps://fa723fc1b171.global-contribute.live-video.net/live',
      streamKey: '',
      settings: {}
    }
  },
  server: {
    rtmpPort: 1935,
    httpStreamingPort: 9000,
    apiPort: 8000
  },
  recording: {
    enabled: false,
    path: './recordings',
    format: 'mp4'
  }
};

export function loadConfig() {
  let config = { ...defaultConfig };
  
  // Load from config.yaml if exists
  const configPath = path.join(process.cwd(), 'config.yaml');
  if (fs.existsSync(configPath)) {
    const yamlConfig = yaml.parse(fs.readFileSync(configPath, 'utf8'));
    config = mergeConfig(config, yamlConfig);
  }
  
  // Override with environment variables
  // Twitch
  if (process.env.ENABLE_TWITCH !== undefined) {
    config.platforms.twitch.enabled = process.env.ENABLE_TWITCH === 'true';
  }
  if (process.env.TWITCH_STREAM_KEY) {
    config.platforms.twitch.streamKey = process.env.TWITCH_STREAM_KEY;
    // Only auto-enable if not explicitly disabled
    if (process.env.ENABLE_TWITCH === undefined) {
      config.platforms.twitch.enabled = true;
    }
  }
  
  // YouTube
  if (process.env.ENABLE_YOUTUBE !== undefined) {
    config.platforms.youtube.enabled = process.env.ENABLE_YOUTUBE === 'true';
  }
  if (process.env.YOUTUBE_STREAM_KEY) {
    config.platforms.youtube.streamKey = process.env.YOUTUBE_STREAM_KEY;
    // Only auto-enable if not explicitly disabled
    if (process.env.ENABLE_YOUTUBE === undefined) {
      config.platforms.youtube.enabled = true;
    }
  }
  
  // Kick
  if (process.env.ENABLE_KICK !== undefined) {
    config.platforms.kick.enabled = process.env.ENABLE_KICK === 'true';
  }
  if (process.env.KICK_STREAM_KEY) {
    config.platforms.kick.streamKey = process.env.KICK_STREAM_KEY;
    // Only auto-enable if not explicitly disabled
    if (process.env.ENABLE_KICK === undefined) {
      config.platforms.kick.enabled = true;
    }
  }
  
  // Override RTMP URLs if provided
  if (process.env.TWITCH_RTMP_URL) {
    config.platforms.twitch.rtmpUrl = process.env.TWITCH_RTMP_URL;
  }
  
  if (process.env.YOUTUBE_RTMP_URL) {
    config.platforms.youtube.rtmpUrl = process.env.YOUTUBE_RTMP_URL;
  }
  
  if (process.env.KICK_RTMP_URL) {
    config.platforms.kick.rtmpUrl = process.env.KICK_RTMP_URL;
  }
  
  // Server config
  if (process.env.RTMP_PORT) {
    config.server.rtmpPort = parseInt(process.env.RTMP_PORT);
  }
  
  if (process.env.HTTP_STREAMING_PORT) {
    config.server.httpStreamingPort = parseInt(process.env.HTTP_STREAMING_PORT);
  }
  
  if (process.env.API_PORT) {
    config.server.apiPort = parseInt(process.env.API_PORT);
  }
  
  // Recording config
  if (process.env.ENABLE_RECORDING) {
    config.recording.enabled = process.env.ENABLE_RECORDING === 'true';
  }
  
  if (process.env.RECORDING_PATH) {
    config.recording.path = process.env.RECORDING_PATH;
  }
  
  if (process.env.RECORDING_FORMAT) {
    config.recording.format = process.env.RECORDING_FORMAT;
  }
  
  return config;
}

function mergeConfig(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeConfig(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}