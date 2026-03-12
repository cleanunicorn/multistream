#!/bin/bash
# Multistream - Setup Wizard

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Globals (set during build_config) ─────────────────────────────────────────
RTMP_PORT=1935
API_PORT=8000
HTTP_STREAMING_PORT=9000

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✗${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${RESET}"; }
ask()     { echo -e -n "${BOLD}$*${RESET} "; }

confirm() {
    local prompt="$1" default="${2:-y}"
    local yn_hint
    [[ "$default" == "y" ]] && yn_hint="[Y/n]" || yn_hint="[y/N]"
    ask "$prompt $yn_hint "
    read -r reply
    reply="${reply:-$default}"
    [[ "$reply" =~ ^[Yy]$ ]]
}

prompt() {
    local var_name="$1" prompt_text="$2" default="${3:-}"
    if [[ -n "$default" ]]; then
        ask "$prompt_text [${default}]: "
    else
        ask "$prompt_text: "
    fi
    read -r value
    value="${value:-$default}"
    printf -v "$var_name" '%s' "$value"
}

# ── Dependency checks ─────────────────────────────────────────────────────────
check_dependencies() {
    header "Checking Dependencies"
    local missing=()

    for cmd in node npm ffmpeg; do
        if command -v "$cmd" &>/dev/null; then
            success "$cmd found ($(command -v "$cmd"))"
        else
            error "$cmd not found"
            missing+=("$cmd")
        fi
    done

    # NVM (non-fatal)
    if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
        success "nvm found"
    else
        warn "nvm not found — start_service.sh relies on it for systemd deployment"
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo
        error "Missing required tools: ${missing[*]}"
        echo -e "Install them and re-run this wizard."
        exit 1
    fi
}

# ── npm install ───────────────────────────────────────────────────────────────
install_dependencies() {
    header "Installing Node Dependencies"
    if [[ -d node_modules ]]; then
        if confirm "node_modules already exists. Reinstall?" "n"; then
            rm -rf node_modules
            npm install
        else
            info "Skipping npm install."
        fi
    else
        npm install
    fi
    success "Node dependencies ready."
}

# ── Platform config ───────────────────────────────────────────────────────────
configure_platform() {
    local name="$1" default_url="$2" default_enabled="${3:-false}"

    echo
    local friendly
    friendly="$(tr '[:lower:]' '[:upper:]' <<< "${name:0:1}")${name:1}"
    info "Platform: ${BOLD}$friendly${RESET}"

    local enabled
    if confirm "  Enable $friendly?" "$( [[ "$default_enabled" == "true" ]] && echo y || echo n )"; then
        enabled="true"
    else
        enabled="false"
    fi

    local stream_key=""
    local rtmp_url="$default_url"

    if [[ "$enabled" == "true" ]]; then
        prompt stream_key "  Stream key for $friendly" ""
        while [[ -z "$stream_key" ]]; do
            warn "Stream key cannot be empty."
            prompt stream_key "  Stream key for $friendly" ""
        done
        prompt rtmp_url "  RTMP URL" "$default_url"
    fi

    printf '%s\t%s\t%s\t%s' "$enabled" "$rtmp_url" "$stream_key" "$name"
}

# ── Build config.yaml ─────────────────────────────────────────────────────────
build_config() {
    header "Streaming Platforms"
    echo -e "Configure each platform. Press Enter to accept defaults.\n"

    # Collect platform data: enabled|rtmpUrl|streamKey
    declare -A P_ENABLED P_URL P_KEY

    for platform_spec in \
        "twitch|rtmp://live.twitch.tv/live|true" \
        "youtube|rtmp://a.rtmp.youtube.com/live2|true" \
        "kick|rtmp://fa723fc1b171.global-contribute.live-video.net/live|false"
    do
        IFS='|' read -r pname purl pdefault <<< "$platform_spec"
        IFS=$'\t' read -r enabled url key _name < <(configure_platform "$pname" "$purl" "$pdefault")
        P_ENABLED[$pname]="$enabled"
        P_URL[$pname]="$url"
        P_KEY[$pname]="$key"
    done

    # Browser debug
    echo
    local browser_debug_enabled="false"
    if confirm "  Enable browser_debug (local HLS preview)?" "y"; then
        browser_debug_enabled="true"
    fi

    # Recording
    echo
    local recording_enabled="false"
    local recording_path="./recordings"
    if confirm "  Enable local recording (MP4)?" "n"; then
        recording_enabled="true"
        prompt recording_path "  Recording directory" "./recordings"
    fi

    # Server ports
    header "Server Ports"
    prompt RTMP_PORT  "RTMP listen port (OBS input)" "1935"
    prompt API_PORT   "API / dashboard port" "8000"
    # HTTP_STREAMING_PORT stays at default 9000 — internal only, proxied via API port

    # ── Write config.yaml ──────────────────────────────────────────────────────
    header "Writing config.yaml"

    local config_path="$(dirname "$0")/config.yaml"

    if [[ -f "$config_path" ]]; then
        warn "config.yaml already exists."
        if ! confirm "Overwrite it?" "n"; then
            info "Keeping existing config.yaml."
            return
        fi
        cp "$config_path" "${config_path}.bak"
        info "Backup saved to config.yaml.bak"
    fi

    cat > "$config_path" <<YAML
# Multistream Configuration
# Generated by setup.sh on $(date '+%Y-%m-%d %H:%M:%S')

platforms:
  twitch:
    enabled: ${P_ENABLED[twitch]}
    rtmpUrl: ${P_URL[twitch]}
    streamKey: ${P_KEY[twitch]:-your_twitch_stream_key_here}
    settings:
      transcode: true
      videoBitrate: 6000k
      bufferSize: 12000k
      audioBitrate: 160k
      fps: 30
      gop: 60
      preset: veryfast
      inputBuffer: 3000

  youtube:
    enabled: ${P_ENABLED[youtube]}
    rtmpUrl: ${P_URL[youtube]}
    streamKey: ${P_KEY[youtube]:-your_youtube_stream_key_here}
    settings: {}

  kick:
    enabled: ${P_ENABLED[kick]}
    rtmpUrl: ${P_URL[kick]}
    streamKey: ${P_KEY[kick]:-your_kick_stream_key_here}
    settings: {}

  browser_debug:
    enabled: ${browser_debug_enabled}
    rtmpUrl: local
    streamKey: debug
    settings:
      httpPath: /live/stream.flv
YAML

    cat >> "$config_path" <<YAML

recording:
  enabled: ${recording_enabled}
  path: ${recording_path}
  format: mp4

server:
  rtmpPort: ${RTMP_PORT}
  apiPort: ${API_PORT}
  httpStreamingPort: ${HTTP_STREAMING_PORT}

# Transcription uses nvidia/parakeet-tdt-0.6b-v3 (fixed model, requires NVIDIA GPU)
YAML

    success "config.yaml written."
}

# ── Systemd service ───────────────────────────────────────────────────────────
setup_systemd() {
    local instance_name="$1"
    local service_name="multistream-${instance_name}"

    header "Systemd Service (Optional)"

    if ! command -v systemctl &>/dev/null; then
        info "systemd not available — skipping."
        return
    fi

    if ! confirm "Install as a systemd user service?" "n"; then
        return
    fi

    local service_dir="$HOME/.config/systemd/user"
    local service_file="$service_dir/${service_name}.service"
    local work_dir
    work_dir="$(cd "$(dirname "$0")" && pwd)"

    mkdir -p "$service_dir"

    cat > "$service_file" <<UNIT
[Unit]
Description=Multistream (${instance_name})
After=network.target

[Service]
Type=simple
WorkingDirectory=${work_dir}
ExecStart=${work_dir}/start_service.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable "${service_name}.service"
    success "Service installed: $service_file"
    info "Start now:    systemctl --user start ${service_name}"
    info "Check status: systemctl --user status ${service_name}"
    info "View logs:    journalctl --user -u ${service_name} -f"
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
    header "Setup Complete"
    success "Multistream is ready to run.\n"
    echo -e "  ${BOLD}Start (foreground):${RESET}  make start"
    echo -e "  ${BOLD}Start (dev mode):${RESET}    make dev"
    echo -e "  ${BOLD}Run in Docker:${RESET}       make docker"
    echo
    echo -e "  Point OBS to:  ${BOLD}rtmp://localhost:${RTMP_PORT}/live${RESET}  (stream key: any)"
    echo -e "  Dashboard:     ${BOLD}http://localhost:${API_PORT}${RESET}"
    echo
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    clear
    echo -e "${BOLD}${CYAN}"
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║   Multistream — Setup Wizard   ║"
    echo "  ╚══════════════════════════════════════╝"
    echo -e "${RESET}"
    echo -e "This wizard will:"
    echo    "  1. Check required dependencies"
    echo    "  2. Install Node.js packages"
    echo    "  3. Generate config.yaml with your stream keys"
    echo    "  4. Optionally install a systemd service"
    echo
    if ! confirm "Continue?" "y"; then
        echo "Aborted."
        exit 0
    fi

    cd "$(dirname "$0")"

    echo
    local instance_name
    prompt instance_name "Your name (used to identify this instance)" "$(basename "$(pwd)" | sed 's/.*-//')"
    # Normalise: lowercase, spaces to hyphens
    instance_name="$(echo "$instance_name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"

    check_dependencies
    install_dependencies
    build_config
    setup_systemd "$instance_name"
    print_summary
}

main "$@"
