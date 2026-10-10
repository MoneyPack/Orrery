/**
 * A geometric orrery: four concentric orbits, each carrying one body at a
 * different angular velocity, around an amber core. Rendered once for the
 * boot sequence (rings draw in, bodies arrive, core ignites) and again as
 * the ambient mark on the welcome state. All motion lives in CSS so the
 * element is inert under `prefers-reduced-motion`.
 */
export function OrreryMark({ className, id = "orrery" }: { className?: string; id?: string }) {
  const grad = `${id}-sweep`;
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity=".35" />
        </linearGradient>
      </defs>

      {/* calibration ticks — 24 around the outer ring */}
      <g className="ticks">
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          const long = i % 6 === 0;
          const r0 = long ? 90 : 93;
          return (
            <line
              key={i}
              className="tick"
              x1={100 + Math.cos(a) * r0}
              y1={100 + Math.sin(a) * r0}
              x2={100 + Math.cos(a) * 96}
              y2={100 + Math.sin(a) * 96}
            />
          );
        })}
      </g>

      {/* radar sweep, boot only */}
      <g className="sweep">
        <path d="M100 100 L100 12 A88 88 0 0 1 162 38 Z" fill={`url(#${grad})`} />
      </g>

      <circle className="ring r1" cx="100" cy="100" r="88" />
      <circle className="ring r2" cx="100" cy="100" r="68" />
      <circle className="ring r3" cx="100" cy="100" r="47" />
      <circle className="ring r4" cx="100" cy="100" r="28" />

      {/* orbiting bodies — each group rotates about the centre */}
      <g className="orbit o1"><circle className="body" cx="100" cy="12" r="2.6" /><circle className="moon" cx="106" cy="12" r=".9" /></g>
      <g className="orbit o2"><circle className="body amber" cx="168" cy="100" r="3.4" /></g>
      <g className="orbit o3"><circle className="body" cx="100" cy="147" r="2.2" /><circle className="moon" cx="100" cy="152" r=".8" /></g>
      <g className="orbit o4"><circle className="body" cx="72" cy="100" r="1.8" /></g>

      <circle className="core-halo" cx="100" cy="100" r="11" />
      <circle className="core" cx="100" cy="100" r="6" />
    </svg>
  );
}
