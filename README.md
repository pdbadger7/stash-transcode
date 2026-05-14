# Stash External Transcode

A proof-of-concept system for offloading video playback from Stash to an external Kubernetes-hosted transcoding service, while keeping Stash as the UI and catalog.

## Overview

```
┌─────────────────────┐
│  Browser            │
│  https://stash.home │
└──────────┬──────────┘
           │
           ├──────────────────────────────────┐
           │                                  │
           ▼                                  ▼
    ┌────────────────┐            ┌──────────────────────┐
    │  Stash UI      │            │ External Transcoder  │
    │  + Plugin      │◄──────────►│ https://video.home   │
    │  Catalog/Auth  │ GraphQL +  │ Scene resolution +   │
    │                │ Path info  │ Video playback       │
    └────────────────┘            └──────────────────────┘
           │                              │
           │                              │
           └──────────────────┬───────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  NAS/Media Store │
                    │  /data or mounted│
                    │  via /mnt/nas    │
                    └──────────────────┘
```

### Why This Architecture?

1. **Scene IDs, Not Paths**: The plugin uses scene IDs as the contract with the agent. Raw file paths never appear in the browser URL bar or requests. This improves security and maintainability.
2. **Stash as Source of Truth**: Stash remains the authoritative source for scene metadata. The external agent queries Stash to resolve scene details and find the file path.
3. **Path Mapping Server-Side**: Path mapping (e.g., `/data/` → `/mnt/nas/media/`) happens only on the agent, not in the browser.
4. **Fallback Support**: If the agent is unavailable, the plugin automatically falls back to the original Stash player.

## Features (MVP + Phase 2)

- ✅ **Direct playback** with HTTP Range request support
- ✅ **Scene resolution** via Stash GraphQL API
- ✅ **Path mapping** with traversal prevention
- ✅ **Simple authentication** (optional shared token)
- ✅ **CORS support** for browser playback
- ✅ **Probe endpoint** to check agent availability
- ✅ **Fallback to original player** on error
- ✅ **HLS transcoding** with ffmpeg (Phase 2)
- ✅ **Hardware acceleration** support when available (VAAPI, QSV, NVENC)
- ⏳ **Quality selector** and adaptive bitrate

## Project Structure

```
stash-external-transcode/
├── README.md
├── package.json
├── docker-compose.example.yml
├── plugin/
│   ├── external-transcode-player.yml   # Stash plugin manifest
│   ├── package.json
│   ├── tsconfig.json
│   ├── tests/
│   │   └── stashApi.test.ts
│   └── src/
│       ├── types.ts
│       ├── stashApi.ts
│       ├── runtime.ts
│       ├── index.ts
│       ├── ExternalVideoPlayer.tsx
│       └── externalTranscodePlayer.tsx
├── plugin-source/
│   ├── index.yml                      # Stash UI plugin source index
│   └── packages/
│       └── external-transcode-player-0.1.0.zip
├── agent/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── tests/
│   │   ├── pathMapper.test.ts
│   │   ├── directStream.test.ts
│   │   └── hlsStream.test.ts
│   └── src/
│       ├── index.ts
│       ├── config.ts
│       ├── types.ts
│       ├── stashClient.ts
│       ├── pathMapper.ts
│       ├── directStream.ts
│       ├── hlsStream.ts
│       └── auth.ts
└── k8s/
    ├── configmap.yaml
    ├── secret.example.yaml
    ├── deployment.yaml
    ├── service.yaml
    └── ingress.yaml
```

## Installation

### Prerequisites

- **Stash** instance running with GraphQL API enabled
- **Stash API key** (create in Stash settings)
- **Node.js 18+** (for building)
- **Docker** (for running agent locally)
- **Kubernetes cluster** (for production deployment)

### Step 1: Obtain Stash API Key

1. Open your Stash UI
2. Go to Settings → API
3. Generate an API key
4. Copy it somewhere safe

### Step 2: Install the Stash UI Plugin

1. Open Stash and go to **Settings → Plugins**
2. Under **Available Plugins**, add a new source with this URL:
   ```text
   https://raw.githubusercontent.com/<your-user>/<your-repo>/main/docs/index.yml
   ```
   This is the stable plugin source URL; the file itself updates as new packages are published.
