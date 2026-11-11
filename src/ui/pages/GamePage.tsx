import React, { useEffect, useState } from 'react';
import { CFG } from '../../config/defaults';
import { QuizPayload, ResultPayload, ShopPayload } from '../../net/protocol';
import { EloUpdateResult } from '../../rank/rankSystem';
import { GameOverInfo, PlayerId, PublicPlayerView, PublicState } from '../../types/game';
import { soundFx } from '../../utils/sound';
import { BoardView } from '../components/BoardView';
import { EffectBanner } from '../components/EffectBanner';
import { EvalBar } from '../components/EvalBar';
import { FlashOverlay } from '../components/FlashOverlay';
import { GameOverModal } from '../components/GameOverModal';
import { HandBar } from '../components/HandBar';
import { NativeModal } from '../components/NativeModal';
import { PlayerBar } from '../components/PlayerBar';
import { PreQuizModal } from '../components/PreQuizModal';
import { QuizModal } from '../components/QuizModal';
import { ResultModal } from '../components/ResultModal';
import { ShieldAlertBar } from '../components/ShieldAlertBar';
import { ShopModal } from '../components/ShopModal';

export interface GamePageProps {
  mode: 'host' | 'guest' | 'spectator' | 'hotseat';
  transport?: 'firebase' | 'peerjs' | 'hotseat';
  isRanked?: boolean;
  rankDiff?: EloUpdateResult | null;
  roomCode?: string;
  viewerId: PlayerId | 'spectator';
  state: PublicState;
  stateReceivedAtMs: number;
  quiz: QuizPayload | null;
  result: ResultPayload | null;
  shop: ShopPayload | null;
  gameOver: GameOverInfo | null;
  flashEvent: { id: string; count: number } | null;
  toastMsg: string | null;
  hotseatCurtain?: {
    locked: boolean;
    targetPlayerId: PlayerId;
    reason: string;
    onUnlock: () => void;
  };
  onReady: () => void;
  onMove: (from: string, to: string, promo?: 'q' | 'r' | 'b' | 'n') => void;
  onUseCard: (uid: string) => void;
  onUseShield: (uid?: string) => void;
  onPreQuizPass: () => void;
  onAnswerQuiz: (qid: string, choice: number) => void;
  onRerollQuiz: () => void;
  onBuyCard: (slot: number) => void;
  onDropCard: (uid: string) => void;
  onRefreshShop: () => void;
  onDoneShop: () => void;
  onChooseFreeM2: (cardId: string) => void;
  onOfferDraw: () => void;
  onReplyDraw: (accept: boolean) => void;
  onResign: () => void;
  onRematch?: () => void;
  onExit: () => void;
}

