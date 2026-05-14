import type { HLSProfile } from '../types.js';

export const DEFAULT_HLS_PROFILES: HLSProfile[] = [
  { id: '4320p', label: '4320p', width: 7680, height: 4320, videoBitrateKbps: 35000, bandwidthKbps: 42000 },
  { id: '2160p', label: '2160p', width: 3840, height: 2160, videoBitrateKbps: 16000, bandwidthKbps: 19200 },
  { id: '1440p', label: '1440p', width: 2560, height: 1440, videoBitrateKbps: 9000, bandwidthKbps: 10800 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080, videoBitrateKbps: 6000, bandwidthKbps: 6800 },
  { id: '720p',  label: '720p',  width: 1280, height: 720,  videoBitrateKbps: 3500, bandwidthKbps: 4200 },
  { id: '480p',  label: '480p',  width: 854,  height: 480,  videoBitrateKbps: 1800, bandwidthKbps: 2200 },
];
