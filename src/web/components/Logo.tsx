/** Glaneur mark: the feed glyph drawn with a highlighter on a graphite tile. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="9" fill="#1b1e24" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="#ffffff" strokeOpacity="0.14" />
      <circle cx="10.2" cy="21.9" r="2.7" fill="#ffe14a" />
      <path d="M8.1 14.4c5.3-.2 9.6 4.1 9.5 9.4" fill="none" stroke="#ffe14a" strokeWidth="3.3" strokeLinecap="round" />
      <path d="M8.2 7.6c9.2-.4 16.4 6.9 16.2 16.1" fill="none" stroke="#ffe14a" strokeWidth="3.3" strokeLinecap="round" />
    </svg>
  );
}
