# Changelog

## Plugin 0.1.6 - 2026-05-15

- Replace the single playback mode setting with ordered playback priority across `remux-hls`, `hls`, `direct`, and `stash`.
- Add a dedicated remux HLS path pattern and optional external-player URL buttons for the selected stream and direct stream.
- Try cross-origin direct playback through a best-effort MSE fetch path before reporting unsupported direct playback.

## 0.3.10 - 2026-05-15

- Return direct stream responses explicitly from the agent route so range and full-file direct responses are not dropped by the handler.

## Plugin 0.1.5 - 2026-05-15

- Force a scene probe when the configured HLS path points at remux so incompatible scenes can still fall back to standard HLS even if "Probe External Agent" is disabled.

## Plugin 0.1.4 - 2026-05-15

- Fall back from configured remux HLS to standard transcoded HLS when the agent probe does not advertise `remux-hls` for a scene.

## 0.3.9 - 2026-05-14

- Serve remux fMP4 assets from validated bytes instead of the Fastify file-stream path that could return empty `200 OK` responses in production.
- Treat completed remux caches with empty init or first segment assets as invalid so they are rebuilt before playback.

## 0.3.8 - 2026-05-14

- Wait for remux fMP4 playlists to include a ready `EXT-X-MAP` init segment and first media segment before serving them to hls.js.
- Avoid exposing empty remux assets while ffmpeg is still finalizing segment output.

## 0.3.4 - 2026-05-14

- Generate remux HLS playlists as `EVENT` playlists so playback can start once the first fMP4 segment is ready instead of waiting for full VOD remux completion.
- Add configurable `REMUX_HLS_START_OFFSET_SECONDS` and emit `EXT-X-START` by default to avoid hls.js stalls when copied fMP4 media begins slightly after zero.

## 0.3.3 - 2026-05-14

- Stream remux HLS assets from disk instead of buffering each fMP4 segment in memory before sending it.
- Added `REMUX_HLS_READ_RATE` to optionally pace initial copy-only remux jobs and reduce CPU/I/O bursts.

## 0.3.0 - 2026-05-14

- Added copy-only fMP4 remux HLS endpoints under `/stash/scene/:id/remux/` for allowlisted source video codecs such as H.264 and HEVC.
- Added `REMUX_HLS_VIDEO_CODECS` and `REMUX_HLS_READY_TIMEOUT_MS` to control native/remux HLS eligibility and readiness waits.

## 0.2.2 - 2026-05-14

- Fixed VAAPI HLS transcoding arguments to initialize the configured `/dev/dri` device and use a VAAPI-safe upload/filter chain.
- Changed hardware acceleration fallback so a failed VAAPI segment falls back to software for that operation without disabling VAAPI for later transcodes.
