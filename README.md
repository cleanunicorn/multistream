# Multistream Server

A Node.js RTMP server that receives streams from OBS and restreams them to multiple platforms simultaneously including Twitch, YouTube, Kick, and more.

<img width="918" height="784" alt="image" src="https://github.com/user-attachments/assets/9a16f860-2b90-4c9e-946c-2e913addee3e" />


## Features

- 📡 RTMP server to receive OBS streams
- 🔄 Simultaneous restreaming to multiple platforms
- 🎮 Support for Twitch, YouTube, Kick (easily extensible)
- 🌐 Web dashboard for monitoring
- 🐳 Docker support
- 🔧 Configuration via YAML file
- 🔍 Browser debug mode to preview streams in the dashboard

## Screenshots

### Dashboard
![Dashboard](docs/images/dashboard.png)

### Recordings
![Recordings](docs/images/recordings.png)

### Settings
![Settings](docs/images/settings.png)

### Resources
![Resources](docs/images/resources.png)

## Quick Start

### Using Node.js

1. **Install dependencies:**
   ```bash
   npm install
   ```

   Install ffpmeg.
   ```
   sudo apt install ffmpeg
   ```

2. **Configure your stream keys:**
   ```bash
   cp config.example.yaml config.yaml
   # Edit config.yaml with your stream keys
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

### Using Docker (with NVIDIA GPU)

1. **Prerequisites:**
   - Install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) on your host machine.
     ```bash
     sudo apt-get install -y nvidia-container-toolkit
     sudo nvidia-ctk runtime configure --runtime=docker
     sudo systemctl restart docker
     ```

2. **Create configuration:**
   ```bash
   cp config.example.yaml config.yaml
   # Edit config.yaml with your stream keys
   ```

3. **Run with Docker Compose:**
   ```bash
   docker compose up --build -d
   ```
   *Note: The first build will take a significant amount of time (10-15 mins) to download the NVIDIA CUDA image and large Python dependencies (PyTorch, NeMo).*

4. **Verify GPU Access:**
   ```bash
   docker compose logs -f
   # or
   docker compose exec multistream nvidia-smi
   ```

## Configuration

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
    
  kick:
    enabled: false
    rtmpUrl: rtmps://fa723fc1b171.global-contribute.live-video.net/live
    streamKey: your_kick_stream_key

server:
  rtmpPort: 1935
  httpStreamingPort: 9000
  apiPort: 8000

recording:
  enabled: false
  path: ./recordings
  format: mp4
```

### Browser Debug Mode

The `browser_debug` platform allows you to preview your stream directly in the web dashboard. When enabled, you can view your stream at `http://localhost:8000` (or `http://YOUR_IP:8000` from other devices on your network) in the Debug Stream Player section. This is useful for:

- Testing your stream setup without going live
- Monitoring stream quality and latency
- Debugging encoding issues
- Viewing the stream from multiple devices (phones, tablets, other computers)

**Note**: The server will log your network IP addresses on startup for easy remote access.

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
