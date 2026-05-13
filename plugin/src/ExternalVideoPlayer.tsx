import { React } from './runtime.js';
import {
  getHlsConstructor,
  hasHlsJs,
  hasNativeHls,
  type HlsInstance,
} from './stashApi.js';
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

  useEffect(() => {
    if (debug) {
      console.log('[ExternalVideoPlayer] Rendering', {
        url,
        mode,
        hasHlsJs: hasHlsJs(),
        hasNativeHls: hasNativeHls(),
      });
    }
  }, [url, mode, debug]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    let hlsInstance: HlsInstance | null = null;

    if (mode === 'hls') {
      if (hasNativeHls()) {
        // Use native HLS support (iOS/Safari)
        if (debug) console.log('[ExternalVideoPlayer] Using native HLS');
        video.src = url;
      } else if (hasHlsJs()) {
        // Use hls.js for browsers that need it
        if (debug) console.log('[ExternalVideoPlayer] Using hls.js');
        const Hls = getHlsConstructor();
        if (!Hls) {
          const msg = 'HLS support not available';
          console.warn('[ExternalVideoPlayer]', msg);
          setError(msg);
          onError?.(new Error(msg));
          return;
        }
        hlsInstance = new Hls();
        hlsInstance.attachMedia(video);
        hlsInstance.on('hlsError', (_: unknown, data: { type?: string }) => {
          console.error('[ExternalVideoPlayer] HLS error:', data);
          setError(`HLS Error: ${data.type}`);
          onError?.(new Error(`HLS Error: ${data.type}`));
        });
        hlsInstance.loadSource(url);
      } else {
        // No HLS support
        const msg = 'HLS support not available';
        console.warn('[ExternalVideoPlayer]', msg);
        setError(msg);
        onError?.(new Error(msg));
      }
    } else {
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
