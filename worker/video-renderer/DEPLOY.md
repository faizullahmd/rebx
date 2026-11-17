# Deploying the REBX video render worker

The REBX web app (App Platform) only **creates** render jobs. This worker claims them, runs
FFmpeg, and uploads the MP4 back through the REBX API. Until it is running, jobs stay at
`Pending – Awaiting render worker`.

The worker needs **no database or Spaces credentials**: it only talks to REBX over HTTPS
using a shared secret. FFmpeg, FFprobe, libass and the caption fonts (Liberation Sans and
Noto Sans for Indic scripts) are installed by the [Dockerfile](Dockerfile).

## 1. Create the shared secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Configure the main REBX app (DigitalOcean App Platform → Settings → web component → Environment variables)

| Variable | Value |
| --- | --- |
| `RENDER_WORKER_ENABLED` | `true` |
| `RENDER_WORKER_SECRET` | the secret from step 1 (encrypt it) |

Redeploy the app so it picks these up. Without them the internal worker endpoints reject
every request (fail closed). `GEMINI_API_KEY`, `SARVAM_API_KEY` and the Spaces settings
stay on the web app only.

## 3. Run the worker on a Droplet (recommended)

Rendering is CPU-heavy and long-running, so a dedicated Droplet is simpler and cheaper than a
managed container. A Basic/Regular Droplet with **2 vCPU / 4 GB RAM** (Ubuntu 24.04) is the minimum that renders
1080p reliably; the compose file caps the container at 3 GB. **1 GB Droplets will be OOM-killed
mid-render** (jobs end as `Lease expired (max retries reached)`). Adding a 2 GB swap file is a
good safety net.

```bash
# On the Droplet
curl -fsSL https://get.docker.com | sh
git clone https://github.com/faizullahmd/rebx.git
cd rebx/worker/video-renderer

cp .env.example .env.worker
nano .env.worker          # set RENDER_WORKER_SECRET (same as step 2); check RENDER_API_BASE_URL

docker compose up -d --build
docker compose logs -f
```

Expected log lines:

- `Checked local FFmpeg/FFprobe availability` with `ffmpegAvailable: true`
- `REBX video renderer worker started` with `processingEnabled: true`

The container restarts automatically (`restart: unless-stopped`), including after a reboot.
No inbound ports are needed; the Droplet only makes outbound HTTPS calls to `rebx.app`.

### Updating the worker

```bash
cd rebx && git pull
cd worker/video-renderer && docker compose up -d --build
```

On stop, the worker finishes releasing its job lease (up to 30 s) before exiting.

## Alternative: App Platform worker component

Add a **Worker** component to the app (it has no HTTP port) built from this folder:

```yaml
workers:
  - name: video-renderer
    github:
      repo: faizullahmd/rebx
      branch: main
      deploy_on_push: true
    source_dir: worker/video-renderer
    dockerfile_path: worker/video-renderer/Dockerfile
    instance_size_slug: apps-d-2vcpu-4gb   # use ≥ 2 vCPU / 4 GB; check current slugs in the DO console
    instance_count: 1
    envs:
      - key: RENDER_WORKER_SECRET
        scope: RUN_TIME
        type: SECRET
        value: <secret>
      - key: RENDER_API_BASE_URL
        value: https://rebx.app
      - key: RENDER_WORKER_ID
        value: rebx-render-worker-1
      - key: RENDER_WORKER_PROCESSING_ENABLED
        value: "true"
```

Redeploys on every push to `main` are wasteful for a CPU-heavy worker; consider
`deploy_on_push: false`.

## Verify

1. Create a Video Studio project and click render. The job should move from `Pending` to
   processing with a rising percentage, then `Completed` with a downloadable MP4.
2. `docker compose logs -f` on the Droplet shows the claim, FFmpeg progress and upload.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Job stays `Pending` | Worker not running, `RENDER_WORKER_PROCESSING_ENABLED` not `true`, or wrong `RENDER_API_BASE_URL` |
| Worker logs `401`/`403`/`404` from REBX | `RENDER_WORKER_SECRET` differs between web app and worker, or `RENDER_WORKER_ENABLED` isn't `true` on the web app |
| Startup logs `ffmpegAvailable: false` | Image built without FFmpeg; rebuild (`docker compose build --no-cache`) |
| Render killed after 5 min | Raise `RENDER_FFMPEG_TIMEOUT_MS` in `.env.worker` |
| `Lease expired (max retries reached)` / out-of-memory | Check `dmesg -T \| grep -i "out of memory"`. Use a Droplet with ≥ 4 GB RAM (resize in the DO console) and add swap; keep scratch space on disk, not tmpfs |
| Indic captions show boxes | Rebuild the image (needs `fonts-noto-core`) |

To change a worker setting, edit `.env.worker` then run `docker compose up -d`.
