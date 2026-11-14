import React from 'react';

interface SnowfallOverlayProps {
  enabled: boolean;
}

const FLAKES = Array.from({ length: 24 }, (_, idx) => {
  const left = ((idx * 41 + 7) % 98) + 1;
  const duration = 9 + (idx % 6) * 2.2;
  const delay = -((idx * 1.7) % 14);
  const size = 3 + (idx % 3) * 2;
  const opacity = 0.22 + (idx % 4) * 0.12;
  return { idx, left, duration, delay, size, opacity };
});

export const SnowfallOverlay: React.FC<SnowfallOverlayProps> = ({ enabled }) => {
  if (!enabled) return null;

  return (
    <div className="snow-layer" aria-hidden="true">
      {FLAKES.map((f) => (
        <span
          key={f.idx}
          className="snowflake"
          style={
            {
              '--left': `${f.left}%`,
              '--dur': `${f.duration}s`,
              '--delay': `${f.delay}s`,
              '--size': `${f.size}px`,
              '--alpha': f.opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};
