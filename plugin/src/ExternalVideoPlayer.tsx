import { React } from './runtime.js';
import Hls from 'hls.js';
import { hasNativeHls } from './stashApi.js';
import { PLAYBACK_QUALITIES, type PlaybackQualityId } from './types.js';

const { useRef, useEffect, useState } = React;

export interface ExternalPlayerLink {
  label: string;
  url: string;
}

interface ExternalVideoPlayerProps {
  url: string;
  mode: 'direct' | 'hls';
  title?: string;
  debug?: boolean;
  selectedQuality: PlaybackQualityId;
  externalPlayerLinks?: ExternalPlayerLink[];
  onQualityChange?: (quality: PlaybackQualityId) => void;
  onError?: (error: Error) => void;
}

/**
 * ExternalVideoPlayer component
 * Renders an HTML5 video player for direct playback
 * or HLS playback with hls.js/native HLS support
 */
export const ExternalVideoPlayer: React.FC<ExternalVideoPlayerProps> = ({
  url,
  mode,
  title,
  debug = false,
  selectedQuality,
  externalPlayerLinks = [],
  onQualityChange,
  onError,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const isCrossOrigin =
    (() => {
      try {
        return new URL(url, window.location.href).origin !== window.location.origin;
      } catch {
        return false;
      }
    })();

  useEffect(() => {
    if (debug) {
      console.log('[ExternalVideoPlayer] Rendering', {
        url,
        mode,
        hasHlsJs: Hls.isSupported(),
        hasNativeHls: hasNativeHls(),
        isCrossOrigin,
      });
    }
  }, [url, mode, debug, isCrossOrigin]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    let hlsInstance: Hls | null = null;
    let cleanupDirectMse: (() => void) | undefined;

    if (mode === 'hls') {
      if (Hls.isSupported()) {
        // Prefer hls.js so playlists/segments are fetched via connect-src and
        // appended to a blob: media source that is allowed by Stash CSP.
        if (debug) console.log('[ExternalVideoPlayer] Using hls.js');
        hlsInstance = new Hls();
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.ERROR, (_: unknown, data: { type?: string }) => {
          console.error('[ExternalVideoPlayer] HLS error:', data);
          setError(`HLS Error: ${data.type}`);
          onError?.(new Error(`HLS Error: ${data.type}`));
        });
        hlsInstance.loadSource(url);
      } else if (!isCrossOrigin && hasNativeHls()) {
        if (debug) console.log('[ExternalVideoPlayer] Using native HLS');
        video.src = url;
      } else if (isCrossOrigin && hasNativeHls()) {
        const msg =
          'Native HLS is blocked by Stash CSP for cross-origin media. Enable hls.js-compatible playback.';
        console.warn('[ExternalVideoPlayer]', msg);
        setError(msg);
        onError?.(new Error(msg));
      } else {
        // No HLS support
        const msg = 'HLS support not available';
        console.warn('[ExternalVideoPlayer]', msg);
        setError(msg);
        onError?.(new Error(msg));
      }
    } else {
      if (isCrossOrigin) {
        if (debug) console.log('[ExternalVideoPlayer] Trying direct playback through MSE');
        cleanupDirectMse = startDirectMsePlayback({
          video,
          url,
          debug,
          onError,
          setError,
        });
      } else {
        // Direct playback
        if (debug) console.log('[ExternalVideoPlayer] Direct playback');
        video.src = url;
      }
    }

    return () => {
      cleanupDirectMse?.();
      hlsInstance?.destroy?.();
      video.removeAttribute('src');
      video.load();
    };
  }, [url, mode, debug, onError]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {mode === 'hls' && onQualityChange ? (
        <div
          style={{
            position: 'absolute',
            top: '0.75rem',
            right: '0.75rem',
            zIndex: 2,
            background: 'rgba(0, 0, 0, 0.75)',
            color: '#fff',
            padding: '0.5rem',
            borderRadius: '0.35rem',
          }}
        >
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem' }}>Quality</span>
            <select
              value={selectedQuality}
              onChange={(event) =>
                onQualityChange(event.target.value as PlaybackQualityId)
              }
            >
              {PLAYBACK_QUALITIES.map((quality) => (
                <option key={quality.id} value={quality.id}>
                  {quality.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {externalPlayerLinks.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: '0.75rem',
            top: '0.75rem',
            zIndex: 2,
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          {externalPlayerLinks.map((link) => (
            <a
              key={`${link.label}:${link.url}`}
              href={link.url}
              style={{
                background: 'rgba(0, 0, 0, 0.75)',
                color: '#fff',
                padding: '0.45rem 0.65rem',
                borderRadius: '0.35rem',
                fontSize: '0.8rem',
                textDecoration: 'none',
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
      {error ? (
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
            textAlign: 'center',
          }}
        >
          <div>
            <p>Playback Error</p>
            <p style={{ fontSize: '0.9rem', color: '#ccc' }}>{error}</p>
          </div>
        </div>
      ) : (
        <video
          ref={videoRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
          }}
          controls
          playsInline
          preload="metadata"
          title={title}
        />
      )}
    </div>
  );
};

interface DirectMseInput {
  video: HTMLVideoElement;
  url: string;
  debug: boolean;
  setError: (message: string | null) => void;
  onError?: (error: Error) => void;
}

function startDirectMsePlayback(input: DirectMseInput): () => void {
  const controller = new AbortController();
  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  input.video.src = objectUrl;

  void streamDirectToMediaSource(input, mediaSource, controller.signal);

  return () => {
    controller.abort();
    URL.revokeObjectURL(objectUrl);
  };
}

async function streamDirectToMediaSource(
  input: DirectMseInput,
  mediaSource: MediaSource,
  signal: AbortSignal
): Promise<void> {
  try {
    await waitForMediaSourceOpen(mediaSource, signal);

    const response = await fetch(input.url, {
      credentials: 'include',
      signal,
    });
    if (!response.ok) {
      throw new Error(`Direct stream fetch failed: HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Direct stream fetch did not return a readable body');
    }

    const mimeType = pickMseMimeType(response.headers.get('content-type'));
    if (!mimeType) {
      throw new Error('Direct MSE playback supports only browser-compatible MP4 or WebM streams');
    }

    if (input.debug) {
      console.log('[ExternalVideoPlayer] Direct MSE source buffer:', mimeType);
    }

    const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    const reader = response.body.getReader();
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await appendToSourceBuffer(sourceBuffer, value, signal);
      }
    }

    if (!signal.aborted && mediaSource.readyState === 'open') {
      mediaSource.endOfStream();
    }
  } catch (err) {
    if (signal.aborted) return;
    const message = err instanceof Error ? err.message : 'Direct MSE playback failed';
    console.warn('[ExternalVideoPlayer]', message);
    input.setError(message);
    input.onError?.(new Error(message));
  }
}

function pickMseMimeType(contentType: string | null): string | null {
  const normalized = contentType?.split(';')[0].trim().toLowerCase() ?? '';
  const candidates =
    normalized === 'video/webm'
      ? ['video/webm; codecs="vp9, opus"', 'video/webm; codecs="vp8, vorbis"', 'video/webm']
      : normalized === 'video/mp4' ||
          normalized === 'video/x-m4v' ||
          normalized === 'video/quicktime'
        ? [
            'video/mp4; codecs="avc1.640028, mp4a.40.2"',
            'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
            'video/mp4',
          ]
        : [];

  return candidates.find((candidate) => MediaSource.isTypeSupported(candidate)) ?? null;
}

function waitForMediaSourceOpen(mediaSource: MediaSource, signal: AbortSignal): Promise<void> {
  if (mediaSource.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      mediaSource.removeEventListener('sourceopen', onOpen);
      signal.removeEventListener('abort', onAbort);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    mediaSource.addEventListener('sourceopen', onOpen, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function appendToSourceBuffer(
  sourceBuffer: SourceBuffer,
  chunk: Uint8Array,
  signal: AbortSignal
): Promise<void> {
  const data = new Uint8Array(chunk.byteLength);
  data.set(chunk);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener('updateend', onUpdateEnd);
      sourceBuffer.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onUpdateEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Direct MSE source buffer append failed'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    sourceBuffer.addEventListener('updateend', onUpdateEnd, { once: true });
    sourceBuffer.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    sourceBuffer.appendBuffer(data);
  });
}
