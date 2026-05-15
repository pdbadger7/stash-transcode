import type { PlaybackPlan, PluginSettings, ProbeResponse, StashStream } from './types.js';

export function isRemuxPathPattern(pathPattern: string): boolean {
  return /(^|\/)remux(\/|$)/.test(pathPattern);
}

/**
 * Pick a playback route that matches the agent probe result.
 * Remux HLS is an optimization for compatible source codecs, not a guarantee.
 */
export function resolvePlaybackPlan(
  settings: PluginSettings,
  probe?: ProbeResponse,
  failedStrategies: ReadonlySet<PlaybackPlan['id']> = new Set()
): PlaybackPlan | null {
  const advertisedModes = probe?.mode;
  if (!advertisedModes) return null;

  for (const strategy of settings.playbackPriority) {
    if (strategy === 'stash') return null;
    if (failedStrategies.has(strategy)) continue;

    if (strategy === 'remux-hls' && advertisedModes.includes('remux-hls')) {
      return {
        id: 'remux-hls',
        playerMode: 'hls',
        pathPattern: settings.remuxHlsPathPattern,
        supportsQuality: false,
      };
    }

    if (strategy === 'hls' && advertisedModes.includes('hls')) {
      return {
        id: 'hls',
        playerMode: 'hls',
        pathPattern: settings.hlsPathPattern,
        supportsQuality: true,
      };
    }

    if (strategy === 'direct' && advertisedModes.includes('direct')) {
      return {
        id: 'direct',
        playerMode: 'direct',
        pathPattern: settings.directPathPattern,
        supportsQuality: false,
      };
    }
  }

  return null;
}

export function shouldUseStashPlayback(
  settings: PluginSettings,
  probe?: ProbeResponse,
  failedStrategies: ReadonlySet<PlaybackPlan['id']> = new Set()
): boolean {
  const advertisedModes = probe?.mode ?? [];
  for (const strategy of settings.playbackPriority) {
    if (strategy === 'stash') return true;
    if (!advertisedModes.includes(strategy) || failedStrategies.has(strategy)) continue;
    return false;
  }
  return settings.fallbackToStashPlayer;
}

export function buildExternalPlayerUrl(template: string, url: string): string {
  return template
    .split('{encodedURL}')
    .join(encodeURIComponent(url))
    .split('{url}')
    .join(url);
}

/**
 * Build a playback URL for the external agent
 */
export function buildPlaybackUrl(
  baseUrl: string,
  pathPattern: string,
  sceneId: string,
  token?: string,
  quality?: string
): string {
  const url = new URL(baseUrl);
  const path = pathPattern.replace('{id}', sceneId);
  url.pathname = path;

  if (token) {
    url.searchParams.set('token', token);
  }

  if (quality && quality !== 'auto') {
    url.searchParams.set('quality', quality);
  }

  return url.toString();
}

/**
 * Probe the external agent to see if it can serve this scene
 */
export async function probeExternalAgent(
  baseUrl: string,
  sceneId: string,
  token?: string,
  signal?: AbortSignal
): Promise<ProbeResponse> {
  try {
    const url = new URL(baseUrl);
    url.pathname = `/stash/scene/${sceneId}/probe`;
    if (token) {
      url.searchParams.set('token', token);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
      };
    }

    const data: ProbeResponse = await response.json();
    return data;
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Probe failed',
    };
  }
}

/**
 * Build stream entries to inject into Stash's native player when integrateIntoStashPlayer is enabled.
 * Only HLS streams are produced — direct streams are excluded because cross-origin media-src CSP
 * on the Stash UI would block them.
 */
export function buildInjectedStreams(
  settings: PluginSettings,
  probe: ProbeResponse,
  sceneId: string
): StashStream[] {
  const streams: StashStream[] = [];
  const advertisedModes = probe.mode ?? [];

  for (const strategy of settings.playbackPriority) {
    if (strategy === 'stash' || strategy === 'direct') continue;
    if (!advertisedModes.includes(strategy)) continue;

    if (strategy === 'remux-hls') {
      streams.push({
        url: buildPlaybackUrl(
          settings.externalTranscodeBaseUrl,
          settings.remuxHlsPathPattern,
          sceneId,
          settings.sharedToken
        ),
        mime_type: 'application/vnd.apple.mpegurl',
        label: 'External Remux HLS',
      });
    } else if (strategy === 'hls') {
      streams.push({
        url: buildPlaybackUrl(
          settings.externalTranscodeBaseUrl,
          settings.hlsPathPattern,
          sceneId,
          settings.sharedToken
        ),
        mime_type: 'application/vnd.apple.mpegurl',
        label: 'External HLS',
      });
    }
  }

  return streams;
}

/**
 * Test if native HLS support is available (iOS/Safari)
 */
export function hasNativeHls(): boolean {
  const video = document.createElement('video');
  const canPlay = video.canPlayType('application/vnd.apple.mpegurl');
  return canPlay === 'maybe' || canPlay === 'probably';
}
