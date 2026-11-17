# REBX Video Renderer Worker (Phase 3 — Part C3.1 + C3.2 + C3.3)

Standalone Node.js/TypeScript background worker process for REBX AI Video Studio.

> **Scope & Safety Note:** This worker implements configuration, structured logging (with secret redaction), authenticated HTTP coordination with REBX, atomic job claiming, heartbeat/lease tracking, graceful shutdown, cross-platform FFmpeg/FFprobe environment integration (**Part C3.2.2**), secure authenticated asset access + temporary workspace staging (**Part C3.2.3**), the local FFmpeg H.264/AAC MP4 rendering + FFprobe verification engine (**Part C3.2.4**), and streaming private MP4 upload + server-verified completion + safe temp workspace cleanup (**Part C3.3**). By default (`RENDER_WORKER_PROCESSING_ENABLED="false"`), the worker remains safely idle and does **not** claim or mutate `PENDING`/`QUEUED` render jobs until explicitly enabled.

## Deployment

A Dockerfile (bundles FFmpeg + caption fonts), `docker-compose.yml` and step-by-step instructions for a DigitalOcean Droplet or App Platform worker are in [DEPLOY.md](DEPLOY.md).

## Environment Variables

Set these in the **main REBX Next.js app** (`.env` / `.env.local`):

- `RENDER_WORKER_ENABLED="true"`
- `RENDER_WORKER_SECRET="<long-random-secret>"`

Set these in the **worker environment** (or shared local `.env`):

- `RENDER_WORKER_SECRET="<same-secret-as-main-app>"`
- `RENDER_WORKER_PROCESSING_ENABLED="false"` *(default `"false"` — keeps worker safely idle until explicitly turned on in your worker runtime)*
- `RENDER_API_BASE_URL="http://localhost:3000"`
- `RENDER_WORKER_ID="rebx-local-worker-1"`
- `RENDER_POLL_INTERVAL_MS="5000"`
- Optional: `RENDER_REQUEST_TIMEOUT_MS="15000"`, `RENDER_LEASE_DURATION_SEC="300"`, `RENDER_HEARTBEAT_INTERVAL_MS="30000"`, `RENDER_FFMPEG_TIMEOUT_MS="300000"`, `RENDER_WORKER_TEMP_DIR=""` *(defaults to `<os.tmpdir()>/rebx-video-worker`)*

## FFmpeg MP4 Rendering Engine (Part C3.2.4)

- **Supported Snapshot Profiles (from immutable snapshot `renderSettings`):**
  - `16:9` — `1920 × 1080`
  - `9:16` — `1080 × 1920`
  - `1:1` — `1080 × 1080`
  - Standardized output: `mp4` container (`+faststart`), H.264 (`libx264`, `yuv420p`, `30` fps CFR), AAC audio (`48 kHz` stereo, peak-limited via `alimiter`).
