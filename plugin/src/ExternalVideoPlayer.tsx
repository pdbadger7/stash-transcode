import React, { useRef, useEffect, useState } from 'react';
import { hasHlsJs, hasNativeHls } from './stashApi.js';

interface ExternalVideoPlayerProps {
  url: string;
  mode: 'direct' | 'hls';
  title?: string;
  debug?: boolean;
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

    if (mode === 'hls') {
      if (hasNativeHls()) {
        // Use native HLS support (iOS/Safari)
        if (debug) console.log('[ExternalVideoPlayer] Using native HLS');
        video.src = url;
      } else if (hasHlsJs()) {
        // Use hls.js for browsers that need it
        if (debug) console.log('[ExternalVideoPlayer] Using hls.js');
        const Hls = (window as any).Hls;
        const hls = new Hls();
        hls.attachMedia(video);
        hls.on('hlsError', (_: any, data: any) => {
          console.error('[ExternalVideoPlayer] HLS error:', data);
          setError(`HLS Error: ${data.type}`);
          onError?.(new Error(`HLS Error: ${data.type}`));
        });
        hls.loadSource(url);
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
  }, [url, mode, debug, onError]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
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
