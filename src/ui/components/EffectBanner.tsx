import React, { useMemo } from 'react';
import { computeStrategicPlan } from '../../analysis/analyzers';
import { getCardDef } from '../../cards/registry';
import { Color, ForceMoveState, PublicPlayerView, PublicState } from '../../types/game';
import { formatClock } from './PlayerBar';

interface EffectBannerProps {
  state: PublicState;
  viewerId: 'p1' | 'p2' | 'spectator';
  estimatedNowMs: number;
}

export const EffectBanner: React.FC<EffectBannerProps> = ({
  state,
  viewerId,
  estimatedNowMs,
}) => {
  const viewerColor: Color =
    viewerId === 'p1' ? state.p1.color : viewerId === 'p2' ? state.p2.color : 'w';

  const opp: PublicPlayerView | null =
    viewerId === 'p1' ? state.p2 : viewerId === 'p2' ? state.p1 : null;

  const planEff = useMemo(
    () =>
      viewerId === 'spectator'
        ? undefined
        : state.activeEffects.find((e) => e.owner === viewerId && e.cardId === 'sup_plan'),
    [state.activeEffects, viewerId]
  );

  const planResult = useMemo(() => {
    if (!planEff) return null;
    const maxHints = planEff.level === 1 ? 1 : planEff.level === 2 ? 2 : 3;
    return computeStrategicPlan(state.fen, viewerColor, maxHints, planEff.level >= 4);
  }, [planEff, state.fen, viewerColor]);

  const force: ForceMoveState | null = state.forceMove;
  const forceRemainMs = force ? Math.max(0, force.deadlineAt - estimatedNowMs) : 0;

  return (
    <div className="banner-stack">
      {force && (
        <div className="effect-banner force" role="status">
          <span>
            ⚡ <strong>Ép đi nhanh</strong> lên{' '}
            {force.target === 'p1' ? state.p1.name : state.p2.name}: còn{' '}
            <strong>{(forceRemainMs / 1000).toFixed(1)}s</strong> (quá hạn mất 1/8 đồng hồ!)
          </span>
        </div>
      )}

      {state.weakTopicHint && (
        <div className="effect-banner">
          <span>
            🔍 Chủ đề yếu nhất của đối thủ: <strong>{state.weakTopicHint}</strong>
          </span>
        </div>
      )}

      {planResult && (
        <div className="effect-banner">
          <div className="col" style={{ gap: '0.2rem' }}>
            <strong>📋 Gợi ý kế hoạch ({'★'.repeat(planEff!.level)}):</strong>
            {planResult.hints.map((h, i) => (
              <span key={i}>• {h}</span>
            ))}
          </div>
        </div>
      )}

      {opp?.revealedHand && (
        <div className="effect-banner">
          <span>
            👁 Kho thẻ đối thủ:{' '}
            {opp.revealedHand.length === 0
              ? 'Trống'
              : opp.revealedHand
                  .map((h) => `${h.name}${h.level ? ` ★${h.level}` : ''}`)
                  .join(', ')}
          </span>
        </div>
      )}

      {opp?.revealedHistory && opp.revealedHistory.length > 0 && (
        <div className="effect-banner">
          <span>
            📜 Lịch sử thẻ đối thủ:{' '}
            {opp.revealedHistory
              .map(
                (it) =>
                  `${it.name}${it.level ? ` ★${it.level}` : ''}${
                    it.atClockMs !== undefined ? ` (${formatClock(it.atClockMs)})` : ''
                  }`
              )
              .join(' • ')}
          </span>
        </div>
      )}

      {opp?.revealedShop && (
        <div className="effect-banner">
          <span>
            🛒 Shop đối thủ:{' '}
            {opp.revealedShop.items
              ? opp.revealedShop.items
                  .map((it) => `${getCardDef(it.cardId).name} ★${it.level}${it.bought ? ' [Đã mua]' : ''}`)
                  .join(', ')
              : `Đã mua: ${opp.revealedShop.boughtNames.join(', ') || 'Chưa mua'}`}
          </span>
        </div>
      )}

      {state.activeEffects
        .filter((e) => e.cardId !== 'sup_plan' && e.cardId !== 'time_force')
        .map((eff) => {
          const def = getCardDef(eff.cardId);
          const targetName =
            eff.target === 'p1' ? state.p1.name : eff.target === 'p2' ? state.p2.name : '';
          return (
            <div
              key={eff.uid}
              className={`effect-banner ${def.harmful ? 'danger' : ''}`}
            >
              <span>
                {def.icon} <strong>{def.name}</strong> ★{eff.level}
                {targetName ? ` → ${targetName}` : ''}
              </span>
              <span className="badge">
                {eff.owner === viewerId ? 'Của bạn' : 'Đang hiệu lực'}
              </span>
            </div>
          );
        })}
    </div>
  );
};
