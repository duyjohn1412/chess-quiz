import { getCardDef } from '../cards/registry';
import {
  ActiveEffect,
  Color,
  ForceMoveState,
  FreeM2Choice,
  GameEvent,
  GameOverInfo,
  GamePhase,
  PendingHarmful,
  PlayerId,
  PlayerShopState,
  PlayerState,
  PublicPlayerView,
  PublicState,
  RevealedHistoryItem,
  UsedCardLog,
} from '../types/game';

export interface FullGameSnapshot {
  phase: GamePhase;
  hostNow: number;
  clockSeconds: number;
  fen: string;
  turn: Color;
  lastMove: { from: string; to: string } | null;
  ply: number;
  phaseDeadlineAt: number | null;
  preQuizPassed: Record<PlayerId, boolean>;
  preQuizGroup4Used: Record<PlayerId, boolean>;
  activeEffects: ActiveEffect[];
  pendingHarmful: PendingHarmful | null;
  forceMove: ForceMoveState | null;
  drawOfferBy: PlayerId | null;
  p1: PlayerState;
  p2: PlayerState;
  shops: Record<PlayerId, PlayerShopState | null>;
  freeM2Choices: Record<PlayerId, FreeM2Choice | null>;
  events: GameEvent[];
  gameOver: GameOverInfo | null;
  weakTopicHints: Record<PlayerId, string | null>;
  analysisHints: Record<
    PlayerId,
    { bestMove?: { from: string; to: string }; candidates?: { from: string; to: string }[] } | null
  >;
}

const PUBLIC_EFFECT_IDS = new Set([
  'time_force',
  'q_timecut',
  'q_harder',
  'q_weak',
  'q_lockreroll',
  'q_shuffle',
  'q_flash',
]);

function buildPlayerView(
  target: PlayerState,
  viewer: PlayerId | 'spectator',
  snap: FullGameSnapshot
): PublicPlayerView {
  const isSelf = viewer === target.id;
  const isSpectator = viewer === 'spectator';

  let coins: number | null = isSelf || isSpectator ? target.coins : null;
  let streak: number | null = isSelf || isSpectator ? target.streak : null;
  let revealedHand: { name: string; level?: 1 | 2 | 3 | 4 }[] | null = null;
  let revealedHistory: RevealedHistoryItem[] | null = null;
  let revealedShop: { items?: PlayerShopState['items']; boughtNames: string[] } | null = null;

  if (!isSelf && !isSpectator) {
    // Kiểm tra các thẻ Nhóm 3 mà viewer đang bật lên đối thủ
    const viewerEffects = snap.activeEffects.filter((e) => e.owner === viewer);

    const peekCoins = viewerEffects.find((e) => e.cardId === 'peek_coins');
    if (peekCoins) {
      coins = target.coins;
      if (peekCoins.level >= 4) streak = target.streak;
    }

    const peekVault = viewerEffects.find((e) => e.cardId === 'peek_vault');
    if (peekVault) {
      if (peekVault.level === 4) {
        revealedHand = target.hand.map((h) => ({
          name: getCardDef(h.cardId).name,
          level: h.level,
        }));
      } else if (Array.isArray(peekVault.data?.snapshot)) {
        revealedHand = peekVault.data.snapshot as { name: string }[];
      }
    }

    const peekHistory = viewerEffects.find((e) => e.cardId === 'peek_history');
    if (peekHistory && Array.isArray(peekHistory.data?.items)) {
      const rawItems = peekHistory.data.items as UsedCardLog[];
      revealedHistory = rawItems.map((it) =>
        peekHistory.level >= 4
          ? {
              name: it.name,
              group: it.group,
              level: it.level,
              atPly: it.atPly,
              atClockMs: it.atClockMs,
            }
          : {
              name: it.name,
              group: it.group,
            }
      );
    }

    const peekShop = viewerEffects.find((e) => e.cardId === 'peek_shop');
    const oppShop = snap.shops[target.id];
    if (peekShop && oppShop) {
      if (peekShop.level === 1) {
        revealedShop = { boughtNames: [...oppShop.boughtNames] };
      } else {
        revealedShop = {
          items: oppShop.items.map((it) => ({ ...it })),
          boughtNames: [...oppShop.boughtNames],
        };
      }
    }
  }

  return {
    id: target.id,
    name: target.name,
    elo: target.elo,
    color: target.color,
    clockMs: target.clockMs,
    freezeRemainingMs: target.freezeRemainingMs,
    coins,
    streak,
    handCount: target.hand.length,
    hand: isSelf ? target.hand.map((h) => ({ ...h })) : null,
    revealedHand,
    revealedHistory,
    revealedShop,
    sinceQuiz: target.sinceQuiz,
    harmfulCooldown: isSelf ? target.harmfulCooldown : 0,
    flashUsed: target.flashUsed,
    connected: target.connected,
    ready: target.ready,
  };
}

