# HLS Synthetic VOD Playlist Design

## Problem

External playback can require multiple reloads before playback starts, and HLS sometimes appears as live-like rather than a complete VOD timeline. Startup latency is impacted by segment availability and transcoding speed.

## Goals

1. Improve first-play reliability without waiting for a large amount of real transcoded output.
2. Provide a full VOD-style playlist timeline early when safe metadata is available.
3. Ensure advertised variant metadata (resolution/fps) does not exceed source capabilities.
4. Preserve schema compatibility across Stash versions.

## Constraints

- Stash GraphQL schemas vary across deployments.
- Some metadata fields may be unavailable and must not break playback.
- Segment serving remains authoritative: no fake media payloads.

## Chosen Approach

Use a **manifest-only synthetic VOD strategy** driven by Stash metadata:

- Query Stash scene metadata with a rich query first (`duration`, source `width/height`, source `fps`, file path).
- If unsupported fields fail, fallback to progressively smaller queries to keep compatibility.
- When duration is available, generate a synthetic VOD variant playlist:
  - full `#EXTINF` timeline from duration + segment duration,
  - `#EXT-X-ENDLIST` present,
  - segment URIs point to normal segment endpoints.
- Keep ffmpeg transcoding behavior as producer of real segments; no fake TS media segments.

## Variant Metadata Policy

- Master playlist `#EXT-X-STREAM-INF` should clamp variant metadata to source bounds:
  - do not advertise upscaled resolution above source resolution,
  - include source fps when available (clamped and rounded as needed).
- Keep bitrate profiles as configured.

## Error Handling

- If metadata query fields are unsupported, fallback query path preserves playback.
- If duration is missing, continue current readiness/wait behavior rather than synthetic full timeline.
- Missing segments remain 404 until generated; player retry behavior handles transient misses.

## Testing Plan

- Add/extend tests for:
  - metadata query fallback behavior across unsupported fields,
  - synthetic VOD playlist shape (`#EXTINF` sequence + `#EXT-X-ENDLIST`),
  - variant metadata clamping for resolution/fps,
  - token propagation and URI rewriting regression coverage.

## Out of Scope

- Fabricating actual media segment content.
- Full multi-bitrate transcoding pre-generation before playback.
