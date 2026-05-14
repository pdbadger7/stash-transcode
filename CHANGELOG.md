# Changelog

## 0.2.2 - 2026-05-14

- Fixed VAAPI HLS transcoding arguments to initialize the configured `/dev/dri` device and use a VAAPI-safe upload/filter chain.
- Changed hardware acceleration fallback so a failed VAAPI segment falls back to software for that operation without disabling VAAPI for later transcodes.
