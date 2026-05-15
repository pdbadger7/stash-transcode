import { React } from './runtime.js';
import { GQL } from './runtime.js';
import {
  buildPlaybackUrl,
  isRemuxPathPattern,
  probeExternalAgent,
  resolvePlaybackPlan,
} from './stashApi.js';
import { ExternalVideoPlayer } from './ExternalVideoPlayer.js';
import { buildOriginalPlayerProps } from './playerProps.js';
import { resolveSettings } from './settings.js';
import type {
  PlaybackQualityId,
  StashScene,
  PluginSettings,
  ProbeResponse,
} from './types.js';

const { useState, useEffect, useMemo } = React;

type ScenePlayerPatchProps = {
  scene?: StashScene;
  originalComponent: React.ComponentType<Record<string, unknown>>;
  settings?: Partial<PluginSettings> | null;
} & Record<string, unknown>;

/**
 * Scene player patch component
 * This wraps/replaces the original ScenePlayer when appropriate
 */
export const ScenePlayerPatch: React.FC<ScenePlayerPatchProps> = ({
  scene,
  originalComponent: OriginalPlayer,
  settings,
  ...playerProps
}) => {
  const { data: configurationData } = GQL.useConfigurationQuery();
  const resolvedSettings = useMemo(
    () => resolveSettings(configurationData, settings),
    [configurationData, settings]
  );
  const [useExternal, setUseExternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [externalMode, setExternalMode] = useState<PluginSettings['playbackMode']>(
    resolvedSettings.playbackMode
  );
  const [quality, setQuality] = useState<PlaybackQualityId>('auto');

  useEffect(() => {
    setQuality('auto');
  }, [scene?.id]);

  if (resolvedSettings.debug) {
    console.log('[ScenePlayerPatch] Rendering with scene:', scene?.id);
  }

  // Initialize external player on mount or when scene changes
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    if (!scene?.id) {
      if (resolvedSettings.debug) console.log('[ScenePlayerPatch] No scene ID');
      setUseExternal(false);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const initializeExternalPlayer = async () => {
      try {
        let probeResult: ProbeResponse | undefined;
        const mustProbeForRemuxFallback =
          resolvedSettings.playbackMode === 'hls' &&
          isRemuxPathPattern(resolvedSettings.hlsPathPattern);
        const shouldProbe = resolvedSettings.probeBeforeReplace || mustProbeForRemuxFallback;

        // Probe when enabled, or when a remux HLS path needs route selection.
        if (shouldProbe) {
          if (resolvedSettings.debug)
            console.log(`[ScenePlayerPatch] Probing scene ${scene.id}`);
          probeResult = await probeExternalAgent(
            resolvedSettings.externalTranscodeBaseUrl,
            scene.id,
            resolvedSettings.sharedToken,
            controller.signal
          );

          if (cancelled) {
            return;
          }

          if (!probeResult.ok) {
            if (resolvedSettings.debug)
              console.log('[ScenePlayerPatch] Probe failed:', probeResult.error);

            if (resolvedSettings.fallbackToStashPlayer) {
              setUseExternal(false);
              setError(null);
              return;
            }

            setError(probeResult.error || 'Probe failed');
            setUseExternal(false);
            return;
          }
        }

        const playbackPlan = resolvePlaybackPlan(resolvedSettings, probeResult);
        if (!playbackPlan) {
          if (resolvedSettings.debug) {
            console.log('[ScenePlayerPatch] No compatible external playback mode');
          }

          if (resolvedSettings.fallbackToStashPlayer) {
            setUseExternal(false);
            setError(null);
            return;
          }

          setError('No compatible external playback mode');
          setUseExternal(false);
          return;
        }

        const url = buildPlaybackUrl(
          resolvedSettings.externalTranscodeBaseUrl,
          playbackPlan.pathPattern,
          scene.id,
          resolvedSettings.sharedToken,
          quality
        );

        if (cancelled) {
          return;
        }

        if (resolvedSettings.debug)
          console.log('[ScenePlayerPatch] Using external player:', url);

        setPlaybackUrl(url);
        setExternalMode(playbackPlan.mode);
        setUseExternal(true);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }

        const message =
          err instanceof Error ? err.message : 'Unknown error';
        console.error('[ScenePlayerPatch] Error:', message);

        if (resolvedSettings.fallbackToStashPlayer) {
          setUseExternal(false);
          setError(null);
        } else {
          setError(message);
          setUseExternal(false);
        }
      }
    };

    initializeExternalPlayer();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scene?.id, quality, resolvedSettings]);

  // Handle playback error
  const handlePlaybackError = (err: Error) => {
    console.error('[ScenePlayerPatch] Playback error:', err.message);

    if (resolvedSettings.fallbackToStashPlayer) {
      if (resolvedSettings.debug)
        console.log('[ScenePlayerPatch] Falling back to original player');
      setUseExternal(false);
      setError(null);
    } else {
      setError(err.message);
    }
  };

  // Show error or use external player
  if (error && !resolvedSettings.fallbackToStashPlayer) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
          color: '#fff',
          padding: '1rem',
        }}
      >
        <div>
          <p>External playback error</p>
          <p style={{ fontSize: '0.9rem', color: '#ccc' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (useExternal && playbackUrl) {
    return (
      <ExternalVideoPlayer
        url={playbackUrl}
        mode={externalMode}
        title={scene?.title}
        debug={resolvedSettings.debug}
        selectedQuality={quality}
        onQualityChange={setQuality}
        onError={handlePlaybackError}
      />
    );
  }

  // Fall back to original Stash player
  if (resolvedSettings.debug) console.log('[ScenePlayerPatch] Using original player');
  return React.createElement(OriginalPlayer, buildOriginalPlayerProps(scene, playerProps));
};
