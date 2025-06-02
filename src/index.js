import dotenv from 'dotenv';
import { createRTMPServer } from './services/rtmpServer.js';
import { createAPIServer } from './services/apiServer.js';
import logger from './utils/logger.js';

dotenv.config();

async function main() {
  try {
    logger.info('Starting Multistream Server...');
    
    const rtmpServer = createRTMPServer();
    rtmpServer.run();
    
    const apiServer = createAPIServer();
    const apiPort = process.env.API_PORT || 8000;
    apiServer.listen(apiPort, () => {
      logger.info(`API Server running on port ${apiPort}`);
    });
    
    logger.info(`RTMP Server running on port ${process.env.RTMP_PORT || 1935}`);
    logger.info('OBS Stream Server URL: rtmp://localhost:1935/live');
    logger.info('OBS Stream Key: stream');
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();