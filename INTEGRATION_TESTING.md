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

### 7. Install Stash Plugin

1. Copy plugin files to Stash plugins directory
2. Restart Stash
3. Enable in Settings → Plugins
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

## Troubleshooting

- **Agent won't start**: Check environment variables, especially `STASH_API_KEY`
- **GraphQL errors**: Verify Stash URL and API key
- **Path mapping fails**: Check `PATH_MAPPINGS` format and `MEDIA_ROOT`
- **CORS errors**: Verify `CORS_ALLOWED_ORIGINS` includes Stash URL
- **HLS not working yet**: Direct playback only in MVP

## Next Steps After MVP Verification

See README.md for:
- Full configuration guide
- Production deployment
- Phase 2 (HLS transcoding)
- Known limitations and roadmap
