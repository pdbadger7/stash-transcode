import type { PluginSettings } from './types.js';

export const DEFAULT_SETTINGS: PluginSettings = {
  externalTranscodeBaseUrl: 'https://video.home',
  playbackMode: 'direct',
  directPathPattern: '/stash/scene/{id}/direct',
  hlsPathPattern: '/stash/scene/{id}/master.m3u8',
  probeBeforeReplace: true,
  fallbackToStashPlayer: true,
  sharedToken: '',
  debug: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeSettings(
  settings?: Partial<PluginSettings> | null
): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    playbackMode: settings?.playbackMode === 'hls' ? 'hls' : 'direct',
  };
}

export function extractConfiguredSettings(
  configurationData: unknown
): Partial<PluginSettings> | undefined {
  if (!isRecord(configurationData)) {
    return undefined;
  }

  const configuration = configurationData.configuration;
  if (!isRecord(configuration)) {
    return undefined;
  }

  const plugins = configuration.plugins;
  if (!isRecord(plugins)) {
    return undefined;
  }

  const configured =
    plugins['external-transcode-player'] ?? plugins.externalTranscodePlayer;

  return isRecord(configured) ? (configured as Partial<PluginSettings>) : undefined;
}

export function resolveSettings(
  configurationData: unknown,
  overrides?: Partial<PluginSettings> | null
): PluginSettings {
  return normalizeSettings({
    ...extractConfiguredSettings(configurationData),
    ...overrides,
  });
}
