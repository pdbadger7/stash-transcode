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
  playbackPriority: PlaybackStrategy[];
  directPathPattern: string;
  remuxHlsPathPattern: string;
  hlsPathPattern: string;
  fallbackToStashPlayer: boolean;
  externalPlayerUrlTemplate: string;
  sharedToken?: string;
  debug: boolean;
}

export interface ProbeResponse {
  ok: boolean;
  error?: string;
  mode?: ProbePlaybackMode[];
}

export type ProbePlaybackMode = 'direct' | 'hls' | 'remux-hls';

export type PlaybackStrategy = ProbePlaybackMode | 'stash';

export type PlayerMode = 'direct' | 'hls';

export interface PlaybackPlan {
  id: ProbePlaybackMode;
  playerMode: PlayerMode;
  pathPattern: string;
  supportsQuality: boolean;
}

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
