import React, { useEffect, useState } from 'react';
import { QuizPayload } from '../../net/protocol';
import { PlayerId } from '../../types/game';
import { KatexText } from './KatexText';
import { NativeModal } from './NativeModal';

interface QuizModalProps {
  open: boolean;
  quiz: QuizPayload | null;
  viewerId: PlayerId | 'spectator';
  estimatedNowMs: number;
  oppAnswered?: boolean;
  onAnswer: (qid: string, choice: number) => void;
  onReroll: () => void;
}

const LABELS = ['A', 'B', 'C', 'D'] as const;

export const QuizModal: React.FC<QuizModalProps> = ({
  open,
  quiz,
  viewerId,
  estimatedNowMs,
  onAnswer,
  onReroll,
}) => {
  const [picked, setPicked] = useState<{ qid: string; choice: number } | null>(null);

  useEffect(() => {
    setPicked(null);
  }, [quiz?.qid]);

  const remainMs = quiz ? Math.max(0, quiz.deadlineAt - estimatedNowMs) : 0;
  const pct = quiz && quiz.totalQuizMs > 0 ? Math.min(100, (remainMs / quiz.totalQuizMs) * 100) : 0;
  const rerollRemainMs = quiz ? Math.max(0, quiz.rerollDeadlineAt - estimatedNowMs) : 0;
  const canReroll =
    viewerId !== 'spectator' &&
    Boolean(quiz?.rerollAllowed) &&
    rerollRemainMs > 0 &&
    picked?.qid !== quiz?.qid;

  const hasAnswered = picked?.qid === quiz?.qid;

  useEffect(() => {
    if (!open || !quiz || viewerId === 'spectator' || hasAnswered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      let idx = -1;
      if (key === '1' || key === 'a') idx = 0;
      else if (key === '2' || key === 'b') idx = 1;
      else if (key === '3' || key === 'c') idx = 2;
      else if (key === '4' || key === 'd') idx = 3;
      if (idx >= 0 && !quiz.hiddenIndices.includes(idx)) {
        setPicked({ qid: quiz.qid, choice: idx });
        onAnswer(quiz.qid, idx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, quiz, viewerId, hasAnswered, onAnswer]);

  const diffLabel =
    quiz?.difficultyShown === 1
      ? 'Dễ (10 xu)'
      : quiz?.difficultyShown === 2
        ? 'Trung bình (15 xu)'
        : quiz?.difficultyShown === 3
          ? 'Khó (20 xu)'
          : null;

  return (
    <NativeModal open={open && Boolean(quiz)} titleId="quiz-modal-title">
      {quiz && (
        <>
          <div className="between">
            <div className="row">
              <h3 id="quiz-modal-title" style={{ margin: 0 }}>
                🧠 Câu hỏi Toán học
              </h3>
              {diffLabel && <span className="badge">{diffLabel}</span>}
              {quiz.opponentUsedGroup4 && (
                <span className="badge" style={{ borderColor: '#ff5c7a', color: '#fda4af' }}>
                  ⚠️ Đối thủ vừa dùng thẻ Nhóm 4
                </span>
              )}
            </div>
            <span className={`clock-pill ${remainMs <= 4000 ? 'low' : ''}`}>
              {(remainMs / 1000).toFixed(1)}s
            </span>
          </div>

          <div className="progress-track">
            <div className="progress-fill" style={{ inlineSize: `${pct}%` }} />
          </div>

          <div className="panel" style={{ fontSize: '1.05rem', lineHeight: 1.55 }}>
            <KatexText text={quiz.prompt} />
          </div>

          <div className="quiz-options">
            {quiz.options.map((opt, idx) => {
              const hidden = quiz.hiddenIndices.includes(idx);
              const isSelected = hasAnswered && picked?.choice === idx;
              return (
                <button
                  key={`${quiz.qid}-${idx}`}
                  type="button"
                  className={`quiz-opt-btn ${isSelected ? 'selected' : ''}`}
                  style={hidden ? { visibility: 'hidden' } : undefined}
                  disabled={viewerId === 'spectator' || hasAnswered || hidden}
                  onClick={() => {
                    setPicked({ qid: quiz.qid, choice: idx });
                    onAnswer(quiz.qid, idx);
                  }}
                >
                  <span className="badge">{LABELS[idx]}</span>
                  <span style={{ flex: 1 }}>
                    <KatexText text={opt} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="between">
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              {viewerId === 'spectator'
                ? 'Chế độ khán giả (chỉ xem)'
                : hasAnswered
                  ? '✅ Đã gửi đáp án! Chờ đối thủ hoàn thành…'
                  : 'Phím tắt: A/B/C/D hoặc 1/2/3/4'}
            </span>

            {viewerId !== 'spectator' && (
              <button
                type="button"
                disabled={!canReroll}
                onClick={onReroll}
                title="Mỗi ván được Đổi câu 1 lần trong 3 giây đầu"
              >
                🔄 Đổi câu {rerollRemainMs > 0 && quiz.rerollAllowed ? `(${(rerollRemainMs / 1000).toFixed(1)}s)` : ''}
              </button>
            )}
          </div>
        </>
      )}
    </NativeModal>
  );
};