3. Install **External Transcode Player** from that source
4. Configure plugin settings:
   - **External Transcoder Base URL**: `https://video.home` (or your agent URL)
   - **Playback Mode**: `direct` (for MVP)
   - **Direct Playback Path Pattern**: `/stash/scene/{id}/direct`
   - **HLS Playback Path Pattern**: `/stash/scene/{id}/master.m3u8`
   - **Probe Before Replace**: `true`
   - **Fallback to Stash Player**: `true`
   - **Shared Token**: Optional, set if agent requires authentication
   - **Debug Logging**: `false`

### Step 3: Deploy the Agent

#### Option A: Docker Compose (Local Development)

```bash
# Copy the example config
cp docker-compose.example.yml docker-compose.yml

# Set required environment variables
export STASH_API_KEY="your-stash-api-key-here"
export STASH_GRAPHQL_URL="https://stash.home/graphql"

# Start the agent
docker-compose up -d

# Verify
curl http://localhost:8080/health
```

#### Option B: Kubernetes (Production)

1. **Create namespace and secrets:**
   ```bash
   kubectl create namespace stash
   
   # Copy and edit secrets
   cp k8s/secret.example.yaml k8s/secret.yaml
   # Edit with your Stash API key and optional token
   
   kubectl apply -f k8s/secret.yaml
   ```

2. **Create ConfigMap:**
   ```bash
   kubectl apply -f k8s/configmap.yaml
   ```

3. **Build and push the agent image:**
   ```bash
   docker build -t your-registry/stash-transcode-agent:latest ./agent
   docker push your-registry/stash-transcode-agent:latest
   
   # Update k8s/deployment.yaml image reference
   ```

4. **Deploy:**
   ```bash
   kubectl apply -f k8s/deployment.yaml
   kubectl apply -f k8s/service.yaml
   kubectl apply -f k8s/ingress.yaml
   ```

5. **Verify:**
   ```bash
   kubectl port-forward svc/agent 8080:80 -n stash
   curl http://localhost:8080/health
   ```

## Configuration

### Agent Environment Variables

```bash
# Stash connection
STASH_GRAPHQL_URL=https://stash.home/graphql
STASH_API_KEY=your-api-key
STASH_INSECURE_TLS=false                    # Set true for self-signed certs (not recommended)

# Path mapping (container path -> agent/NAS path)
PATH_MAPPINGS=/data/=/mnt/nas/media/
MEDIA_ROOT=/mnt/nas/media                   # Must match the "to" path in mappings

# Agent settings
AGENT_BASE_URL=https://video.home           # Used for fallback/docs
HLS_CACHE_DIR=/cache/hls                    # For HLS segments (Phase 2)
FFMPEG_PATH=/usr/bin/ffmpeg                 # For HLS transcoding (Phase 2)
HWACCEL=auto                                # none|auto|vaapi|qsv|nvenc
HWACCEL_DEVICE=/dev/dri/renderD128          # VAAPI/QSV render device when HWACCEL uses /dev/dri
HLS_SEGMENT_DURATION=4                      # Main HLS segment duration (seconds)
REMUX_HLS_VIDEO_CODECS=h264,hevc            # Video codecs eligible for copy-only fMP4 HLS
REMUX_HLS_READ_RATE=0                       # Optional FFmpeg input pacing; 0 = unlimited, 1 = realtime
REMUX_HLS_START_OFFSET_SECONDS=0.15         # Avoid hls.js stalls when copied media starts after 0
REMUX_HLS_READY_TIMEOUT_MS=30000            # How long remux endpoints wait for playlist/assets
HLS_STARTUP_SEGMENT_DURATION=1              # Short startup segment target (seconds)
HLS_VARIANT_WAIT_MS=30000                   # Wait for first media segments before returning 503
HLS_VARIANT_POLL_MS=250                     # Poll interval while waiting for first segments
PORT=8080

# Security
AGENT_SHARED_TOKEN=optional-secret          # If set, requests must include token
CORS_ALLOWED_ORIGINS=*                      # Optional: "*" (or unset) allows all origins dynamically
```

### Path Mapping Examples

