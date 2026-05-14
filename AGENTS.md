# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What This Is

A system for offloading video playback from [Stash](https://github.com/stashapp/stash) to an external Kubernetes-hosted transcoding agent. The Stash UI plugin replaces the built-in player with an external one; the agent resolves scene IDs via Stash's GraphQL API, maps file paths, and serves video directly or via HLS.

## Commands

```bash
# Install all workspace dependencies
npm run install-all

# Agent
npm -w agent run dev          # Watch mode (tsx)
npm -w agent run build        # Compile TypeScript → dist/
npm -w agent run test         # Run tests (watch)
npm -w agent run test:run     # Run tests once
npm -w agent run lint

# Plugin
npm -w plugin run build       # Bundle → plugin-source/ and docs/ (zip + index.yml)
npm -w plugin run test        # Run tests (watch)
npm -w plugin run test:run    # Run tests once
npm -w plugin run lint

# From root
npm run test:agent
npm run test:plugin
npm run build:agent
npm run build:plugin
```

## Architecture

### Two workspaces

**`agent/`** — Fastify HTTP server (Node.js, TypeScript, ESM). Runs in Docker/Kubernetes.

- `src/index.ts` — Route definitions; top-level wiring of config, stashClient, pathMapper, authValidator, hlsStream
- `src/config.ts` — Loads and validates env vars via Zod; required: `STASH_GRAPHQL_URL`, `STASH_API_KEY`, `MEDIA_ROOT`, `AGENT_BASE_URL`, `HLS_CACHE_DIR`
- `src/stashClient.ts` — GraphQL queries to Stash to resolve scene metadata (ID → file path, width, height, fps, duration)
- `src/pathMapper.ts` — Maps Stash container paths to agent/NAS paths using `PATH_MAPPINGS` env var; enforces `MEDIA_ROOT` prefix to prevent traversal
- `src/hlsStream.ts` — FFmpeg-based HLS transcoding with multiple quality profiles (`DEFAULT_HLS_PROFILES`), startup segment optimization, and caching; exposes `getMasterPlaylist`, `getVariantPlaylist`, `getSegment`, `cleanupOldTranscodes`
- `src/directStream.ts` — Range-request-aware file serving helpers
- `src/auth.ts` — Optional shared-token validation (query param `?token=`)

**`plugin/`** — Stash UI plugin (React, TypeScript, bundled to IIFE by esbuild).

- `src/index.ts` — Plugin entry point; registers `ScenePlayerPatch` as the Stash scene player replacement
- `src/externalTranscodePlayer.tsx` — `ScenePlayerPatch` component: probes the agent, decides whether to use external or fallback player
- `src/ExternalVideoPlayer.tsx` — hls.js-based video player with quality selector
- `src/stashApi.ts` — Plugin-side helpers: `probeExternalAgent`, `buildPlaybackUrl`
- `src/settings.ts` — Reads plugin settings from Stash config (base URL, playback mode, path patterns, token, debug flag)
- `src/runtime.ts` — Injects Stash runtime globals (`React`, `GQL`) so the bundle doesn't duplicate them

**`plugin-source/`** — Output of `npm -w plugin run build`. Contains the installable zip and `index.yml` plugin source manifest. The `docs/` directory (also generated) is served via GitHub Pages as the public plugin source URL.

### Request flow

```
Browser → Stash UI (plugin) → probe /stash/scene/:id/probe
                             → if ok: play /stash/scene/:id/master.m3u8 or /direct
                             → if fail: fall back to Stash player

Agent:  probe/direct/HLS → stashClient.getScene(id) → pathMapper.map(file.path) → serve file
```

### HLS variant lifecycle

The variant playlist endpoint (`/stash/scene/:id/variant/:profile/master.m3u8`) returns `503 Retry-After` (`VariantPlaylistNotReadyError`) while the first segments are being transcoded. The plugin retries. Transcode jobs are keyed by `sceneId + profile`; segments are cached in `HLS_CACHE_DIR` and cleaned up on a 30-minute interval.

### Plugin distribution

`npm -w plugin run build` (via `build.mjs`) bundles the plugin, zips it with the manifest, updates `plugin-source/index.yml`, and copies both to `docs/`. Stash installs the plugin by fetching `docs/index.yml` from GitHub Pages. Version is hardcoded in `build.mjs`.
