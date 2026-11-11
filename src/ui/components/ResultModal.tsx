import React from 'react';
import { ResultPayload } from '../../net/protocol';
import { FreeM2Choice } from '../../types/game';
import { getCardDef, getCardLevel } from '../../cards/registry';
import { KatexText } from './KatexText';
import { NativeModal } from './NativeModal';

interface ResultModalProps {
  open: boolean;
  result: ResultPayload | null;
  deadlineAt: number | null;
  estimatedNowMs: number;
  freeM2Choice: FreeM2Choice | null;
  handCount: number;
  onChooseFreeM2: (cardId: string) => void;
}

const LABELS = ['A', 'B', 'C', 'D'] as const;

export const ResultModal: React.FC<ResultModalProps> = ({
  open,
  result,
  deadlineAt,
  estimatedNowMs,
  freeM2Choice,
  handCount,
  onChooseFreeM2,
}) => {
  const remainSec = deadlineAt ? Math.max(0, (deadlineAt - estimatedNowMs) / 1000) : 0;

  return (
    <NativeModal open={open && Boolean(result)} titleId="result-modal-title">
      {result && (
        <>
          <div className="between">
            <h3 id="result-modal-title" style={{ margin: 0 }}>
              {result.you.isCorrect ? '✅ Chính xác!' : '❌ Chưa chính xác'}
            </h3>
            <span className="badge">Vào Shop sau {remainSec.toFixed(1)}s</span>
          </div>

          <div className="panel col" style={{ gap: '0.4rem' }}>
            <div>
              Đáp án đúng: <strong>{LABELS[result.correctIndex]}</strong>
            </div>
            {result.explain && (
              <div className="muted" style={{ fontSize: '0.9rem' }}>
                Lời giải: <KatexText text={result.explain} />
              </div>
            )}
          </div>

          <div className="hand-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="panel col">
              <strong>Kết quả của bạn</strong>
              <span>
                +{result.you.coinsEarned} xu cơ bản
                {result.you.streakBonusCoins > 0 ? ` (+${result.you.streakBonusCoins} xu streak)` : ''}
              </span>
              <span>🔥 Streak hiện tại: {result.you.newStreak}</span>
              {result.you.timePenaltySec > 0 && (
                <span style={{ color: '#fca5a5' }}>
                  ⏱ Trừ {result.you.timePenaltySec}s (trả lời sai một mình)
                </span>
              )}
            </div>

            <div className="panel col">
              <strong>Đối thủ</strong>
              <span>{result.opp.isCorrect ? '✅ Trả lời đúng' : '❌ Trả lời sai / hết giờ'}</span>
              <span>
                ⏱ Tốc độ:{' '}
                {result.opp.answeredInMs !== null
                  ? `${(result.opp.answeredInMs / 1000).toFixed(1)}s`
                  : 'Hết giờ'}
              </span>
              {result.opp.timePenaltySec > 0 && (
                <span style={{ color: '#86efac' }}>Đối thủ bị trừ {result.opp.timePenaltySec}s!</span>
              )}
            </div>
          </div>

          {freeM2Choice && (
            <div className="panel col" style={{ borderColor: '#22c55e' }}>
              <strong>🎁 Thưởng Streak 5! Chọn 1 thẻ Mức 2 miễn phí:</strong>
              {handCount >= 3 && (
                <span className="muted" style={{ fontSize: '0.82rem' }}>
                  Kho đang 3/3 — bạn có thể bỏ 1 thẻ ở Shop kế tiếp để nhận thẻ này.
                </span>
              )}
              <div className="hand-grid">
                {freeM2Choice.options.map((opt) => {
                  const def = getCardDef(opt.cardId);
                  const lvl = getCardLevel(opt.cardId, 2);
                  return (
                    <button
                      key={opt.cardId}
                      type="button"
                      className="card-slot"
                      data-group={def.group}
                      disabled={handCount >= 3}
                      onClick={() => onChooseFreeM2(opt.cardId)}
                    >
                      <strong>
                        {def.icon} {def.name} ★2
                      </strong>
                      <span className="card-desc">{lvl.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </NativeModal>
  );
};
