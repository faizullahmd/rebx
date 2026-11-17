# REBX AI Video Studio render worker.
#
# Build (from the repo root):
#   docker build -t rebx-video-worker worker/video-renderer
#
# The image bundles FFmpeg/FFprobe (with libass for burned-in captions) and the
# fonts the caption renderer asks for: "Arial" (Liberation Sans is the metric-
# compatible substitute fontconfig picks on Linux) and "Noto Sans" for Indic scripts.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        fontconfig \
        fonts-liberation \
        fonts-noto-core \
        tini \
        ca-certificates \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/worker/video-renderer

# Dependencies first so code changes don't invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets

# Scratch space for downloaded scene assets and intermediate renders.
ENV RENDER_WORKER_TEMP_DIR=/var/rebx-render-tmp
RUN mkdir -p "$RENDER_WORKER_TEMP_DIR" && chown -R node:node "$RENDER_WORKER_TEMP_DIR" /app

USER node

# Fail the build if FFmpeg/FFprobe (or libass) are missing.
RUN ffmpeg -hide_banner -filters | grep -qw ass \
    && ffprobe -version >/dev/null \
    && node --import tsx src/check-ffmpeg.ts --strict >/dev/null

# tini forwards SIGTERM so the worker can release its job lease on shutdown.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "src/index.ts"]
