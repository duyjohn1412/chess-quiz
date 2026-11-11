import React from 'react';
import { EloUpdateResult } from '../../rank/rankSystem';
import { GameOverInfo } from '../../types/game';
import { NativeModal } from './NativeModal';

interface GameOverModalProps {
  open: boolean;
  info: GameOverInfo | null;
  isRanked?: boolean;
  rankDiff?: EloUpdateResult | null;
  onRematch?: () => void;
  onExit: () => void;
}

const REASON_LABELS: Record<GameOverInfo['reason'], string> = {
  checkmate: 'Chiếu bí',
  timeout: 'Hết giờ',
  resign: 'Đầu hàng',
  draw_agreement: 'Thỏa thuận hòa',
  stalemate: 'Hòa (hết nước đi)',
  threefold: 'Hòa (lặp lại thế cờ 3 lần)',
  insufficient: 'Hòa (không đủ quân chiếu bí / hết câu hỏi)',
  fifty_move: 'Hòa (luật 50 nước)',
  disconnect: 'Mất kết nối quá thời gian',
};

export const GameOverModal: React.FC<GameOverModalProps> = ({
  open,
  info,
  isRanked,
  rankDiff,
  onRematch,
  onExit,
}) => {
  return (
    <NativeModal open={open && Boolean(info)} titleId="gameover-title">
      {info && (
        <>
          <div className="col" style={{ textAlign: 'center', alignItems: 'center' }}>
            <h2 id="gameover-title" style={{ margin: 0 }}>
              {info.winner === 'draw'
                ? '🤝 Ván đấu Hòa!'
                : info.winner === 'w'
                  ? '🏆 Quân Trắng thắng!'
                  : '🏆 Quân Đen thắng!'}
            </h2>
            <div className="row" style={{ justifyContent: 'center' }}>
              <span className="badge">{REASON_LABELS[info.reason]}</span>
              {isRanked && (
                <span className="badge" style={{ borderColor: '#f5a524', color: '#fbbf24' }}>
                  🏆 Xếp hạng Rank
                </span>
              )}
            </div>
          </div>

          {rankDiff && (
            <div
              className="panel row"
              style={{
                justifyContent: 'space-between',
                background: 'var(--panel-2)',
                borderColor: rankDiff.delta >= 0 ? '#22c55e' : '#ef4444',
              }}
            >
              <span>
                {rankDiff.newTier.icon} Hạng <strong>{rankDiff.newTier.label}</strong>
              </span>
              <strong>
                {rankDiff.oldElo} → {rankDiff.newElo} Elo (
                <span style={{ color: rankDiff.delta >= 0 ? '#4ade80' : '#f87171' }}>
                  {rankDiff.delta >= 0 ? `+${rankDiff.delta}` : rankDiff.delta}
                </span>
                )
              </strong>
            </div>
          )}

          <div className="hand-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {[info.stats.p1, info.stats.p2].map((st, idx) => (
              <div key={idx} className="panel col" style={{ gap: '0.35rem' }}>
                <strong>
                  {st.color === 'w' ? '⚪' : '⚫'} {st.name}
                </strong>
                <span>
                  Quiz đúng: {st.quizCorrect}/{st.quizTotal}
                </span>
                <span>Tổng xu kiếm được: {st.totalCoins} xu</span>
                <span>Số thẻ đã dùng: {st.cardsUsed}</span>
              </div>
            ))}
          </div>

          <div className="muted" style={{ textAlign: 'center', fontSize: '0.85rem' }}>
            Tổng cộng {info.stats.totalPlies} nửa nước • {info.stats.totalQuizzes} lượt câu hỏi
          </div>

          <div className="row" style={{ justifyContent: 'center' }}>
            {onRematch && (
              <button type="button" className="btn-primary" onClick={onRematch}>
                🔁 Đấu ván mới
              </button>
            )}
            <button type="button" onClick={onExit}>
              🏠 Về trang chủ
            </button>
          </div>
        </>
      )}
    </NativeModal>
  );
};
