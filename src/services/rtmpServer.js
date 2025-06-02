import NodeMediaServer from 'node-media-server';
import { StreamManager } from './streamManager.js';
import logger from '../utils/logger.js';

export function createRTMPServer() {
  const streamManager = new StreamManager();
  
  const config = {
    rtmp: {
      port: parseInt(process.env.RTMP_PORT) || 1935,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60
    },
    http: {
      port: parseInt(process.env.HTTP_STREAMING_PORT) || 9000,
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

  return nms;
}