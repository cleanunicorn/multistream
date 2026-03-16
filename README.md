# Multistream Server

A Node.js server that receives streams from OBS and restreams them to multiple platforms simultaneously — with full multi-track audio support for VOD-safe streams.

<img width="918" height="784" alt="image" src="https://github.com/user-attachments/assets/9a16f860-2b90-4c9e-946c-2e913addee3e" />


## Features

- 📡 SRT input (primary) — preserves multi-track audio from OBS for VOD-safe routing
- 🔄 RTMP input (fallback) — single-track, standard OBS streaming
- 🎵 Per-platform audio track routing (full mix, clean/VOD mix, or Twitch dual-track)
- 🔁 Simultaneous restreaming to multiple platforms (Twitch, YouTube, Kick, TikTok, custom)
- 🌐 Web dashboard for monitoring and live control
- 🐳 Docker support
- 🔧 Live config reload — toggle platforms on/off without restarting
- 🔍 Browser debug mode to preview the stream in the dashboard
- 🎙️ Automatic transcription of recordings

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

   Install FFmpeg:
   ```bash
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

4. **Configure OBS** — see [OBS Setup](#obs-setup) below.

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

---

## OBS Setup

### SRT Input (recommended — required for VOD-safe audio)

Enable SRT in `config.yaml`:

```yaml
server:
  srtEnabled: true
  srtPort: 9000
```

In OBS: **Settings → Stream**

| Field | Value |
|-------|-------|
| Service | Custom |
| Server | `srt://YOUR_SERVER_IP:9000` |
| Stream Key | *(leave empty)* |

### RTMP Input (fallback — single audio track only)

```
Server:     rtmp://localhost:1935/live
Stream Key: stream
```

---

## Audio Track Setup (OBS)

Multi-track audio routing requires SRT input. The server routes audio based on per-platform config:

| Track | Content | Used by |
|-------|---------|---------|
| Track 1 | Full mix — game, voice, **music** | Twitch live stream |
| Track 2 | Clean mix — game, voice, **no music** | YouTube, Kick, TikTok, recordings, Twitch VOD |

### Configure tracks in OBS

1. **Settings → Output → Set Output Mode to Advanced**
2. **Output → Streaming tab → set Audio Track to track 1**
3. **Settings → Audio → set up to 6 tracks**
4. In the **Audio Mixer**, click the gear icon on each source → **Advanced Audio Settings** → assign each source to the appropriate tracks:
   - Music sources: enable **Track 1 only** (so they are excluded from the clean mix on Track 2)
   - Game, voice, alerts: enable **both Track 1 and Track 2**
5. Make sure the **audio encoder is AAC** (not Opus) so passthrough mode works without transcoding

### Twitch VOD track

Twitch supports a special dual-track mode where the live stream uses the full mix and the saved VOD uses the clean mix. Configure in `config.yaml`:

```yaml
platforms:
  twitch:
    settings:
      twitchVodTrack: 2   # send both tracks; tell Twitch to use track 2 for VOD
```

The server sends both audio tracks and injects the `twitch_vod_track_id` AMF0 metadata so Twitch saves the clean track to the VOD archive while live viewers hear the full mix.

### VOD-only platforms (YouTube, Kick, TikTok)

These platforms receive only the clean track — music is never sent:

```yaml
platforms:
  youtube:
    settings:
      vodOnly: true   # send only Track 2 (clean mix, no music)
```

### Local recording

The local recording always uses Track 2 (clean/VOD-safe) so saved files are music-free.

---

## Configuration Reference

```yaml
platforms:
  twitch:
    enabled: true
    rtmpUrl: rtmp://live.twitch.tv/live
    streamKey: your_twitch_stream_key
    settings:
      twitchVodTrack: 2     # Twitch dual-track VOD mode
      transcode: false      # true = re-encode video; false = copy (lower CPU)
      videoBitrate: 6000k
      audioBitrate: 160k

  youtube:
    enabled: true
    rtmpUrl: rtmp://a.rtmp.youtube.com/live2
    streamKey: your_youtube_stream_key
    settings:
      vodOnly: true         # send only the clean/VOD track (Track 2)
      transcode: false

  kick:
    enabled: false
    rtmpUrl: rtmps://fa723fc1b171.global-contribute.live-video.net/app
    streamKey: your_kick_stream_key
    settings:
      vodOnly: true

server:
  rtmpPort: 1935
  httpStreamingPort: 9000
  apiPort: 8000
  srtEnabled: true
  srtPort: 9000

recording:
  enabled: false
  path: ./recordings
  format: mp4            # mp4 | mkv | flv
```

### Platform audio modes

| Setting | Audio sent | Use case |
|---------|-----------|----------|
| *(none)* | Track 1 — full mix | Live-only platforms, no VOD concerns |
| `vodOnly: true` | Track 2 — clean mix | YouTube, Kick, TikTok |
| `twitchVodTrack: 2` | Both tracks + VOD metadata | Twitch |

### Transcoding

When `transcode: false` (default), video and audio are copied as-is — minimal CPU usage. Set `transcode: true` if you need the server to re-encode (e.g. different bitrates per platform, or incompatible source codec).

> **Note:** Copy mode requires OBS to output AAC audio. If OBS is configured to use Opus (common with SRT), set `transcode: true` to re-encode to AAC automatically.

---

## Browser Debug Mode

The `browser_debug` platform streams to NMS locally and plays back in the web dashboard. Useful for:

- Testing your setup without going live
- Monitoring stream quality
- Viewing from other devices on your network (the server logs your network IPs on startup)

Always uses Track 1 (full mix) for live monitoring.

---

## Adding Custom Platforms

```yaml
platforms:
  custom_platform:
    enabled: true
    rtmpUrl: rtmp://custom.platform.com/live
    streamKey: your_custom_key
    settings:
      vodOnly: true   # optional — omit for full mix
```

---

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
