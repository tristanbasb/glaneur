import { useState } from 'react';

const TILE_COLORS = ['var(--m-title)', 'var(--m-link)', 'var(--m-description)', 'var(--m-date)', 'var(--m-image)', 'var(--m-author)'];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Site favicon, or a marker-coloured initial when the icon is missing or broken. */
export function FeedIcon({ src, name, size = 32 }: { src?: string | null; name: string; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initial = name.trim().charAt(0).toUpperCase() || '·';
  if (!src || failedSrc === src) {
    return (
      <span className="feed-icon feed-icon-initial display" style={{ width: size, height: size, fontSize: size * 0.52, background: TILE_COLORS[hash(name) % TILE_COLORS.length] }} aria-hidden>
        {initial}
      </span>
    );
  }
  return (
    <span className="feed-icon" style={{ width: size, height: size }} aria-hidden>
      <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
    </span>
  );
}
