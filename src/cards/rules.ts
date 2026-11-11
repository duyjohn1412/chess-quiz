import { CFG } from '../config/defaults';
import { getCardDef } from './registry';
import { GamePhase, HeldCard, PendingHarmful, PlayerId, PlayerState } from '../types/game';

export interface CanUseCardContext {
  phase: GamePhase;
  currentTurnColor: 'w' | 'b';
  player: PlayerState;
  card: HeldCard;
  pendingHarmful: PendingHarmful | null;
  preQuizGroup4Used: boolean;
  hasActiveShieldCharge: boolean;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function canUseCard(ctx: CanUseCardContext): ValidationResult {
  const def = getCardDef(ctx.card.cardId);

  // Lá chắn dùng trong cửa sổ pending khi mình là target
  if (def.id === 'q_shield') {
    if (!ctx.pendingHarmful || ctx.pendingHarmful.target !== ctx.player.id) {
      return { ok: false, reason: 'Chỉ dùng Lá chắn khi đang bị thẻ gây hại nhắm vào' };
    }
    if (ctx.pendingHarmful.reflected) {
      return { ok: false, reason: 'Không thể dùng Lá chắn lên thẻ đã bị phản lại' };
    }
    return { ok: true };
  }

  // Các thẻ khác không dùng được khi đang có cửa sổ pending chờ xử lý
  if (ctx.pendingHarmful) {
    return { ok: false, reason: 'Đang chờ xử lý thẻ gây hại' };
  }

  // Kiểm tra giới hạn số lần dùng trong ván
  if ((ctx.player.usedCount[def.id] ?? 0) >= CFG.maxCardsPerTypePerGame) {
    return { ok: false, reason: `Đã dùng tối đa ${CFG.maxCardsPerTypePerGame} lần thẻ này trong ván` };
  }

  if (def.id === 'q_flash' && ctx.player.flashUsed >= CFG.flashMaxPerPlayer) {
    return { ok: false, reason: `Đã dùng tối đa ${CFG.flashMaxPerPlayer} thẻ Flash trong ván` };
  }

  // Kiểm tra cooldown thẻ gây hại
  if (def.harmful && ctx.player.harmfulCooldown > 0) {
    return {
      ok: false,
      reason: `Thẻ gây hại đang hồi (${ctx.player.harmfulCooldown} nước nữa)`,
    };
  }

  // Kiểm tra phase sử dụng
  if (def.group === 'quiz') {
    if (def.id === 'q_flash') {
      if (ctx.phase === 'PRE_QUIZ') {
        if (ctx.preQuizGroup4Used) {
          return { ok: false, reason: 'Mỗi quiz chỉ được dùng 1 thẻ nhóm 4' };
        }
        return { ok: true };
      }
      if (ctx.phase === 'PLAYING') {
        if (ctx.player.color !== ctx.currentTurnColor) {
          return { ok: false, reason: 'Chỉ dùng thẻ ở lượt của bạn' };
        }
        if (ctx.player.cardsUsedThisTurn >= CFG.maxCardsPerTurn) {
          return { ok: false, reason: `Tối đa ${CFG.maxCardsPerTurn} thẻ mỗi lượt` };
        }
        return { ok: true };
      }
      return { ok: false, reason: 'Không thể dùng Flash ở trạng thái hiện tại' };
    }

    if (ctx.phase !== 'PRE_QUIZ') {
      return { ok: false, reason: 'Thẻ tác động quiz chỉ dùng được ở giai đoạn Trước Quiz' };
    }
    if (ctx.preQuizGroup4Used) {
      return { ok: false, reason: 'Mỗi quiz chỉ được dùng tối đa 1 thẻ nhóm 4' };
    }
    return { ok: true };
  }

  // Nhóm 1, 2, 3 chỉ dùng ở PLAYING và đúng lượt mình
  if (ctx.phase !== 'PLAYING') {
    return { ok: false, reason: 'Thẻ này chỉ dùng được khi đang chơi cờ' };
  }
  if (ctx.player.color !== ctx.currentTurnColor) {
    return { ok: false, reason: 'Chỉ dùng thẻ khi đang tới lượt của bạn' };
  }
  if (ctx.player.cardsUsedThisTurn >= CFG.maxCardsPerTurn) {
    return { ok: false, reason: `Tối đa ${CFG.maxCardsPerTurn} thẻ mỗi lượt` };
  }

  return { ok: true };
}

export function canUseExtraShieldCharge(
  playerId: PlayerId,
  pendingHarmful: PendingHarmful | null,
  extraCharges: number
): boolean {
  if (extraCharges <= 0) return false;
  if (!pendingHarmful) return false;
  if (pendingHarmful.target !== playerId) return false;
  if (pendingHarmful.reflected) return false;
  return true;
}
