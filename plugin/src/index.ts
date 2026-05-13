import { PluginApi, React } from './runtime.js';
import { ScenePlayerPatch } from './externalTranscodePlayer.js';
import type { StashScene } from './types.js';
import type { PluginSettings } from './types.js';

const defaultSettings: PluginSettings = {
  externalTranscodeBaseUrl: 'https://video.home',
  playbackMode: 'direct',
  directPathPattern: '/stash/scene/{id}/direct',
  hlsPathPattern: '/stash/scene/{id}/master.m3u8',
  probeBeforeReplace: true,
  fallbackToStashPlayer: true,
  sharedToken: '',
  debug: false,
};

function normalizeSettings(settings: Partial<PluginSettings> | undefined): PluginSettings {
  return {
    ...defaultSettings,
    ...settings,
    playbackMode: settings?.playbackMode === 'hls' ? 'hls' : 'direct',
  };
}

type ScenePlayerProps = {
  scene?: StashScene;
  settings?: Partial<PluginSettings>;
  pluginSettings?: Partial<PluginSettings>;
} & Record<string, unknown>;

PluginApi.patch.instead(
  'ScenePlayer',
  function (
    props: ScenePlayerProps,
    _: unknown,
    original: React.ComponentType<Record<string, unknown>>
  ) {
    return React.createElement(ScenePlayerPatch, {
      ...props,
      originalComponent: original,
      settings: normalizeSettings(props?.settings ?? props?.pluginSettings),
    });
  }
);
