import fs from 'fs';
import yaml from 'yaml';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Event emitter for config changes
export const configEvents = new EventEmitter();

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
  },
  transcription: {
    model: 'large'
  }
};

export function loadConfig() {
  let config = { ...defaultConfig };

  // Load from config.yaml if exists
  const configPath = path.join(process.cwd(), 'config.yaml');
  if (fs.existsSync(configPath)) {
    const yamlConfig = yaml.parse(fs.readFileSync(configPath, 'utf8'));
    config = mergeConfig(config, yamlConfig);
  } else {
    throw new Error('config.yaml not found. Please create a config.yaml file based on config.example.yaml');
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

// Store current config
let currentConfig = null;

// Watch config file for changes
export function watchConfig() {
  const configPath = path.join(process.cwd(), 'config.yaml');

  let fsWait = false;
  fs.watchFile(configPath, { interval: 1000 }, (curr, prev) => {
    if (fsWait) return;
    fsWait = true;

    setTimeout(() => {
      fsWait = false;

      try {
        const newConfig = loadConfig();

        // Check if config actually changed
        if (JSON.stringify(newConfig) !== JSON.stringify(currentConfig)) {
          logger.info('Configuration file changed, reloading...');
          currentConfig = newConfig;
          configEvents.emit('configReloaded', newConfig);
        }
      } catch (error) {
        logger.error('Error reloading configuration:', error);
      }
    }, 100);
  });

  logger.info('Watching config.yaml for changes...');
}

// Initialize current config
export function initConfig() {
  currentConfig = loadConfig();
  return currentConfig;
}