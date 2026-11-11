import React from 'react';
import { getCardDef } from '../../cards/registry';
import { HeldCard, PendingHarmful, PlayerId } from '../../types/game';

interface ShieldAlertBarProps {
  pending: PendingHarmful | null;
  viewerId: PlayerId | 'spectator';
  hand: HeldCard[];
  estimatedNowMs: number;
  onUseShield: (uid?: string) => void;
}

export const ShieldAlertBar: React.FC<ShieldAlertBarProps> = ({
  pending,
  viewerId,
  hand,
  estimatedNowMs,
  onUseShield,
}) => {
  if (!pending) return null;
  const remainSec = Math.max(0, (pending.resolveAt - estimatedNowMs) / 1000).toFixed(1);
  const isTarget = viewerId !== 'spectator' && pending.target === viewerId;
  const shields = hand.filter((c) => c.cardId === 'q_shield');

  const cardLabel =
    pending.cardId === 'hidden'
      ? `1 thẻ [${pending.group.toUpperCase()}]`
      : `${getCardDef(pending.cardId).name} ★${pending.level}`;

  return (
    <div className="effect-banner danger" role="alert">
      <div className="col" style={{ gap: '0.15rem' }}>
        <strong>
          {isTarget
            ? `⚠️ Đối thủ vừa tung ${cardLabel} lên bạn! (${remainSec}s)`
            : `⏳ Đang chờ cửa sổ Lá chắn ${remainSec}s…`}
        </strong>
        {isTarget && shields.length === 0 && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Bạn không có thẻ Lá chắn (hoặc nhấn nếu đang giữ khiên phụ ★3).
          </span>
        )}
      </div>

      {isTarget && (
        <div className="row">
          {shields.map((sh) => (
            <button
              key={sh.uid}
              type="button"
              className="btn-primary"
              onClick={() => onUseShield(sh.uid)}
            >
              🛡️ Dùng Lá chắn ★{sh.level}
            </button>
          ))}
          {shields.length === 0 && (
            <button type="button" onClick={() => onUseShield(undefined)}>
              🛡️ Kích hoạt khiên
            </button>
          )}
        </div>
      )}
    </div>
  );
};
