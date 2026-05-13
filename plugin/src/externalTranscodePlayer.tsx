import { React } from './runtime.js';
import {
  buildPlaybackUrl,
  probeExternalAgent,
} from './stashApi.js';
import { ExternalVideoPlayer } from './ExternalVideoPlayer.js';
import { buildOriginalPlayerProps } from './playerProps.js';
import type {
  PlaybackQualityId,
  StashScene,
  PluginSettings,
} from './types.js';

const { useState, useEffect, useMemo } = React;

const DEFAULT_SETTINGS: PluginSettings = {
  externalTranscodeBaseUrl: 'https://video.home',
  playbackMode: 'direct',
  directPathPattern: '/stash/scene/{id}/direct',
  hlsPathPattern: '/stash/scene/{id}/master.m3u8',
  probeBeforeReplace: true,
  fallbackToStashPlayer: true,
  sharedToken: '',
  debug: false,
};

function normalizeSettings(
  settings?: Partial<PluginSettings> | null
): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    playbackMode: settings?.playbackMode === 'hls' ? 'hls' : 'direct',
  };
}

type ScenePlayerPatchProps = {
  scene?: StashScene;
  originalComponent: React.ComponentType<Record<string, unknown>>;
  settings: PluginSettings;
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
  const resolvedSettings = useMemo(() => normalizeSettings(settings), [settings]);
  const [useExternal, setUseExternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
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
        // Probe if enabled
        if (resolvedSettings.probeBeforeReplace) {
          if (resolvedSettings.debug)
            console.log(`[ScenePlayerPatch] Probing scene ${scene.id}`);
          const probeResult = await probeExternalAgent(
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

        // Build playback URL
        const pathPattern =
          resolvedSettings.playbackMode === 'hls'
            ? resolvedSettings.hlsPathPattern
            : resolvedSettings.directPathPattern;

        const url = buildPlaybackUrl(
          resolvedSettings.externalTranscodeBaseUrl,
          pathPattern,
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
        mode={resolvedSettings.playbackMode}
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
