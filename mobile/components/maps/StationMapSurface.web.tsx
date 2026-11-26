import { useEffect, useRef } from 'react';
import type { StationMapSurfaceProps } from './stationMapDocument';

export default function StationMapSurface({ html, onMessage, onError }: StationMapSurfaceProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow) onMessage(event.data);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onMessage]);
  return <iframe ref={frame} title="Nearby fuel stations on Google Maps" srcDoc={html}
    sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="strict-origin-when-cross-origin"
    onError={onError} style={{ border: 0, width: '100%', height: '100%', minHeight: 160 }} />;
}
