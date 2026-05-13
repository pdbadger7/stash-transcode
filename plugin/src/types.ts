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
}

export type PlaybackQualityId = 'auto' | '1080p' | '720p' | '480p';

export interface PlaybackQuality {
  id: PlaybackQualityId;
  label: string;
}

export const PLAYBACK_QUALITIES: PlaybackQuality[] = [
  { id: 'auto', label: 'Auto' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
  { id: '480p', label: '480p' },
];
