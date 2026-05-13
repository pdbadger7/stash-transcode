export interface StashScene {
  id: string;
  title: string;
  files: StashFile[];
  duration?: number;
  width?: number;
  height?: number;
}

export interface StashFile {
  id: string;
  path: string;
  duration?: number;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
}

export interface ProbeResponse {
  ok: boolean;
  scene_id?: string;
  mode?: string[];
  path_mapped?: boolean;
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
  hwaccel: 'none' | 'vaapi' | 'qsv' | 'nvenc';
  port: number;
  agentSharedToken?: string;
  corsAllowedOrigins: string[];
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
