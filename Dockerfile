FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
# python3-venv is often needed for uv/pip virtualenv creation
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install npm dependencies
RUN npm ci --only=production

# Copy application source
COPY . .

# Pre-warm uv cache with the specific dependencies used in transcription.js
# This ensures that when the app runs, it doesn't need to download these large libs
RUN uv run --python 3.10 \
    --with "cmake" \
    --with "torch" \
    --with "torchaudio" \
    --with "nemo_toolkit[asr]" \
    --with "lhotse<1.27" \
    python3 -c "print('Dependencies pre-installed')"

# Expose ports
# 1935: RTMP
# 8000: API
# 9000: HTTP Streaming
EXPOSE 1935 8000 9000

# Start the application
CMD ["node", "src/index.js"]