- **Image Normalization, Voiceover Sync & Burned-In Captions:**
  - Scales and letterboxes/pillarboxes mixed input image aspect ratios without stretching (`force_original_aspect_ratio=decrease` + centered pad + `setsar=1`).
  - Probes optional audio tracks via FFprobe: pads silence (`apad`) for shorter voiceovers, extends held frames cleanly when audio exceeds nominal scene duration, and synthesizes silent stereo audio when optional audio is omitted.
  - Burns always-on phrase-by-phrase captions from `scene.narration` (`captions.ts` via ASS/libass: bold white bottom-centered text with thick black outline, chunked to 1–2 balanced lines and synced across each scene's probed speech window).
  - Supports `"cut"` (default), `"fade"`, and `"crossfade"` transitions (rejecting unsupported transition names/durations before spawning FFmpeg).
- **Execution Safety, Progress, Upload & Cleanup (C3.2.4 + C3.3):**
  - Runs FFmpeg/FFprobe exclusively via `spawn`/`execFile` with `shell: false`, argument arrays, stripped child environment (`buildSafeProbeChildEnv`), bounded stderr tail buffers, timeouts, secret/path redaction, real `-progress pipe:1` progress reporting (`5%–95%`), and periodic worker heartbeats.
  - After FFprobe verification succeeds, streams the rendered MP4 via `PUT /api/internal/video-studio/render-jobs/[jobId]/output` with `Content-Type: video/mp4` and `X-REBX-Content-SHA256` (`96%–99%`). The REBX app writes privately to `storage/video-studio/<projectId>/renders/render_<jobId>.mp4` in local dev or DigitalOcean Spaces (`ACL: "private"`) in production — with zero Spaces credentials in the worker.
  - Calls `POST /api/internal/video-studio/render-jobs/[jobId]/complete`, where the REBX server independently verifies object existence, positive size, MP4 `ftyp` header, and SHA-256 checksum before marking the job `COMPLETED` (`100%`).
  - Only after durable upload, verification, and `/complete` succeed does the worker remove the temporary MP4, intermediate scene files, and per-job temporary directory. If upload or `/complete` fails prematurely, the temporary MP4 is preserved for recovery while non-cancelled failures report safely. Immediately aborts and cleans up on `AbortSignal`, `stop()`, or server `409`/`403` ownership revocation.

## Secure Worker Asset Access (Part C3.2.3)

- **No storage secrets in worker:** The worker does **not** receive DigitalOcean Spaces keys or direct filesystem paths. All private audio and scene images are streamed through the main REBX app's internal endpoint:
  `GET /api/internal/video-studio/render-jobs/[jobId]/assets/[assetId]`
- **Strict authorization:** Requires `Authorization: Bearer <RENDER_WORKER_SECRET>`, matching `X-REBX-Worker-Id`, active `PROCESSING` status, non-cancelled job state, and an active non-expired worker lease. Only opaque snapshot-derived asset IDs (`img_<hash>` / `aud_<hash>`) belonging to that claimed job are accepted.
- **Validation & cleanup:** Before downloading, [`assets.ts`](src/assets.ts) validates the immutable snapshot, requires scene images (`JPG`, `PNG`, `WebP` <= 10 MB) and scene voiceovers (`MP3`, `WAV`, `OGG`, `WebM` <= 15 MB), deduplicates shared scene assets, verifies `Content-Type` + binary file signatures + `Content-Length`, writes strictly to generated filenames in an isolated per-job temp directory, and cleans up temp files on both completion and failure.
- Optional FFmpeg overrides:
  - `FFMPEG_PATH` — explicit path to `ffmpeg` / `ffmpeg.exe` (when set, no silent fallback to global `PATH` occurs)
  - `FFPROBE_PATH` — explicit path to `ffprobe` / `ffprobe.exe` (when set, no silent fallback to global `PATH` occurs)
  - `FFMPEG_PROBE_TIMEOUT_MS="4000"` — timeout in ms for executable version checks (`100`–`60000`)

Generate a strong shared secret with Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## FFmpeg & FFprobe Setup

### Local Windows Development

Option A — **System / User `PATH` (Recommended)**

Install FFmpeg + FFprobe via WinGet (or Scoop / Chocolatey / official release archive):

```powershell
winget install Gyan.FFmpeg.Essentials
```

How discovery works automatically on Windows (with no shell interpolation):
1. If `FFMPEG_PATH` / `FFPROBE_PATH` is set, the worker executes only that configured executable.
2. Otherwise, it checks `process.env.PATH` (`Path`) first.
3. If inherited `PATH` comes from an IDE/terminal opened prior to installation, it safely performs a shared Windows User/Machine Registry `PATH` lookup (`HKCU\Environment` / `HKLM\...\Environment`) via `reg.exe` without spawning a shell.
4. Finally, it checks common Windows installation locations (`%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%LOCALAPPDATA%\Microsoft\WinGet\Packages\...`, `%USERPROFILE%\scoop\shims`, `C:\ProgramData\chocolatey\bin`, `C:\ffmpeg\bin`, `C:\Program Files\ffmpeg\bin`), plus any companion tool directory where `ffmpeg.exe` / `ffprobe.exe` was already verified.

Option B — **Custom Executable Override**

In `.env` or `.env.local` (or worker shell environment), point directly to the executables:

```dotenv
FFMPEG_PATH="C:\path\to\ffmpeg\bin\ffmpeg.exe"
FFPROBE_PATH="C:\path\to\ffmpeg\bin\ffprobe.exe"
```

### Verify FFmpeg Independently of Next.js

From the repository root (does **not** require `next dev` or `RENDER_WORKER_SECRET`):

```bash
npm run worker:video:check-ffmpeg
```

Or strictly exit non-zero if either executable is unavailable:

```bash
npx tsx worker/video-renderer/src/check-ffmpeg.ts --strict
```

Or run completely standalone from `worker/video-renderer/`:

```bash
cd worker/video-renderer
npm run check-ffmpeg
```

Expected output structure:

```json
{
  "platform": "win32",
  "checkedAt": "...",
  "ffmpeg": {
    "tool": "ffmpeg",
    "available": true,
    "source": "path",
    "executablePath": "C:\\...\\ffmpeg.exe",
    "version": "9.0.1-essentials_build-www.gyan.dev",
    "parsedVersion": { "raw": "9.0.1-essentials_build-www.gyan.dev", "major": 9, "minor": 0, "patch": 1 },
    "errorCode": null,
    "error": null
  },
  "ffprobe": { "tool": "ffprobe", "available": true, "..." : "..." },
  "readyForPartC32Rendering": true
}
```

### Future Linux Worker Setup (Droplet / Container)

For production background rendering on Ubuntu/Debian Linux (Docker worker or standalone Droplet service):

```bash
sudo apt-get update && sudo apt-get install -y --no-install-recommends ffmpeg
```

This installs both `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` onto system `PATH`, where the worker discovers them automatically (`source: "path"` or `"common_dir"`). In container environments, you may also pin:

```dotenv
FFMPEG_PATH="/usr/bin/ffmpeg"
FFPROBE_PATH="/usr/bin/ffprobe"
```

Verify inside the worker environment with `npm run check-ffmpeg` (`--strict` in health/build checks).

## Local Development Startup

1. **Verify FFmpeg & FFprobe** (standalone, no Next.js required):

   ```bash
   npm run worker:video:check-ffmpeg
   ```

2. **Start the main REBX Next.js app** (Terminal 1 from repository root):

   ```bash
   npm run dev
   ```

3. **Start the standalone worker** (Terminal 2 from repository root):

   ```bash
   npm run worker:video
   ```

   Or independently from `worker/video-renderer/`:

   ```bash
   cd worker/video-renderer
   npm run start
   ```

Press `Ctrl+C` (`SIGINT`) or send `SIGTERM` to trigger graceful shutdown cleanly after any active request completes.
