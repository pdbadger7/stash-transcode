# Changelog

## 0.3.0 - 2026-05-14

- Added copy-only fMP4 remux HLS endpoints under `/stash/scene/:id/remux/` for allowlisted source video codecs such as H.264 and HEVC.
- Added `REMUX_HLS_VIDEO_CODECS` and `REMUX_HLS_READY_TIMEOUT_MS` to control native/remux HLS eligibility and readiness waits.

## 0.2.2 - 2026-05-14

- Fixed VAAPI HLS transcoding arguments to initialize the configured `/dev/dri` device and use a VAAPI-safe upload/filter chain.
- Changed hardware acceleration fallback so a failed VAAPI segment falls back to software for that operation without disabling VAAPI for later transcodes.
