import type { ProbeResponse } from './types.js';

type HlsErrorData = {
  type?: string;
};

export type HlsInstance = {
  attachMedia: (video: HTMLVideoElement) => void;
  on: (event: string, callback: (_: unknown, data: HlsErrorData) => void) => void;
  loadSource: (url: string) => void;
  destroy?: () => void;
};

type HlsConstructor = {
  new (): HlsInstance;
};

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
 * Test if HLS.js is available
 */
export function hasHlsJs(): boolean {
  return getHlsConstructor() !== undefined;
}

export function getHlsConstructor(): HlsConstructor | undefined {
  return (window as Window & { Hls?: HlsConstructor }).Hls;
}

/**
 * Test if native HLS support is available (iOS/Safari)
 */
export function hasNativeHls(): boolean {
  const video = document.createElement('video');
  const canPlay = video.canPlayType('application/vnd.apple.mpegurl');
  return canPlay === 'maybe' || canPlay === 'probably';
}