export const GamePage: React.FC<GamePageProps> = ({
  mode,
  transport = 'peerjs',
  isRanked = false,
  rankDiff = null,
  roomCode,
  viewerId,
  state,
  stateReceivedAtMs,
  quiz,
  result,
  shop,
  gameOver,
  flashEvent,
  toastMsg,
  hotseatCurtain,
  onReady,
  onMove,
  onUseCard,
  onUseShield,
  onPreQuizPass,
  onAnswerQuiz,
  onRerollQuiz,
  onBuyCard,
  onDropCard,
  onRefreshShop,
  onDoneShop,
  onChooseFreeM2,
  onOfferDraw,
  onReplyDraw,
  onResign,
  onRematch,
  onExit,
}) => {
  const [nowTick, setNowTick] = useState(Date.now());
  const [soundOn, setSoundOn] = useState(soundFx.enabled);
  const [confirmResign, setConfirmResign] = useState(false);

  // Giữ đồng hồ UI mượt mỗi 100ms
  useEffect(() => {
    if (state.phase === 'LOBBY' || state.phase === 'GAME_OVER') return;
    const t = window.setInterval(() => setNowTick(Date.now()), 100);
    return () => clearInterval(t);
  }, [state.phase]);

  const elapsedSinceSync = Math.max(0, nowTick - stateReceivedAtMs);
  const estimatedHostNow = state.hostNow + elapsedSinceSync;

  const isPlayer = viewerId === 'p1' || viewerId === 'p2';
  const selfPlayer: PublicPlayerView | null =
    viewerId === 'p1' ? state.p1 : viewerId === 'p2' ? state.p2 : null;
  const oppPlayer: PublicPlayerView | null =
    viewerId === 'p1' ? state.p2 : viewerId === 'p2' ? state.p1 : null;

  const topPlayerRaw = oppPlayer ?? state.p2;
  const bottomPlayerRaw = selfPlayer ?? state.p1;

  const clockInterpCapMs = transport === 'firebase' ? 7500 : 1500;

  // Nội suy nhẹ đồng hồ người đang đi trong chế độ Online / Spectator
  const applyClockInterp = (p: PublicPlayerView): PublicPlayerView => {
    if (
      state.phase === 'PLAYING' &&
      !state.pendingHarmful &&
      !hotseatCurtain?.locked &&
      p.color === state.turn &&
      p.freezeRemainingMs === 0
    ) {
      return {
        ...p,
        clockMs: Math.max(0, p.clockMs - Math.min(elapsedSinceSync, clockInterpCapMs)),
      };
    }
    return p;
  };

  const topPlayer = applyClockInterp(topPlayerRaw);
  const bottomPlayer = applyClockInterp(bottomPlayerRaw);

  const orientation =
    viewerId === 'p1'
      ? state.p1.color === 'w'
        ? 'white'
        : 'black'
      : viewerId === 'p2'
        ? state.p2.color === 'w'
          ? 'white'
          : 'black'
        : 'white';

  const canControlBoard =
    isPlayer &&
    Boolean(selfPlayer) &&
    state.phase === 'PLAYING' &&
    !state.pendingHarmful &&
    !hotseatCurtain?.locked &&
    selfPlayer!.color === state.turn;

  const whiteSince = state.p1.color === 'w' ? state.p1.sinceQuiz : state.p2.sinceQuiz;
  const blackSince = state.p1.color === 'b' ? state.p1.sinceQuiz : state.p2.sinceQuiz;

  // Màn hình chờ Lobby phía Khách / Khán giả Online hoặc đang đồng bộ Ghép trận nhanh
  if (state.phase === 'LOBBY') {
    const me = selfPlayer;
    if (isRanked) {
      return (
        <main className="app-shell">
          <section className="panel col" style={{ maxInlineSize: 480, marginInline: 'auto', textAlign: 'center' }}>
            <h2 className="quick-pulse" style={{ margin: 0 }}>
              ⚔️ Đã tìm thấy đối thủ!
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              {state.p1.name} vs {state.p2.name} • Đang khởi tạo bàn cờ ({state.clockSeconds / 60} phút)…
            </p>
            <button type="button" onClick={onExit}>
              ← Hủy
            </button>
          </section>
        </main>
      );
    }
    return (
      <main className="app-shell">
        <header className="topbar">
          <div className="brand">
            <span>♟️ Phòng {roomCode ?? ''}</span>
            <span className="badge">{viewerId === 'spectator' ? 'Khán giả' : 'Người chơi 2'}</span>
          </div>
          <button type="button" onClick={onExit}>
            ← Rời phòng
          </button>
        </header>

        <section className="panel col" style={{ maxInlineSize: 540, marginInline: 'auto', textAlign: 'center' }}>
          <h2 style={{ margin: 0 }}>Đang chờ Chủ phòng bắt đầu…</h2>
          <p className="muted" style={{ margin: 0 }}>
            Chủ phòng: <strong>{state.p1.name}</strong> • Đồng hồ:{' '}
            <strong>{state.clockSeconds / 60} phút</strong>
          </p>
          {viewerId !== 'spectator' && me && (
            <div className="row" style={{ justifyContent: 'center', marginTop: '0.5rem' }}>
              <button
                type="button"
                className={me.ready ? 'btn-success' : 'btn-primary'}
                disabled={me.ready}
                onClick={onReady}
              >
                {me.ready ? '✅ Đã sẵn sàng' : '✋ Nhấn Sẵn sàng'}
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <FlashOverlay
        triggerId={flashEvent?.id ?? null}
        count={flashEvent?.count ?? 0}
      />

      <header className="topbar">
        <div className="brand">
          <span>♟️ Cờ Vua × Trắc Nghiệm</span>
          {mode === 'hotseat' && <span className="badge">1 Máy (Hot-seat)</span>}
          {isRanked && (
            <span className="badge" style={{ borderColor: '#f5a524', color: '#fbbf24' }}>
              🏆 Ranked
            </span>
          )}
          {mode !== 'hotseat' && (
            <span className="badge">{transport === 'firebase' ? 'Online' : 'P2P'}</span>
          )}
          {viewerId === 'spectator' && <span className="badge">👀 Khán giả</span>}
          {roomCode && <span className="badge">Mã: {roomCode}</span>}
        </div>

        <div className="row">
          <div className="quiz-dots" title="Mỗi bên đi đủ 3 nước sẽ mở khóa Quiz">
            <span>Quiz sau:</span>
            <span>⚪</span>
            {[0, 1, 2].map((i) => (
              <span key={`w-${i}`} className={`dot ${i < whiteSince ? 'filled' : ''}`} />
            ))}
            <span>•</span>
            <span>⚫</span>
            {[0, 1, 2].map((i) => (
              <span key={`b-${i}`} className={`dot ${i < blackSince ? 'filled' : ''}`} />
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              soundFx.enabled = !soundOn;
              setSoundOn(!soundOn);
            }}
            title="Bật/tắt âm thanh"
          >
            {soundOn ? '🔊' : '🔇'}
          </button>

          <button type="button" onClick={onExit}>
            🏠 Thoát
          </button>
        </div>
      </header>

      {toastMsg && (
        <div className="effect-banner danger" role="alert">
          <span>⚠️ {toastMsg}</span>
        </div>
      )}

      {state.drawOfferBy && viewerId !== 'spectator' && state.drawOfferBy !== viewerId && (
        <div className="effect-banner force" role="alert">
          <span>🤝 Đối thủ đề nghị Hòa ván đấu. Bạn có đồng ý không?</span>
          <div className="row">
            <button type="button" className="btn-success" onClick={() => onReplyDraw(true)}>
              Đồng ý hòa
            </button>
            <button type="button" className="btn-danger" onClick={() => onReplyDraw(false)}>
              Từ chối
            </button>
          </div>
        </div>
      )}

      {hotseatCurtain?.locked ? (
        <section
          className="panel col"
          style={{
            minBlockSize: 380,
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            gap: '1rem',
          }}
        >
          <span className="badge" style={{ fontSize: '0.9rem' }}>
            🔒 Màn hình riêng tư (Hot-seat)
          </span>
          <h2 style={{ margin: 0 }}>
            Chuyển máy cho:{' '}
            {hotseatCurtain.targetPlayerId === 'p1' ? state.p1.name : state.p2.name}
          </h2>
          <p className="muted" style={{ margin: 0, maxInlineSize: 420 }}>
            {hotseatCurtain.reason}
          </p>
          <button
            type="button"
            className="btn-primary"
            style={{ fontSize: '1.05rem', padding: '0.75rem 1.4rem' }}
            onClick={hotseatCurtain.onUnlock}
          >
            Tôi là {hotseatCurtain.targetPlayerId === 'p1' ? state.p1.name : state.p2.name} — Mở màn hình
          </button>
        </section>
      ) : (
        <div className="game-layout">
          {/* Cột bàn cờ */}
          <div className="board-column">
            <PlayerBar
              player={topPlayer}
              isTurn={state.phase === 'PLAYING' && topPlayer.color === state.turn}
              isSelf={false}
              roleLabel={
                viewerId === 'spectator'
                  ? `${topPlayer.color === 'w' ? 'Trắng' : 'Đen'} / P2`
                  : 'Đối thủ'
              }
            />

            <div className="board-wrap">
              <EvalBar fen={state.fen} activeEffects={state.activeEffects} viewerId={viewerId} />
              <BoardView
                fen={state.fen}
                orientation={orientation}
                canControl={canControlBoard}
                viewerColor={selfPlayer?.color ?? 'w'}
                lastMove={state.lastMove}
                activeEffects={state.activeEffects}
                viewerId={viewerId}
                analysisHint={state.analysisHint}
                onMove={onMove}
              />
            </div>

            <PlayerBar
              player={bottomPlayer}
              isTurn={state.phase === 'PLAYING' && bottomPlayer.color === state.turn}
              isSelf={isPlayer}
              roleLabel={
                viewerId === 'spectator'
                  ? `${bottomPlayer.color === 'w' ? 'Trắng' : 'Đen'} / P1`
                  : 'Bạn'
              }
            />
          </div>

          {/* Cột thẻ, hiệu ứng, log */}
          <div className="col" style={{ gap: '0.75rem' }}>
            <ShieldAlertBar
              pending={state.pendingHarmful}
              viewerId={viewerId}
              hand={selfPlayer?.hand ?? []}
              estimatedNowMs={estimatedHostNow}
              onUseShield={onUseShield}
            />

            <EffectBanner
              state={state}
              viewerId={viewerId}
              estimatedNowMs={estimatedHostNow}
            />

            {isPlayer && selfPlayer?.hand && (
              <HandBar
                hand={selfPlayer.hand}
                player={selfPlayer}
                phase={state.phase}
                currentTurnColor={state.turn}
                pendingHarmful={state.pendingHarmful}
                preQuizGroup4Used={state.preQuizGroup4Used[viewerId]}
                onUseCard={onUseCard}
              />
            )}

            {isPlayer && state.phase === 'PLAYING' && (
              <div className="panel row" style={{ justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontSize: '0.84rem' }}>
                  Nước {Math.floor(state.ply / 2) + 1} • Lượt{' '}
                  <strong>{state.turn === 'w' ? 'Trắng' : 'Đen'}</strong>
                </span>
                <div className="row">
                  <button
                    type="button"
                    disabled={Boolean(state.drawOfferBy)}
                    onClick={onOfferDraw}
                  >
                    🤝 Cầu hòa
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => setConfirmResign(true)}
                  >
                    🏳️ Đầu hàng
                  </button>
                </div>
              </div>
            )}

            <section className="panel col">
              <strong style={{ fontSize: '0.9rem' }}>📜 Nhật ký trận đấu</strong>
              <div className="event-log">
                {state.events.length === 0 ? (
                  <span className="muted">Chưa có sự kiện nào…</span>
                ) : (
                  [...state.events].reverse().map((ev) => (
                    <div key={ev.id} className="row" style={{ gap: '0.4rem' }}>
                      <span>• {ev.message}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Modals theo phase (ẩn khi đang đóng màn hình riêng tư hot-seat) */}
      {!hotseatCurtain?.locked && (
        <>
          <PreQuizModal
            open={state.phase === 'PRE_QUIZ'}
            viewerId={viewerId}
            hand={selfPlayer?.hand ?? []}
            deadlineAt={state.phaseDeadlineAt}
            estimatedNowMs={estimatedHostNow}
            passed={isPlayer ? state.preQuizPassed[viewerId] : false}
            oppPassed={
              viewerId === 'p1'
                ? state.preQuizPassed.p2
                : viewerId === 'p2'
                  ? state.preQuizPassed.p1
                  : false
            }
            group4Used={isPlayer ? state.preQuizGroup4Used[viewerId] : false}
            pendingHarmful={state.pendingHarmful}
            onUseCard={onUseCard}
            onUseShield={onUseShield}
            onPass={onPreQuizPass}
          />

          <QuizModal
            open={state.phase === 'QUIZ'}
            quiz={quiz}
            viewerId={viewerId}
            estimatedNowMs={estimatedHostNow}
            onAnswer={onAnswerQuiz}
            onReroll={onRerollQuiz}
          />

          <ResultModal
            open={state.phase === 'RESULT'}
            result={result}
            deadlineAt={state.phaseDeadlineAt}
            estimatedNowMs={estimatedHostNow}
            freeM2Choice={state.freeM2Choice}
            handCount={selfPlayer?.handCount ?? 0}
            onChooseFreeM2={onChooseFreeM2}
          />

          <ShopModal
            open={state.phase === 'SHOP'}
            viewerId={viewerId}
            shop={shop}
            coins={selfPlayer?.coins ?? 0}
            hand={selfPlayer?.hand ?? []}
            done={isPlayer ? state.shopDone[viewerId] : false}
            oppDone={
              viewerId === 'p1'
                ? state.shopDone.p2
                : viewerId === 'p2'
                  ? state.shopDone.p1
                  : false
            }
            freeM2Choice={state.freeM2Choice}
            estimatedNowMs={estimatedHostNow}
            onBuy={onBuyCard}
            onDrop={onDropCard}
            onRefresh={onRefreshShop}
            onDone={onDoneShop}
            onChooseFreeM2={onChooseFreeM2}
          />

          <GameOverModal
            open={state.phase === 'GAME_OVER' && Boolean(gameOver ?? state.gameOver)}
            info={gameOver ?? state.gameOver}
            isRanked={isRanked}
            rankDiff={rankDiff}
            onRematch={onRematch}
            onExit={onExit}
          />

          <NativeModal
            open={confirmResign}
            titleId="confirm-resign-title"
            dismissible
            onClose={() => setConfirmResign(false)}
          >
            <h3 id="confirm-resign-title" style={{ margin: 0 }}>
              Xác nhận đầu hàng?
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              Bạn sẽ thua ván cờ này ngay lập tức.
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirmResign(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  setConfirmResign(false);
                  onResign();
                }}
              >
                🏳️ Đầu hàng
              </button>
            </div>
          </NativeModal>
        </>
      )}

      {false && CFG && null}
    </main>
  );
};
