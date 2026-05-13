import React, { useState, useEffect } from 'react';
import {
  buildPlaybackUrl,
  probeExternalAgent,
} from './stashApi.js';
import { ExternalVideoPlayer } from './ExternalVideoPlayer.js';
import type { StashScene, PluginSettings } from './types.js';

interface ScenePlayerPatchProps {
  scene?: StashScene;
  originalComponent: React.ComponentType<any>;
  settings: PluginSettings;
}

/**
 * Scene player patch component
 * This wraps/replaces the original ScenePlayer when appropriate
 */
export const ScenePlayerPatch: React.FC<ScenePlayerPatchProps> = ({
  scene,
  originalComponent: OriginalPlayer,
  settings,
}) => {
  const [useExternal, setUseExternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  if (settings.debug) {
    console.log('[ScenePlayerPatch] Rendering with scene:', scene?.id);
  }

  // Initialize external player on mount or when scene changes
  useEffect(() => {
    if (!scene?.id) {
      if (settings.debug) console.log('[ScenePlayerPatch] No scene ID');
      setUseExternal(false);
      return;
    }

    const initializeExternalPlayer = async () => {
      try {
        // Probe if enabled
        if (settings.probeBeforeReplace) {
          if (settings.debug)
            console.log(`[ScenePlayerPatch] Probing scene ${scene.id}`);
          const probeResult = await probeExternalAgent(
            settings.externalTranscodeBaseUrl,
            scene.id,
            settings.sharedToken
          );

          if (!probeResult.ok) {
            if (settings.debug)
              console.log('[ScenePlayerPatch] Probe failed:', probeResult.error);

            if (settings.fallbackToStashPlayer) {
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
          settings.playbackMode === 'hls'
            ? settings.hlsPathPattern
            : settings.directPathPattern;

        const url = buildPlaybackUrl(
          settings.externalTranscodeBaseUrl,
          pathPattern,
          scene.id,
          settings.sharedToken
        );

        if (settings.debug)
          console.log('[ScenePlayerPatch] Using external player:', url);

        setPlaybackUrl(url);
        setUseExternal(true);
        setError(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown error';
        console.error('[ScenePlayerPatch] Error:', message);

        if (settings.fallbackToStashPlayer) {
          setUseExternal(false);
          setError(null);
        } else {
          setError(message);
          setUseExternal(false);
        }
      }
    };

    initializeExternalPlayer();
  }, [scene?.id, settings]);

  // Handle playback error
  const handlePlaybackError = (err: Error) => {
    console.error('[ScenePlayerPatch] Playback error:', err.message);

    if (settings.fallbackToStashPlayer) {
      if (settings.debug)
        console.log('[ScenePlayerPatch] Falling back to original player');
      setUseExternal(false);
      setError(null);
    } else {
      setError(err.message);
    }
  };

  // Show error or use external player
  if (error && !settings.fallbackToStashPlayer) {
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
        mode={settings.playbackMode}
        title={scene?.title}
        debug={settings.debug}
        onError={handlePlaybackError}
      />
    );
  }

  // Fall back to original Stash player
  if (settings.debug) console.log('[ScenePlayerPatch] Using original player');
  return React.createElement(OriginalPlayer);
};
