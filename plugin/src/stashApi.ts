import type { PluginSettings, ProbeResponse } from './types.js';

/**
 * Build a playback URL for the external agent
 */
export function buildPlaybackUrl(
  baseUrl: string,
  pathPattern: string,
  sceneId: string,
  token?: string
): string {
  const url = new URL(baseUrl);
  const path = pathPattern.replace('{id}', sceneId);
  url.pathname = path;

  if (token) {
    url.searchParams.set('token', token);
  }

  return url.toString();
}

/**
 * Probe the external agent to see if it can serve this scene
 */
export async function probeExternalAgent(
  baseUrl: string,
  sceneId: string,
  token?: string
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
 * Test if HLS.js is available
 */
export function hasHlsJs(): boolean {
  return typeof window !== 'undefined' && (window as any).Hls !== undefined;
}

/**
 * Test if native HLS support is available (iOS/Safari)
 */
export function hasNativeHls(): boolean {
  const video = document.createElement('video');
  const canPlay = video.canPlayType('application/vnd.apple.mpegurl');
  return canPlay === 'maybe' || canPlay === 'probably';
}
