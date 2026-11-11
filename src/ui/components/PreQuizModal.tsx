import React from 'react';
import { getCardDef, getCardLevel } from '../../cards/registry';
import { HeldCard, PendingHarmful, PlayerId } from '../../types/game';
import { NativeModal } from './NativeModal';
import { ShieldAlertBar } from './ShieldAlertBar';

interface PreQuizModalProps {
  open: boolean;
  viewerId: PlayerId | 'spectator';
  hand: HeldCard[];
  deadlineAt: number | null;
  estimatedNowMs: number;
  passed: boolean;
  oppPassed: boolean;
  group4Used: boolean;
  pendingHarmful: PendingHarmful | null;
  onUseCard: (uid: string) => void;
  onUseShield: (uid?: string) => void;
  onPass: () => void;
}

export const PreQuizModal: React.FC<PreQuizModalProps> = ({
  open,
  viewerId,
  hand,
  deadlineAt,
  estimatedNowMs,
  passed,
  oppPassed,
  group4Used,
  pendingHarmful,
  onUseCard,
  onUseShield,
  onPass,
}) => {
  const remainSec = deadlineAt ? Math.max(0, (deadlineAt - estimatedNowMs) / 1000) : 0;
  const group4Cards = hand.filter((c) => {
    const def = getCardDef(c.cardId);
    return def.group === 'quiz' && def.id !== 'q_shield';
  });

  return (
    <NativeModal open={open} titleId="prequiz-title">
      <div className="between">
        <h3 id="prequiz-title" style={{ margin: 0 }}>
          🎯 Chuẩn bị câu hỏi (Nhóm 4)
        </h3>
        <span className="clock-pill">{remainSec.toFixed(1)}s</span>
      </div>

      <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
        Đủ 3 nước mỗi bên! Bạn có tối đa 10 giây để dùng 1 thẻ Nhóm 4 trước khi câu hỏi mở ra.
      </p>

      <ShieldAlertBar
        pending={pendingHarmful}
        viewerId={viewerId}
        hand={hand}
        estimatedNowMs={estimatedNowMs}
        onUseShield={onUseShield}
      />

      {viewerId === 'spectator' ? (
        <div className="panel muted">Hai kỳ thủ đang chuẩn bị trước câu hỏi…</div>
      ) : (
        <>
          {group4Cards.length > 0 ? (
            <div className="hand-grid">
              {group4Cards.map((c) => {
                const def = getCardDef(c.cardId);
                const lvl = getCardLevel(c.cardId, c.level);
                return (
                  <button
                    key={c.uid}
                    type="button"
                    className="card-slot"
                    data-group="quiz"
                    disabled={group4Used || Boolean(pendingHarmful)}
                    onClick={() => onUseCard(c.uid)}
                  >
                    <div className="between" style={{ inlineSize: '100%' }}>
                      <strong>
                        {def.icon} {def.name}
                      </strong>
                      <span className="card-stars">{'★'.repeat(c.level)}</span>
                    </div>
                    <div className="card-desc">{lvl.desc}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="panel muted" style={{ fontSize: '0.88rem' }}>
              Bạn không có thẻ Nhóm 4 khả dụng trong kho.
            </div>
          )}

          <div className="between">
            <span className="muted" style={{ fontSize: '0.84rem' }}>
              {oppPassed ? '✅ Đối thủ đã sẵn sàng' : '⏳ Đối thủ đang suy nghĩ…'}
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={passed}
              onClick={onPass}
            >
              {passed ? 'Đã sẵn sàng (chờ đối thủ)' : 'Vào câu hỏi ngay →'}
            </button>
          </div>
        </>
      )}
    </NativeModal>
  );
};
