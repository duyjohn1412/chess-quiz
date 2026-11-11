import React from 'react';
import { getCardDef, getCardLevel, GROUP_META } from '../../cards/registry';
import { canUseCard } from '../../cards/rules';
import { CFG } from '../../config/defaults';
import { Color, GamePhase, HeldCard, PendingHarmful, PlayerState, PublicPlayerView } from '../../types/game';

interface HandBarProps {
  hand: HeldCard[];
  player: PublicPlayerView;
  phase: GamePhase;
  currentTurnColor: Color;
  pendingHarmful: PendingHarmful | null;
  preQuizGroup4Used: boolean;
  onUseCard: (uid: string) => void;
}

export const HandBar: React.FC<HandBarProps> = ({
  hand,
  player,
  phase,
  currentTurnColor,
  pendingHarmful,
  preQuizGroup4Used,
  onUseCard,
}) => {
  // Chuyển sang shape tối thiểu của PlayerState để gọi canUseCard tái sử dụng rule thuần
  const pseudoPlayer: PlayerState = {
    id: player.id,
    name: player.name,
    color: player.color,
    clockMs: player.clockMs,
    freezeRemainingMs: player.freezeRemainingMs,
    coins: player.coins ?? 0,
    streak: player.streak ?? 0,
    streak5Granted: false,
    pendingShopDiscount: 0,
    hand,
    usedCount: {},
    history: [],
    rerollsLeft: 1,
    flashUsed: player.flashUsed,
    moveCount: 0,
    sinceQuiz: player.sinceQuiz,
    harmfulCooldown: player.harmfulCooldown,
    cardsUsedThisTurn: 0,
    bonusTimeGivenMs: 0,
    drawOfferCooldownUntilMove: 0,
    topicStats: {},
    connected: player.connected,
    ready: player.ready,
    disconnectedAt: null,
  };

  const slots = [0, 1, 2];

  return (
    <div className="panel col">
      <div className="between">
        <strong style={{ fontSize: '0.9rem' }}>Kho thẻ của bạn ({hand.length}/{CFG.handMax})</strong>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          Nhấn thẻ để kích hoạt (chỉ trong lượt mình hoặc Trước Quiz đối với Nhóm 4)
        </span>
      </div>
      <div className="hand-grid">
        {slots.map((idx) => {
          const card = hand[idx];
          if (!card) {
            return (
              <div key={idx} className="card-slot empty">
                Ô trống #{idx + 1}
              </div>
            );
          }

          const def = getCardDef(card.cardId);
          const lvl = getCardLevel(card.cardId, card.level);
          const groupMeta = GROUP_META[def.group];
          const check = canUseCard({
            phase,
            currentTurnColor,
            player: pseudoPlayer,
            card,
            pendingHarmful,
            preQuizGroup4Used,
            hasActiveShieldCharge: false,
          });

          return (
            <button
              key={card.uid}
              type="button"
              className="card-slot"
              data-group={def.group}
              disabled={!check.ok}
              title={check.ok ? `Dùng ${def.name} ★${card.level}` : check.reason}
              onClick={() => onUseCard(card.uid)}
            >
              <div className="between" style={{ inlineSize: '100%' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                  {def.icon} {def.name}
                </span>
                <span className="card-stars">{'★'.repeat(card.level)}</span>
              </div>
              <div className="card-desc">{lvl.desc}</div>
              <div className="between" style={{ inlineSize: '100%', fontSize: '0.72rem' }}>
                <span style={{ color: groupMeta.color }}>{groupMeta.label}</span>
                {!check.ok && <span className="muted">{check.reason}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
