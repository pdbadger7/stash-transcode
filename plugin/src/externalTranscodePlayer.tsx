import { React } from './runtime.js';
import { GQL } from './runtime.js';
import {
  buildExternalPlayerUrl,
  buildInjectedStreams,
  buildPlaybackUrl,
  probeExternalAgent,
  resolvePlaybackPlan,
  shouldUseStashPlayback,
} from './stashApi.js';
import { ExternalVideoPlayer } from './ExternalVideoPlayer.js';
import type { ExternalPlayerLink } from './ExternalVideoPlayer.js';
import { buildOriginalPlayerProps } from './playerProps.js';
import { resolveSettings } from './settings.js';
import type {
  PlaybackQualityId,
  PlaybackPlan,
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
  const [externalPlayerLinks, setExternalPlayerLinks] = useState<ExternalPlayerLink[]>([]);
  const [probeResult, setProbeResult] = useState<ProbeResponse | null>(null);
  const [playbackPlan, setPlaybackPlan] = useState<PlaybackPlan | null>(null);
  const [failedPlaybackStrategies, setFailedPlaybackStrategies] = useState<PlaybackPlan['id'][]>(
    []
  );
  const [externalMode, setExternalMode] = useState<PluginSettings['playbackMode']>(
    resolvedSettings.playbackMode
  );
  const [quality, setQuality] = useState<PlaybackQualityId>('auto');
  const [injectedScene, setInjectedScene] = useState<StashScene | null>(null);

  useEffect(() => {
    setQuality('auto');
    setFailedPlaybackStrategies([]);
    setProbeResult(null);
    setPlaybackPlan(null);
    setInjectedScene(null);
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
        if (resolvedSettings.debug)
          console.log(`[ScenePlayerPatch] Probing scene ${scene.id}`);
        const probeResult: ProbeResponse = await probeExternalAgent(
          resolvedSettings.externalTranscodeBaseUrl,
          scene.id,
          resolvedSettings.sharedToken,
          controller.signal
        );

        if (cancelled) {
          return;
        }

        if (resolvedSettings.integrateIntoStashPlayer) {
          if (probeResult.ok) {
            const streams = buildInjectedStreams(resolvedSettings, probeResult, scene.id);
            if (streams.length > 0) {
              setInjectedScene({
                ...scene,
                sceneStreams: [...streams, ...(scene.sceneStreams ?? [])],
              });
              if (resolvedSettings.debug)
                console.log('[ScenePlayerPatch] Integrated mode: injecting', streams.length, 'stream(s)');
            }
          } else if (resolvedSettings.debug) {
            console.log('[ScenePlayerPatch] Integrated mode: probe failed, using original scene');
          }
          return;
        }

        if (!probeResult.ok) {
          if (resolvedSettings.debug)
            console.log('[ScenePlayerPatch] Probe failed:', probeResult.error);

          if (shouldUseStashPlayback(resolvedSettings)) {
            setUseExternal(false);
            setError(null);
            return;
          }

          setError(probeResult.error || 'Probe failed');
          setUseExternal(false);
          return;
        }

        setProbeResult(probeResult);

        const nextPlaybackPlan = resolvePlaybackPlan(
          resolvedSettings,
          probeResult,
          new Set(failedPlaybackStrategies)
        );
        if (!nextPlaybackPlan) {
          if (resolvedSettings.debug) {
            console.log('[ScenePlayerPatch] No compatible external playback mode');
          }

          if (
            shouldUseStashPlayback(
              resolvedSettings,
              probeResult,
              new Set(failedPlaybackStrategies)
            )
          ) {
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
          nextPlaybackPlan.pathPattern,
          scene.id,
          resolvedSettings.sharedToken,
          nextPlaybackPlan.supportsQuality ? quality : undefined
        );
        const links = buildExternalPlayerLinks({
          settings: resolvedSettings,
          sceneId: scene.id,
          selectedUrl: url,
        });

        if (cancelled) {
          return;
        }

        if (resolvedSettings.debug)
          console.log('[ScenePlayerPatch] Using external player:', url);

        setPlaybackUrl(url);
        setPlaybackPlan(nextPlaybackPlan);
        setExternalMode(nextPlaybackPlan.playerMode);
        setExternalPlayerLinks(links);
        setUseExternal(true);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }

        const message =
          err instanceof Error ? err.message : 'Unknown error';
        console.error('[ScenePlayerPatch] Error:', message);

        if (
          shouldUseStashPlayback(
            resolvedSettings,
            probeResult ?? undefined,
            new Set(failedPlaybackStrategies)
          )
        ) {
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
  }, [scene?.id, quality, resolvedSettings, failedPlaybackStrategies]);

  // Handle playback error
  const handlePlaybackError = (err: Error) => {
    console.error('[ScenePlayerPatch] Playback error:', err.message);

    if (playbackPlan) {
      const nextFailedStrategies = Array.from(
        new Set([...failedPlaybackStrategies, playbackPlan.id])
      );
      const nextPlaybackPlan = resolvePlaybackPlan(
        resolvedSettings,
        probeResult ?? undefined,
        new Set(nextFailedStrategies)
      );

      if (nextPlaybackPlan) {
        if (resolvedSettings.debug) {
          console.log(
            `[ScenePlayerPatch] ${playbackPlan.id} failed; trying ${nextPlaybackPlan.id}`
          );
        }
        setFailedPlaybackStrategies(nextFailedStrategies);
        setPlaybackPlan(null);
        setPlaybackUrl(null);
        setError(null);
        setUseExternal(false);
        return;
      }

      if (
        shouldUseStashPlayback(
          resolvedSettings,
          probeResult ?? undefined,
          new Set(nextFailedStrategies)
        )
      ) {
        if (resolvedSettings.debug) {
          console.log(`[ScenePlayerPatch] ${playbackPlan.id} failed; trying Stash player`);
        }
        setFailedPlaybackStrategies(nextFailedStrategies);
        setPlaybackPlan(null);
        setPlaybackUrl(null);
        setUseExternal(false);
        setError(null);
        return;
      }
    }

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

  if (resolvedSettings.integrateIntoStashPlayer) {
    const sceneToRender = injectedScene ?? scene;
    return React.createElement(OriginalPlayer, buildOriginalPlayerProps(sceneToRender, playerProps));
  }

  if (useExternal && playbackUrl) {
    return (
      <ExternalVideoPlayer
        key={`${scene?.id}:${playbackPlan?.id ?? externalMode}:${playbackUrl}`}
        url={playbackUrl}
        mode={externalMode}
        title={scene?.title}
        debug={resolvedSettings.debug}
        selectedQuality={quality}
        externalPlayerLinks={externalPlayerLinks}
        onQualityChange={setQuality}
        onError={handlePlaybackError}
      />
    );
  }

  // Fall back to original Stash player
  if (resolvedSettings.debug) console.log('[ScenePlayerPatch] Using original player');
  return React.createElement(OriginalPlayer, buildOriginalPlayerProps(scene, playerProps));
};

function buildExternalPlayerLinks(input: {
  settings: PluginSettings;
  sceneId: string;
  selectedUrl: string;
}): ExternalPlayerLink[] {
  const template = input.settings.externalPlayerUrlTemplate.trim();
  if (!template) return [];

  const directUrl = buildPlaybackUrl(
    input.settings.externalTranscodeBaseUrl,
    input.settings.directPathPattern,
    input.sceneId,
    input.settings.sharedToken
  );

  const links: ExternalPlayerLink[] = [
    {
      label: 'Open Stream',
      url: buildExternalPlayerUrl(template, input.selectedUrl),
    },
  ];

  if (directUrl !== input.selectedUrl) {
    links.push({
      label: 'Open Direct',
      url: buildExternalPlayerUrl(template, directUrl),
    });
  }

  return links;
}
