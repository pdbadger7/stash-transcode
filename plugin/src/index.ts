import { PluginApi, React } from './runtime.js';
import { ScenePlayerPatch } from './externalTranscodePlayer.js';
import type { StashScene } from './types.js';
import type { PluginSettings } from './types.js';

type ScenePlayerProps = {
  scene?: StashScene;
  settings?: Partial<PluginSettings> | null;
  pluginSettings?: Partial<PluginSettings> | null;
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
      settings: props?.settings ?? props?.pluginSettings,
    });
  }
);
