import type { PlaybackStrategy, PluginSettings } from './types.js';

export const DEFAULT_SETTINGS: PluginSettings = {
  externalTranscodeBaseUrl: 'https://video.home',
  playbackMode: 'direct',
  playbackPriority: ['remux-hls', 'hls', 'direct', 'stash'],
  directPathPattern: '/stash/scene/{id}/direct',
  remuxHlsPathPattern: '/stash/scene/{id}/remux/master.m3u8',
  hlsPathPattern: '/stash/scene/{id}/master.m3u8',
  fallbackToStashPlayer: true,
  externalPlayerUrlTemplate: '',
  sharedToken: '',
  debug: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeSettings(
  settings?: Partial<PluginSettings> | null
): PluginSettings {
  const legacyHlsPathPattern = settings?.hlsPathPattern;
  const legacyRemuxPath =
    legacyHlsPathPattern && isRemuxPathPattern(legacyHlsPathPattern)
      ? legacyHlsPathPattern
      : undefined;
  const playbackMode = settings?.playbackMode === 'hls' ? 'hls' : 'direct';

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    playbackMode,
    playbackPriority: normalizePlaybackPriority(settings, playbackMode, legacyRemuxPath),
    remuxHlsPathPattern:
      settings?.remuxHlsPathPattern ?? legacyRemuxPath ?? DEFAULT_SETTINGS.remuxHlsPathPattern,
    hlsPathPattern:
      legacyRemuxPath && !settings?.remuxHlsPathPattern
        ? DEFAULT_SETTINGS.hlsPathPattern
        : settings?.hlsPathPattern ?? DEFAULT_SETTINGS.hlsPathPattern,
    externalPlayerUrlTemplate: settings?.externalPlayerUrlTemplate ?? '',
  };
}

function normalizePlaybackPriority(
  settings: Partial<PluginSettings> | null | undefined,
  playbackMode: PluginSettings['playbackMode'],
  legacyRemuxPath?: string
): PlaybackStrategy[] {
  const rawPriority = settings?.playbackPriority as unknown;
  const values = Array.isArray(rawPriority)
    ? rawPriority
    : typeof rawPriority === 'string'
      ? rawPriority.split(',')
      : undefined;
  const normalized = values
    ?.map((value) => String(value).trim().toLowerCase())
    .filter((value): value is PlaybackStrategy =>
      value === 'remux-hls' || value === 'hls' || value === 'direct' || value === 'stash'
    );

  if (normalized?.length) {
    return Array.from(new Set(normalized));
  }

  if (settings?.playbackMode) {
    if (playbackMode === 'hls') {
      return legacyRemuxPath ? ['remux-hls', 'hls', 'direct', 'stash'] : ['hls', 'direct', 'stash'];
    }
    return ['direct', 'hls', 'stash'];
  }

  return DEFAULT_SETTINGS.playbackPriority;
}

function isRemuxPathPattern(pathPattern: string): boolean {
  return /(^|\/)remux(\/|$)/.test(pathPattern);
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
