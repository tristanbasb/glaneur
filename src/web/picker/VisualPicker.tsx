import { type CSSProperties, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { type FieldRules, PAGE_WIDTH, type RenderOptions, type RequestOptions } from '../../shared/types';
import { Spinner } from '../components/ui';
import { viewUrl } from '../lib/api';
import { useLatest } from '../lib/hooks';
import { type EngineState, type EngineStats, PickerEngine, type PickResult } from './engine';

export interface PickerHandle {
  widen: () => PickResult | null;
  narrow: () => PickResult | null;
  widenRegion: () => PickResult | null;
  rebase: (oldSelector: string, newSelector: string, fields: FieldRules) => FieldRules;
}

interface Props {
  url: string;
  render: RenderOptions;
  request: RequestOptions;
  state: EngineState;
  width: 'desktop' | 'mobile';
  reloadKey: number;
  onPick: (result: PickResult) => void;
  onStats: (stats: EngineStats) => void;
  onEscape: () => void;
  ref?: Ref<PickerHandle>;
}

export function VisualPicker({ url, render, request, state, width, reloadKey, onPick, onStats, onEscape, ref }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const engine = useRef<PickerEngine | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const callbacks = useLatest({ onPick, onStats, onEscape });
  const latestState = useLatest(state);

  const renderKey = JSON.stringify(render);
  const requestKey = JSON.stringify(request);
  const src = useMemo(() => {
    if (!url.trim()) return '';
    const base = viewUrl(url.trim(), JSON.parse(renderKey) as RenderOptions, JSON.parse(requestKey) as RequestOptions);
    return reloadKey ? `${base}&fresh=1&v=${reloadKey}` : base;
  }, [url, renderKey, requestKey, reloadKey]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Pages were rendered (and their scripts ran) in a desktop-sized window: lay them out at that width, scaled to fit.
  const zoom = width === 'desktop' && size.width > 0 && size.width < PAGE_WIDTH ? size.width / PAGE_WIDTH : 1;
  const latestZoom = useLatest(zoom);
  const frameStyle: CSSProperties | undefined =
    zoom < 1 ? { position: 'absolute', top: 0, left: 0, width: PAGE_WIDTH, height: size.height / zoom, transform: `scale(${zoom})`, transformOrigin: '0 0' } : undefined;

  useEffect(() => {
    setStatus('loading');
    return () => {
      engine.current?.destroy();
      engine.current = null;
    };
  }, [src]);

  const handleLoad = () => {
    engine.current?.destroy();
    engine.current = null;
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement || !doc.body) {
      setStatus('error');
      return;
    }
    try {
      engine.current = new PickerEngine(doc, {
        onPick: (r) => callbacks.current.onPick(r),
        onStats: (s) => callbacks.current.onStats(s),
        onEscape: () => callbacks.current.onEscape(),
      });
      engine.current.setZoom(latestZoom.current);
      engine.current.update(latestState.current);
      setStatus('ready');
    } catch (err) {
      console.error('Glaneur picker:', err);
      setStatus('error');
    }
  };

  useEffect(() => {
    engine.current?.update(state);
  }, [state]);

  useEffect(() => {
    engine.current?.setZoom(zoom);
  }, [zoom]);

  useImperativeHandle(
    ref,
    () => ({
      widen: () => engine.current?.widen() ?? null,
      narrow: () => engine.current?.narrow() ?? null,
      widenRegion: () => engine.current?.widenRegion() ?? null,
      rebase: (oldSelector, newSelector, fields) => engine.current?.rebase(oldSelector, newSelector, fields) ?? fields,
    }),
    [],
  );

  return (
    <div ref={boxRef} className={`picker picker-${width}`}>
      {src ? (
        <iframe key={src} ref={frameRef} className="picker-frame" style={frameStyle} src={src} sandbox="allow-same-origin" title="Page à glaner" onLoad={handleLoad} />
      ) : (
        <p className="picker-empty">Indiquez l’adresse de la page à glaner.</p>
      )}
      {src && status === 'ready' && zoom < 1 && (
        <span className="picker-zoom mono" title={`Page affichée comme sur un écran de ${PAGE_WIDTH} pixels de large, réduite pour tenir ici`}>
          {Math.round(zoom * 100)} %
        </span>
      )}
      {src && status === 'loading' && (
        <div className="picker-loading" role="status">
          <Spinner />
          <span>{render.enabled ? 'Rendu de la page avec Chromium…' : 'Chargement de la page…'}</span>
        </div>
      )}
      {src && status === 'error' && (
        <div className="picker-loading">
          <span>La sélection visuelle n’a pas pu s’attacher à cette page. Les sélecteurs restent modifiables à droite.</span>
        </div>
      )}
    </div>
  );
}