**Single mapping:**
```
PATH_MAPPINGS=/data/=/mnt/nas/media/
```

**Multiple mappings:**
```
PATH_MAPPINGS=/data/=/mnt/nas/media/,/internal/=/external/
```

The agent will try each mapping in order. The first match wins. Each path in the mapped result must be inside MEDIA_ROOT.

## API Endpoints

### GET /health

Health check endpoint.

```bash
curl https://video.home/health
```

Response:
```json
{
  "ok": true,
  "timestamp": "2024-05-13T12:34:56.789Z"
}
```

### GET /stash/scene/:id/probe

Check if a scene can be served by the agent.

```bash
curl 'https://video.home/stash/scene/123/probe?token=secret'
```

Response (success):
```json
{
  "ok": true,
  "scene_id": "123",
  "mode": ["direct", "hls"],
  "path_mapped": true
}
```

Response (failure):
```json
{
  "ok": false,
  "error": "Scene not found in Stash"
}
```

### GET /stash/scene/:id/direct

Direct playback with HTTP Range request support.

```bash
# Full file
curl 'https://video.home/stash/scene/123/direct?token=secret' \
  -o video.mkv

# Range request (first 1MB)
curl 'https://video.home/stash/scene/123/direct?token=secret' \
  -H 'Range: bytes=0-1048575'
```

Returns HTTP 206 (Partial Content) for Range requests.

### GET /stash/scene/:id/master.m3u8

Adaptive HLS master manifest.

```bash
curl 'https://video.home/stash/scene/123/master.m3u8?token=secret&quality=720p'
```

### GET /stash/scene/:id/remux/master.m3u8

Copy-only fMP4 HLS for already-compatible sources. This remuxes allowlisted video
codecs such as H.264 and HEVC without scaling, filtering, or video encoding.

```bash
curl 'https://video.home/stash/scene/123/remux/master.m3u8?token=secret'
```

Returns HTTP 422 when the source codec is not eligible and HTTP 503 with
`Retry-After` while the remux playlist or segment is still being prepared.

### GET /stash/scene/:id/variant/:profile/master.m3u8

Profile-specific media playlist.

```bash
curl 'https://video.home/stash/scene/123/variant/720p/master.m3u8?token=secret'
```

### GET /stash/scene/:id/variant/:profile/:segmentName

Profile-specific HLS segment file.

```bash
curl 'https://video.home/stash/scene/123/variant/720p/segment_000.ts?token=secret'
```

## Testing

### Unit Tests

```bash
# Agent tests
npm -w agent run test

# Plugin tests
npm -w plugin run test
```

### Integration Testing

1. **Start agent:**
   ```bash
   docker-compose up -d
   ```

2. **Test health endpoint:**
   ```bash
   curl http://localhost:8080/health
   ```

3. **Test probe (replace with real scene ID):**
   ```bash
   curl http://localhost:8080/stash/scene/1/probe
   ```

4. **Test direct playback:**
   ```bash
   curl -o /tmp/video.mkv \
     'http://localhost:8080/stash/scene/1/direct'
   
   # Or with Range header
   curl -o /tmp/video-chunk.mkv \
     -H 'Range: bytes=0-10485760' \
     'http://localhost:8080/stash/scene/1/direct'
   ```

5. **Open Stash UI:**
   - Navigate to `https://stash.home`
   - Open a scene page
   - Check browser console for plugin debug logs
   - Verify video plays using external player

6. **Test fallback:**
   - Stop the agent: `docker-compose down`
   - Refresh scene page in Stash
   - Confirm original player is used

## Security Considerations

### LAN-Only Deployment

**This system is designed for LAN/home use only.** It provides:

- ✅ Basic path traversal prevention
- ✅ Optional shared token
- ❌ **No authentication** (bearer tokens are basic)
- ❌ **No encryption** beyond TLS layer
- ❌ **No audit logging**
- ❌ **No rate limiting**

**Do not expose to the internet without:**
- Proper authentication (OAuth, etc.)
- HTTPS with valid certificates
- Network segmentation / VPN
- Rate limiting / DDoS protection
- Comprehensive audit logging
- Intrusion detection

### Token Security

The `AGENT_SHARED_TOKEN` is transmitted as:

