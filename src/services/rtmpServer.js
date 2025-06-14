import NodeMediaServer from 'node-media-server';
import { StreamManager } from './streamManager.js';
import logger from '../utils/logger.js';
import { loadConfig } from '../config/config.js';

export function createRTMPServer() {
  const appConfig = loadConfig();
  const streamManager = new StreamManager();
  
  const config = {
    rtmp: {
      port: appConfig.server.rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60
    },
    http: {
      port: appConfig.server.httpStreamingPort,
      allow_origin: '*'
    }
  };

  const nms = new NodeMediaServer(config);

  nms.on('prePublish', (id, StreamPath, args) => {
    logger.info(`Stream started: ${StreamPath}`);
    streamManager.startStream(StreamPath, args);
  });

  nms.on('donePublish', (id, StreamPath, args) => {
    logger.info(`Stream ended: ${StreamPath}`);
    streamManager.stopStream(StreamPath);
  });

  nms.on('prePlay', (id, StreamPath, args) => {
    logger.info(`Stream play request: ${StreamPath}`);
  });

  return { nms, streamManager };
}