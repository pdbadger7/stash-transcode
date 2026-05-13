# Integration Testing Guide

## Quick Start

### 1. Build the Agent

```bash
npm -w agent run build
```

Expected output:
```
✓ TypeScript compilation succeeds with no errors
```

### 2. Run Unit Tests

```bash
npm -w agent run test:run
npm -w plugin run test:run
```

Expected output:
```
Test Files  2 passed (2)
Tests  15 passed (15)
```

### 3. Start Local Agent (with Docker)

```bash
# Copy example config and set variables
export STASH_API_KEY="your-stash-api-key"
export STASH_GRAPHQL_URL="https://stash.home/graphql"  # or http://localhost:9999/graphql
export STASH_INSECURE_TLS="false"

# Build Docker image
docker build -t stash-transcode-agent:latest ./agent

# Or use docker-compose
docker-compose -f docker-compose.example.yml up -d
```

### 4. Test Health Endpoint

```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "ok": true,
  "timestamp": "2024-05-13T12:34:56.789Z"
}
```

### 5. Test Probe Endpoint

Replace `123` with a real scene ID from your Stash instance:

```bash
curl http://localhost:8080/stash/scene/123/probe
```

Expected response (success):
```json
{
  "ok": true,
  "scene_id": "123",
  "mode": ["direct", "hls"],
  "path_mapped": true
}
```

Or (failure):
```json
{
  "ok": false,
  "error": "Scene not found in Stash"
}
```

### 6. Test Direct Playback

```bash
# Full file
curl -o /tmp/video.mkv 'http://localhost:8080/stash/scene/123/direct'

# With Range request (first 10MB)
curl -H 'Range: bytes=0-10485759' \
  -o /tmp/video-chunk.mkv \
  'http://localhost:8080/stash/scene/123/direct'
```

### 6b. Test HLS Transcoding (Phase 2)

```bash
# Get HLS master playlist
curl 'http://localhost:8080/stash/scene/123/master.m3u8' -o /tmp/master.m3u8
cat /tmp/master.m3u8

# Get a segment (starts FFmpeg transcoding if not already running)
curl 'http://localhost:8080/stash/scene/123/segment/segment_000.ts' -o /tmp/segment_000.ts

# Monitor HLS cache directory
ls -la /cache/hls/123/
```

### 7. Install Stash Plugin

1. Open **Settings → Plugins** in Stash
2. Add a plugin source URL:
   ```text
   https://raw.githubusercontent.com/<your-user>/<your-repo>/<branch>/docs/index.yml
   ```
3. Install **External Transcode Player** from the source
4. Configure plugin settings

### 8. Test in Stash UI

1. Open `https://stash.home`
2. Navigate to any scene
3. Open browser console (F12)
4. Look for `[ExternalVideoPlayer]` or `[ScenePlayerPatch]` logs
5. Verify video plays via external player

### 9. Test Fallback

1. Stop the agent: `docker-compose down`
2. Refresh the scene page in Stash
3. Confirm original Stash player is used
4. Check browser console for fallback messages

## Environment-Specific Notes

### Using Mock Stash (for testing without real Stash)

The agent requires Stash GraphQL API. For testing:

1. Start a mock server or use your existing Stash
2. Set `STASH_GRAPHQL_URL` correctly
3. Ensure `STASH_API_KEY` is valid

### Docker vs Local

**Docker:**
```bash
docker run -e STASH_GRAPHQL_URL=http://host.docker.internal:9999/graphql \
  stash-transcode-agent:latest
```

**Local (Node.js):**
```bash
npm -w agent run dev
```

## What's New in Phase 2

### HLS Transcoding

The agent now supports HLS transcoding via FFmpeg:

1. **GET /stash/scene/:id/master.m3u8** - Generates HLS master playlist
   - Spawns FFmpeg on-demand
   - Caches segments in `/cache/hls/:id/`
   - Returns placeholder while transcoding

2. **GET /stash/scene/:id/segment/:segmentName** - Serves HLS segments
   - Prevents directory traversal attacks
   - Returns cached segments with caching headers
   - Supports path traversal prevention

3. **FFmpeg Integration**
   - Configurable hardware acceleration (VAAPI, QSV, NVENC, none)
   - Process management (tracks active transcoding)
   - Segment caching with automatic cleanup (24-hour default)

### Testing HLS

1. Test with mock segment:
   ```bash
   # Create a test segment
   echo "test" > /tmp/test-segment.ts
   mkdir -p /cache/hls/123
   cp /tmp/test-segment.ts /cache/hls/123/segment_000.ts
   
   # Retrieve it
   curl 'http://localhost:8080/stash/scene/123/segment/segment_000.ts'
   ```

2. Test with real FFmpeg:
   ```bash
   # Create a simple test video
   ffmpeg -f lavfi -i testsrc=duration=10:size=320x240 -f lavfi -i sine=frequency=1000:duration=10 /tmp/test.mkv
   
   # Place it in media root
   cp /tmp/test.mkv /mnt/nas/media/test.mkv
   
   # Configure Stash with this video (or mock GraphQL)
   # Request HLS: curl 'http://localhost:8080/stash/scene/123/master.m3u8'
   ```

## Fixed Issues

### Critical HTTPS Bug (Phase 2)

**Issue**: Agent failed on GraphQL queries with `ERR_INVALID_ARG_TYPE` when `STASH_INSECURE_TLS=true`

**Root Cause**: Passing plain object `{ rejectUnauthorized: false }` as httpsAgent to axios

**Fix**: Import `https` module and create proper `https.Agent` instance
```typescript
import https from 'https';

// Before (broken):
httpsAgent: this.insecureTls ? { rejectUnauthorized: false } : undefined,

// After (fixed):
this.httpsAgent = insecureTls ? new https.Agent({ rejectUnauthorized: false }) : undefined;
```

## Troubleshooting

- **Agent won't start**: Check environment variables, especially `STASH_API_KEY`
- **GraphQL errors**: Verify Stash URL and API key. If using self-signed cert, set `STASH_INSECURE_TLS=true`
- **Path mapping fails**: Check `PATH_MAPPINGS` format and `MEDIA_ROOT`
- **CORS errors**: Verify `CORS_ALLOWED_ORIGINS` includes Stash URL
- **HLS errors**: Check FFmpeg is installed (`which ffmpeg`), verify `/cache/hls` is writable
- **No segments generated**: Check FFmpeg logs, ensure input file is valid media format
- **Segments not serving**: Verify path traversal prevention (check logs if DEBUG=true)

## Next Steps After Phase 2 Verification

See README.md for:
- Full configuration guide
- Production deployment
- Future improvements (Phase 3+)
- Known limitations and roadmap
