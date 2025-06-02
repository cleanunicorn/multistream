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
  if (process.env.TWITCH_STREAM_KEY) {
    config.platforms.twitch.streamKey = process.env.TWITCH_STREAM_KEY;
    config.platforms.twitch.enabled = true;
  }
  
  if (process.env.YOUTUBE_STREAM_KEY) {
    config.platforms.youtube.streamKey = process.env.YOUTUBE_STREAM_KEY;
    config.platforms.youtube.enabled = true;
  }
  
  if (process.env.KICK_STREAM_KEY) {
    config.platforms.kick.streamKey = process.env.KICK_STREAM_KEY;
    config.platforms.kick.enabled = true;
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