export function viewFor(
  viewer: PlayerId | 'spectator',
  snap: FullGameSnapshot
): PublicState {
  const visibleEffects = snap.activeEffects
    .filter((eff) => {
      if (viewer === 'spectator') {
        return PUBLIC_EFFECT_IDS.has(eff.cardId);
      }
      if (eff.owner === viewer) return true;
      return PUBLIC_EFFECT_IDS.has(eff.cardId);
    })
    .map((eff) => ({ ...eff }));

  // Pending harmful không lộ tên/cardId cho nạn nhân trước khi áp dụng (chỉ lộ group)
  let visiblePending = snap.pendingHarmful ? { ...snap.pendingHarmful } : null;
  if (visiblePending && viewer !== visiblePending.caster) {
    visiblePending = {
      ...visiblePending,
      cardId: 'hidden',
    };
  }

  const visibleEvents = snap.events.slice(-15).map((ev) => {
    if (viewer === 'spectator' || ev.by === viewer) return ev;
    // Nếu đối thủ dùng thẻ không phải public hoặc chưa có peek_track, giấu tên chi tiết đã được xử lý khi tạo event hoặc lọc ở đây
    return ev;
  });

  return {
    phase: snap.phase,
    hostNow: snap.hostNow,
    clockSeconds: snap.clockSeconds,
    fen: snap.fen,
    turn: snap.turn,
    lastMove: snap.lastMove,
    ply: snap.ply,
    phaseDeadlineAt: snap.phaseDeadlineAt,
    preQuizPassed: { ...snap.preQuizPassed },
    preQuizGroup4Used: { ...snap.preQuizGroup4Used },
    shopDone: {
      p1: Boolean(snap.shops.p1?.done),
      p2: Boolean(snap.shops.p2?.done),
    },
    activeEffects: visibleEffects,
    pendingHarmful: visiblePending,
    forceMove: snap.forceMove ? { ...snap.forceMove } : null,
    drawOfferBy: snap.drawOfferBy,
    p1: buildPlayerView(snap.p1, viewer, snap),
    p2: buildPlayerView(snap.p2, viewer, snap),
    events: visibleEvents,
    gameOver: snap.gameOver,
    freeM2Choice: viewer === 'spectator' ? null : snap.freeM2Choices[viewer],
    weakTopicHint: viewer === 'spectator' ? null : snap.weakTopicHints[viewer],
    analysisHint:
      viewer === 'spectator' || !snap.analysisHints[viewer]
        ? null
        : {
            bestMove: visibleEffects.some((e) => e.owner === viewer && e.cardId === 'sup_hint')
              ? snap.analysisHints[viewer]?.bestMove
              : undefined,
            candidates: visibleEffects.some((e) => e.owner === viewer && e.cardId === 'sup_cand')
              ? snap.analysisHints[viewer]?.candidates
              : undefined,
          },
  };
}
