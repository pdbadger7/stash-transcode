import { React } from './runtime.js';
import Hls from 'hls.js';
import { hasNativeHls } from './stashApi.js';
import { PLAYBACK_QUALITIES, type PlaybackQualityId } from './types.js';

const { useRef, useEffect, useState } = React;

interface ExternalVideoPlayerProps {
  url: string;
  mode: 'direct' | 'hls';
  title?: string;
  debug?: boolean;
  selectedQuality: PlaybackQualityId;
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
        const msg =
          'Direct external playback is blocked by Stash CSP media-src. Use HLS playback mode.';
        console.warn('[ExternalVideoPlayer]', msg);
        setError(msg);
        onError?.(new Error(msg));
        return;
      }
      // Direct playback
      if (debug) console.log('[ExternalVideoPlayer] Direct playback');
      video.src = url;
    }

    return () => {
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
