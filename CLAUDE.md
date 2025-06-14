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

# Run tests
npm test
```

## Architecture

### Core Components

1. **RTMP Server** (`src/services/rtmpServer.js`): Handles incoming RTMP streams from OBS using node-media-server
2. **Stream Manager** (`src/services/streamManager.js`): Manages restreaming to multiple platforms using fluent-ffmpeg
3. **API Server** (`src/services/apiServer.js`): Express server providing REST API and web dashboard
4. **Configuration** (`src/config/config.js`): Handles both .env and YAML configuration loading

### Key Technical Details

- **ES Modules**: Project uses `"type": "module"` - use `import/export` syntax
- **Logging**: Winston logger configured in `src/utils/logger.js`
- **FFmpeg**: Required for video processing (included in Docker image)
- **Ports**: RTMP on 1935, HTTP/API on 8000

### Configuration System

The project uses YAML configuration via `config.yaml` file. The configuration file must exist for the application to start. Use `config.example.yaml` as a template.

## Testing

Currently no tests exist. When adding tests:
- Test framework: Jest
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

## API Endpoints

- `GET /` - Web dashboard with debug stream player
- `GET /health` - Health check
- `GET /api/config` - Current configuration (sanitized)
- `GET /api/streams` - Active stream information
- `GET /live/stream.flv` - Browser debug stream (proxied from HTTP streaming server)

## Browser Debug Feature

The `browser_debug` platform is a special platform that streams to the local HTTP server instead of external platforms. When enabled, the stream can be viewed directly in the dashboard using an FLV player. This is handled differently in StreamManager using `createBrowserDebugCommand()` method.