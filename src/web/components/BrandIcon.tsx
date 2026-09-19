import { siBluesky, siGithub, siGooglenews, siMastodon, siReddit, siRss, siTelegram, siYoutube } from 'simple-icons';

const ICONS: Record<string, { path: string; hex: string; title: string }> = {
  youtube: siYoutube,
  telegram: siTelegram,
  bluesky: siBluesky,
  mastodon: siMastodon,
  reddit: siReddit,
  github: siGithub,
  googlenews: siGooglenews,
  rss: siRss,
};

export function brandColor(name: string): string {
  const icon = ICONS[name];
  return icon && icon.hex !== '181717' ? `#${icon.hex}` : 'currentColor';
}

export function BrandIcon({ name, size = 20 }: { name: string; size?: number }) {
  const icon = ICONS[name] ?? siRss;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className="brand-icon">
      <path d={icon.path} />
    </svg>
  );
}
