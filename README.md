# Multistream Server

A Node.js RTMP server that receives streams from OBS and restreams them to multiple platforms simultaneously including Twitch, YouTube, Kick, and more.

## Features

- 📡 RTMP server to receive OBS streams
- 🔄 Simultaneous restreaming to multiple platforms
- 🎮 Support for Twitch, YouTube, Kick (easily extensible)
- 🌐 Web dashboard for monitoring
- 🐳 Docker support
- 🔧 Configuration via environment variables or YAML

## Quick Start

### Using Node.js

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure your stream keys:**
   ```bash
   cp .env.example .env
   # Edit .env with your stream keys
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Configure OBS:**
   - Server: `rtmp://localhost:1935/live`
   - Stream Key: `stream`

5. **View dashboard:**
   Open `http://localhost:8000` in your browser

### Using Docker

1. **Create configuration:**
   ```bash
   cp config.example.yaml config.yaml
   # Edit config.yaml with your stream keys
   ```

2. **Run with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

## Configuration

### Environment Variables (.env)

```env
# RTMP Server Configuration
RTMP_PORT=1935
HTTP_PORT=8000

# Streaming Platforms
TWITCH_STREAM_KEY=your_twitch_stream_key
YOUTUBE_STREAM_KEY=your_youtube_stream_key
KICK_STREAM_KEY=your_kick_stream_key
```

### YAML Configuration (config.yaml)

```yaml
platforms:
  twitch:
    enabled: true
    rtmpUrl: rtmp://live.twitch.tv/live
    streamKey: your_twitch_stream_key
    
  youtube:
    enabled: true
    rtmpUrl: rtmp://a.rtmp.youtube.com/live2
    streamKey: your_youtube_stream_key
```

## Adding Custom Platforms

Edit `config.yaml` to add new platforms:

```yaml
platforms:
  custom_platform:
    enabled: true
    rtmpUrl: rtmp://custom.platform.com/live
    streamKey: your_custom_key
```

## Development

```bash
npm run dev  # Run with nodemon for auto-reload
```

## Requirements

- Node.js 16+
- FFmpeg (automatically included in Docker image)

## API Endpoints

- `GET /` - Web dashboard
- `GET /health` - Health check
- `GET /api/config` - Get current configuration (without sensitive data)
- `GET /api/streams` - Get active streams

## License

MIT