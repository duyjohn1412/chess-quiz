import React from 'react';
import { ActiveEffect } from '../../types/game';
import { computeStaticMaterialEval } from '../../analysis/analyzers';

interface EvalBarProps {
  fen: string;
  activeEffects: ActiveEffect[];
  viewerId: 'p1' | 'p2' | 'spectator';
}

export const EvalBar: React.FC<EvalBarProps> = ({ fen, activeEffects, viewerId }) => {
  if (viewerId === 'spectator') return null;
  const evalEff = activeEffects.find((e) => e.owner === viewerId && e.cardId === 'sup_eval');
  if (!evalEff) return null;

  const evalPawns =
    typeof evalEff.data?.evalPawns === 'number'
      ? evalEff.data.evalPawns
      : computeStaticMaterialEval(fen);

  // Chuyển score [-6, +6] thành phần trăm Trắng [8%, 92%]
  const clamped = Math.max(-6, Math.min(6, evalPawns));
  const whitePct = Math.round(50 + (clamped / 6) * 42);
  const exactText = evalPawns >= 0 ? `+${evalPawns.toFixed(1)}` : evalPawns.toFixed(1);

  return (
    <div
      className="eval-bar"
      title={evalEff.level >= 3 ? `Đánh giá thế cờ: ${exactText}` : 'Thanh đánh giá ưu thế (M1-2)'}
      aria-label="Thanh đánh giá thế cờ"
    >
      <div className="eval-label">
        {evalEff.level >= 3 ? exactText : 'M' + evalEff.level}
      </div>
      <div
        className="eval-fill-white"
        style={{
          blockSize: `${whitePct}%`,
          filter: evalEff.level <= 2 ? 'blur(2px)' : undefined,
        }}
      />
    </div>
  );
};
