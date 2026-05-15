// Stash scene object interface
export interface StashScene {
  id: string;
  title: string;
  files?: StashFile[];
  duration?: number;
  width?: number;
  height?: number;
}

export interface StashFile {
  id: string;
  path: string;
}

// Plugin settings
export interface PluginSettings {
  externalTranscodeBaseUrl: string;
  playbackMode: 'direct' | 'hls';
  directPathPattern: string;
  hlsPathPattern: string;
  probeBeforeReplace: boolean;
  fallbackToStashPlayer: boolean;
  sharedToken?: string;
  debug: boolean;
}

export interface ProbeResponse {
  ok: boolean;
  error?: string;
  mode?: ProbePlaybackMode[];
}

export type ProbePlaybackMode = 'direct' | 'hls' | 'remux-hls';

export type PlaybackQualityId =
  | 'auto'
  | '4320p'
  | '2160p'
  | '1440p'
  | '1080p'
  | '720p'
  | '480p';

export interface PlaybackQuality {
  id: PlaybackQualityId;
  label: string;
}

export const PLAYBACK_QUALITIES: PlaybackQuality[] = [
  { id: 'auto', label: 'Auto' },
  { id: '4320p', label: '4320p' },
  { id: '2160p', label: '2160p' },
  { id: '1440p', label: '1440p' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
  { id: '480p', label: '480p' },
];
