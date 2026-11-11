import React, { useEffect, useRef, useState } from 'react';
import { CFG } from '../../config/defaults';
import { soundFx } from '../../utils/sound';

interface FlashOverlayProps {
  triggerId: string | null;
  count: number;
}

export const FlashOverlay: React.FC<FlashOverlayProps> = ({ triggerId, count }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'idle' | 'on' | 'fading'>('idle');

  useEffect(() => {
    if (!triggerId || count <= 0) return;

    const el = ref.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    const timers: number[] = [];

    const showTop = () => {
      if (!el) return;
      try {
        if (typeof el.showPopover === 'function') {
          if (el.matches(':popover-open')) el.hidePopover?.();
          el.showPopover();
        }
      } catch {
        // fallback fixed overlay
      }
    };

    const hideTop = () => {
      if (!el) return;
      try {
        if (typeof el.hidePopover === 'function' && el.matches(':popover-open')) {
          el.hidePopover();
        }
      } catch {
        // ignore
      }
    };

    const durationMs = CFG.flashSeconds * 1000; // 500ms
    const gapMs = CFG.flashGapSeconds * 1000;   // 3000ms

    for (let i = 0; i < count; i++) {
      const startOffset = i * gapMs;
      timers.push(
        window.setTimeout(() => {
          showTop();
          setPhase('on');
          soundFx.flash();
        }, startOffset)
      );
      timers.push(
        window.setTimeout(() => {
          setPhase('fading');
        }, startOffset + durationMs)
      );
      timers.push(
        window.setTimeout(() => {
          setPhase('idle');
          if (i === count - 1) hideTop();
        }, startOffset + durationMs + 130)
      );
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      setPhase('idle');
      hideTop();
    };
  }, [triggerId, count]);

  return (
    <div
      ref={ref}
      {...({ popover: 'manual' } as Record<string, unknown>)}
      aria-hidden="true"
      className={`flash-popover ${phase === 'on' ? 'on' : phase === 'fading' ? 'fading' : ''}`}
    />
  );
};
