# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js-based multi-platform streaming server that receives RTMP streams from OBS and restreams them simultaneously to multiple platforms (Twitch, YouTube, Kick, etc.). The project uses ES modules and is built with Express.js for the API and node-media-server for RTMP functionality.

## Common Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run in production mode
npm start

# Run tests (Jest configured but no tests exist yet)
npm test

# Using Makefile shortcuts
make install    # Install dependencies
make dev        # Run in development mode
make start      # Run in production mode
make docker     # Build and run with Docker
```

## Architecture

### Core Components

1. **RTMP Server** (`src/services/rtmpServer.js`): Handles incoming RTMP streams from OBS using node-media-server
2. **Stream Manager** (`src/services/streamManager.js`): Manages restreaming to multiple platforms using fluent-ffmpeg
3. **API Server** (`src/services/apiServer.js`): Express server providing REST API and web dashboard
4. **Configuration** (`src/config/config.js`): Handles YAML configuration with hot reload support

### Key Technical Details

- **ES Modules**: Project uses `"type": "module"` - use `import/export` syntax
- **Logging**: Winston logger configured in `src/utils/logger.js`
- **FFmpeg**: Required for video processing (included in Docker image)
- **Ports**: 
  - RTMP: 1935
  - HTTP/API: 8000
  - HTTP Streaming: 9000 (for browser debug mode)

### Configuration System

The project uses YAML configuration via `config.yaml` file. The configuration file must exist for the application to start. Use `config.example.yaml` as a template.

Key configuration features:
- Hot reload: Configuration automatically reloads when file changes
- Manual reload: Available via POST /api/reload-config
- Platform management: Enable/disable platforms without restart

## Testing

Currently no tests exist. When adding tests:
- Test framework: Jest (already configured)
- Run with: `npm test`
- Create test files with `.test.js` extension

## Docker Development

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Rebuild after changes
docker-compose build

# Using Makefile
make docker       # Build and start
make docker-logs  # View logs
make docker-stop  # Stop containers
```

## Adding New Streaming Platforms

1. Add platform configuration to `config.yaml`:
   ```yaml
   platforms:
     new_platform:
       enabled: true
       rtmpUrl: rtmp://platform.com/live
       streamKey: your_key
   ```

2. The stream manager will automatically pick up new platforms from the configuration
3. No code changes needed - configuration-driven architecture

## API Endpoints

- `GET /` - Web dashboard with FLV.js player for debug stream
- `GET /health` - Health check endpoint
- `GET /api/config` - Current configuration (sanitized, no stream keys)
- `GET /api/streams` - Active stream information with platform status
- `POST /api/reload-config` - Manually trigger configuration reload
- `GET /live/stream.flv` - Proxied FLV stream for browser playback

## Special Features

### Browser Debug Mode

The `browser_debug` platform is a special platform that streams to the local HTTP server instead of external platforms. When enabled:
- Stream viewable at http://localhost:8000 in the dashboard
- Uses FLV.js player for in-browser playback
- Handled differently in StreamManager using `createBrowserDebugCommand()` method
- Useful for testing streams without going live on external platforms

### Recording Feature

Local recording can be enabled in configuration:
```yaml
recording:
  enabled: true
  path: ./recordings
  format: mp4
```
- Creates timestamped files in the recordings directory
- Runs alongside platform streaming

### Hot Configuration Reload

The system monitors `config.yaml` for changes:
- Automatic reload when file is saved
- Graceful handling of platform enable/disable
- Active streams update without interruption
- Manual reload available via API endpoint

### Network Discovery

On startup, the application logs all network interfaces, making it easy to:
- Access dashboard from other devices on the network
- Test streaming from mobile or tablet
- Share debug stream with team members

## Project Structure

```
/src
├── index.js              # Main entry point
├── config/
│   └── config.js         # Configuration loader with hot reload
├── services/
│   ├── rtmpServer.js     # RTMP server for receiving streams
│   ├── streamManager.js  # FFmpeg process management
│   └── apiServer.js      # Express API and dashboard
└── utils/
    └── logger.js         # Winston logger setup

/public                   # Static files for web dashboard
├── index.html           # Dashboard HTML
└── style.css           # Dashboard styles

/recordings              # Default recording output directory
/logs                   # Log files directory
```

## Development Tips

1. **OBS Configuration**: 
   - Server: `rtmp://localhost:1935/live`
   - Stream Key: Set in config.yaml as `streamKey`

2. **Platform Testing**: 
   - Enable `browser_debug` to test without going live
   - Check dashboard for stream status and preview

3. **Debugging**:
   - Check logs in console or logs directory
   - Use dashboard to monitor active streams
   - API endpoints provide real-time status

4. **Performance**: 
   - Each platform runs a separate FFmpeg process
   - Monitor CPU usage when streaming to many platforms
   - Adjust video settings in config.yaml if needed