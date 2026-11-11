import React from 'react';
import { getRankTier } from '../../rank/rankSystem';
import { Color, PublicPlayerView } from '../../types/game';

interface PlayerBarProps {
  player: PublicPlayerView;
  isTurn: boolean;
  isSelf: boolean;
  roleLabel?: string;
}

export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = safe / 1000;
  if (totalSec < 10) {
    return `${totalSec.toFixed(1)}s`;
  }
  const ceilSec = Math.ceil(totalSec);
  const min = Math.floor(ceilSec / 60);
  const sec = ceilSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const PlayerBar: React.FC<PlayerBarProps> = ({
  player,
  isTurn,
  isSelf,
  roleLabel,
}) => {
  const lowClock = player.clockMs <= 30_000;
  const frozen = player.freezeRemainingMs > 0;
  const colorName = (c: Color) => (c === 'w' ? 'Trắng' : 'Đen');

  return (
    <div className={`player-bar ${isTurn ? 'active-turn' : ''}`}>
      <div className="player-meta">
        <span className={`color-dot ${player.color}`} title={`Quân ${colorName(player.color)}`} />
        <div className="col" style={{ gap: '0.1rem' }}>
          <div className="row" style={{ gap: '0.35rem' }}>
            <strong style={{ fontSize: '0.95rem' }}>{player.name}</strong>
            {typeof player.elo === 'number' && (() => {
              const t = getRankTier(player.elo);
              return (
                <span
                  className="badge"
                  style={{ color: t.color, borderColor: t.color }}
                  title={`Hạng ${t.label} (${player.elo} Elo)`}
                >
                  {t.icon} {player.elo}
                </span>
              );
            })()}
            {roleLabel && <span className="badge">{roleLabel}</span>}
            {!player.connected && (
              <span className="badge" style={{ borderColor: '#ef4444', color: '#fca5a5' }}>
                Mất kết nối
              </span>
            )}
          </div>
          <div className="player-stats muted">
            <span>🪙 {player.coins !== null ? `${player.coins} xu` : 'Ẩn'}</span>
            {player.streak !== null && <span>🔥 {player.streak}</span>}
            <span>🃏 {player.handCount}/3</span>
            {isSelf && player.harmfulCooldown > 0 && (
              <span>⏳ Hồi gây hại: {player.harmfulCooldown}</span>
            )}
          </div>
        </div>
      </div>

      <div
        className={`clock-pill ${lowClock ? 'low' : ''} ${frozen ? 'frozen' : ''}`}
        aria-label={`Đồng hồ ${player.name}`}
      >
        {frozen && '❄️ '}
        {formatClock(player.clockMs)}
      </div>
    </div>
  );
};
