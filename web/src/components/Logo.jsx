// Rack-and-bin mark. Uses currentColor for the frame so it follows the surrounding text colour; the picked bin uses the attention colour.
export default function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M6 27V5M26 27V5M6 10h20M6 18h20M6 27h20" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <rect x="10" y="11.8" width="5" height="4.4" fill="currentColor" />
      <rect x="17.5" y="19.8" width="5" height="5.2" fill="var(--accent-2)" />
      <rect x="10" y="19.8" width="5" height="5.2" fill="currentColor" opacity="0.45" />
    </svg>
  );
}
