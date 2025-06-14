import { createRTMPServer } from './services/rtmpServer.js';
import { createAPIServer } from './services/apiServer.js';
import logger from './utils/logger.js';
import { initConfig, watchConfig } from './config/config.js';
import os from 'os';

async function main() {
  try {
    logger.info('Starting Multistream Server...');
    
    const config = initConfig();
    watchConfig();
    
    const { nms: rtmpServer, streamManager } = createRTMPServer();
    rtmpServer.run();
    
    const apiServer = createAPIServer(streamManager);
    apiServer.listen(config.server.apiPort, () => {
      logger.info(`API Server running on port ${config.server.apiPort}`);
    });
    
    logger.info(`RTMP Server running on port ${config.server.rtmpPort}`);
    logger.info(`OBS Stream Server URL: rtmp://localhost:${config.server.rtmpPort}/live`);
    logger.info('OBS Stream Key: stream');
    
    // Log network interfaces for remote access
    const networkInterfaces = os.networkInterfaces();
    Object.keys(networkInterfaces).forEach(interfaceName => {
      networkInterfaces[interfaceName].forEach(iface => {
        if (iface.family === 'IPv4' && !iface.internal) {
          logger.info(`Remote access: http://${iface.address}:${config.server.apiPort}`);
        }
      });
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();