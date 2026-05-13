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
