import { DEFAULT_SETTINGS } from './settings.js';
import type { PluginSettings, ProbeResponse } from './types.js';

export interface PlaybackPlan {
  mode: PluginSettings['playbackMode'];
  pathPattern: string;
}

export function isRemuxPathPattern(pathPattern: string): boolean {
  return /(^|\/)remux(\/|$)/.test(pathPattern);
}

/**
 * Pick a playback route that matches the agent probe result.
 * Remux HLS is an optimization for compatible source codecs, not a guarantee.
 */
export function resolvePlaybackPlan(
  settings: PluginSettings,
  probe?: ProbeResponse
): PlaybackPlan | null {
  const advertisedModes = probe?.mode;

  if (settings.playbackMode === 'direct') {
    if (advertisedModes && !advertisedModes.includes('direct')) {
      return null;
    }
    return {
      mode: 'direct',
      pathPattern: settings.directPathPattern,
    };
  }

  const wantsRemux = isRemuxPathPattern(settings.hlsPathPattern);
  if (advertisedModes) {
    if (wantsRemux && advertisedModes.includes('remux-hls')) {
      return {
        mode: 'hls',
        pathPattern: settings.hlsPathPattern,
      };
    }

    if (advertisedModes.includes('hls')) {
      return {
        mode: 'hls',
        pathPattern: wantsRemux ? DEFAULT_SETTINGS.hlsPathPattern : settings.hlsPathPattern,
      };
    }

    return null;
  }

  return {
    mode: 'hls',
    pathPattern: settings.hlsPathPattern,
  };
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
 * Test if native HLS support is available (iOS/Safari)
 */
export function hasNativeHls(): boolean {
  const video = document.createElement('video');
  const canPlay = video.canPlayType('application/vnd.apple.mpegurl');
  return canPlay === 'maybe' || canPlay === 'probably';
}
