export interface StashScene {
  id: string;
  title: string;
  files: StashFile[];
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface StashFile {
  id: string;
  path: string;
}

export interface ProbeResponse {
  ok: boolean;
  scene_id?: string;
  mode?: string[];
  path_mapped?: boolean;
  duration_seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  error?: string;
}

export interface PathMapping {
  from: string;
  to: string;
}

export interface Config {
  stashGraphqlUrl: string;
  stashApiKey: string;
  stashInsecureTls: boolean;
  pathMappings: PathMapping[];
  mediaRoot: string;
  agentBaseUrl: string;
  hlsCacheDir: string;
  ffmpegPath: string;
  hwaccel: 'none' | 'auto' | 'vaapi' | 'qsv' | 'nvenc';
  hlsSegmentDuration: number;
  hlsStartupSegmentDuration: number;
  hlsVariantWaitMs: number;
  hlsVariantPollMs: number;
  port: number;
  agentSharedToken?: string;
  corsAllowedOrigins: true | string[];
}

export interface RangeRequest {
  start?: number;
  end?: number;
}

export interface HLSProfile {
  id: string;
  label: string;
  width: number;
  height: number;
  videoBitrateKbps: number;
  bandwidthKbps: number;
}
