# Copilot instructions for stash-transcode

## Repository shape

This is a two-package npm workspace:

- `agent/`: Fastify + ffmpeg-backed transcoding service
- `plugin/`: Stash UI plugin that patches `ScenePlayer`

The browser/plugin side works with **scene IDs only**. The agent resolves scene metadata from Stash GraphQL, maps the first file path server-side, and serves either direct file playback or HLS playlists/segments.

## Build, test, and lint

Root scripts:

- `npm run install-all`
- `npm run build:agent`
- `npm run build:plugin`
- `npm run test:agent`
- `npm run test:plugin`
- `npm run lint:agent`
- `npm run lint:plugin`

Single-test examples:

- Agent: `npm -w agent run test -- agent/tests/pathMapper.test.ts -t "should map basic paths"`
- Plugin: `npm -w plugin run test -- plugin/tests/stashApi.test.ts -t "should build direct playback URL"`

Package-specific scripts:

- `agent/`: `dev`, `build`, `start`, `test`, `test:run`, `lint`
- `plugin/`: `build`, `test`, `test:run`, `lint`

## Architecture to keep in mind

- `plugin/src/index.ts` patches `ScenePlayer` and decides whether to probe the external agent or fall back to the original Stash player.
- `plugin/src/stashApi.ts` builds playback URLs and probes `/stash/scene/:id/probe`.
- `agent/src/index.ts` exposes `/health`, `/stash/scene/:id/probe`, `/direct`, and HLS endpoints.
- `agent/src/stashClient.ts` is the only place that talks to Stash GraphQL.
- `agent/src/pathMapper.ts` is the security boundary between Stash container paths and NAS/media paths.
- `agent/src/hlsStream.ts` owns ffmpeg process spawning, playlist generation, segment caching, and hardware-acceleration fallback.

## Key conventions

- In `agent/`, keep TypeScript imports ESM-safe and include `.js` extensions in relative imports.
- In `plugin/`, import React and `PluginApi` from `./runtime.js`; do not import `react` directly.
- `PATH_MAPPINGS` is a comma-separated list of `from=to` pairs, and mapped paths must stay under `MEDIA_ROOT`.
- Keep raw file paths out of browser-visible URLs; scene IDs are the public contract.
- If a token is used, HLS playlist URIs must preserve it on every generated variant/segment link.
- Plugin settings normalize playback mode to either `direct` or `hls`; anything else resolves to `direct`.
- Tests live under `agent/tests/` and `plugin/tests/`, not co-located with source.
- `npm run build:plugin` packages the plugin for Stash distribution and regenerates `plugin-source/index.yml`; do not replace it with a plain bundle-only build.

## Configuration notes

Agent startup requires:

- `STASH_GRAPHQL_URL`
- `STASH_API_KEY`
- `MEDIA_ROOT`
- `AGENT_BASE_URL`
- `HLS_CACHE_DIR`

Useful optional settings include `STASH_INSECURE_TLS`, `PATH_MAPPINGS`, `AGENT_SHARED_TOKEN`, `CORS_ALLOWED_ORIGINS`, `FFMPEG_PATH`, and `HWACCEL`.