1. **Query parameter** for video playback: `?token=...` — **visible in browser history and server logs**
2. Not sent to Stash GraphQL queries — agent uses `STASH_API_KEY` instead

For production, implement proper session-based authentication (TODO).

### Path Traversal Prevention

The agent validates:

1. Mappings succeed and result in a path inside MEDIA_ROOT
2. Paths are normalized to remove `..` and `.` sequences
3. Final path must start with MEDIA_ROOT prefix

### CORS Policy

By default, the agent allows all origins dynamically (no host hardcoding).  
Optionally set `CORS_ALLOWED_ORIGINS` to a comma-separated allowlist if you want to restrict it:

```bash
CORS_ALLOWED_ORIGINS=https://stash.home,https://stash.example.com
```

## Troubleshooting

### "External agent unavailable"

1. Check agent is running: `curl https://video.home/health`
2. Check Stash can reach agent: Verify network connectivity and firewall rules
3. Check CORS headers: Browser console should show any CORS errors
4. Check agent logs for errors: `docker-compose logs agent`

### "Path mapping failed"

1. Verify `PATH_MAPPINGS` environment variable is set correctly
2. Check `MEDIA_ROOT` matches the target of your mappings
3. Verify media file exists at the NAS mount path
4. Check agent can read the file: `ls -la <mapped-path>`

### Probe returns 404 but file exists

1. Verify scene ID is correct in Stash
2. Check Stash API key is valid
3. Check Stash GraphQL URL is correct
4. Try direct GraphQL query to Stash to debug
5. Check agent logs for GraphQL query errors

### Video doesn't play

1. Open browser console (F12) for errors
2. Check Content-Type header is correct (should be video/* for direct)
3. Try direct curl test: `curl http://video.home/stash/scene/1/direct`
4. Verify player supports video codec (check devtools Network tab)
5. If you see a CSP `media-src` error for an external URL, switch plugin playback mode to `hls` and reinstall/update the plugin package so the manifest `ui.csp.connect-src` override is applied

### Build fails

```bash
# Ensure dependencies are installed
npm install

# Clean build
npm -w agent run build
npm -w plugin run test
```

## Known Limitations

1. **Plugin Distribution**: Stash installs the plugin from the published source YAML, which points at a packaged zip containing the manifest and browser bundle.

2. **No Resume Sync**: Playback position is not synced back to Stash. Implemented as local browser storage only.

3. **No Authentication System**: Uses basic shared token. Not suitable for multi-user or internet-facing deployments.

4. **Stash Version**: Built for Stash v3. GraphQL schema may vary by version — query may need adjustment.

5. **Hardware Acceleration Is Opportunistic**: The agent uses VAAPI/QSV/NVENC when available and falls back to software encoding when not.

## Roadmap

### Phase 2: HLS Streaming

- [x] FFmpeg-based HLS segment generation
- [x] Concurrent segment transcoding
- [x] Segment caching and cleanup
- [x] MIME type detection for segment selection

### Phase 3: Advanced Streaming

- [x] Adaptive bitrate (ABR) with multiple quality profiles
- [x] Hardware acceleration (VAAPI, QSV, NVENC)
- [x] Quality selector UI in player

## Development

### Building

```bash
# Install all dependencies
npm run install-all

# Build agent
npm -w agent run build

# Build plugin
npm -w plugin run test

# Run tests
npm run test:agent
npm run test:plugin
```

### Local Development

```bash
# Terminal 1: Watch agent code
npm -w agent run dev

# Terminal 2: Watch plugin tests
npm -w plugin run test

# Terminal 3: Run docker-compose
docker-compose up

# Terminal 4: Monitor agent logs
docker-compose logs -f agent
```

## Contributing

Contributions are welcome! Please:

1. Write tests for new features
2. Run linter: `npm run lint:agent`
3. Ensure tests pass: `npm run test:agent`
4. Keep changes focused and well-documented

## License

MIT (adjust as needed)

## Support

For issues, feature requests, or questions:

1. Check [Troubleshooting](#troubleshooting) section
2. Search existing GitHub issues
3. Check agent logs: `docker-compose logs agent`
4. Check browser console for plugin errors
5. Open an issue with: agent version, Stash version, error messages, and reproduction steps
