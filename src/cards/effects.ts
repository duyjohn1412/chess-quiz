import { CardLevel, getCardDef, getCardLevel } from './registry';
import { ActiveEffect, PlayerId } from '../types/game';

const DEBUFF_CARD_IDS = new Set([
  'time_force',
  'q_timecut',
  'q_harder',
  'q_weak',
  'q_lockreroll',
  'q_shuffle',
  'q_flash',
]);

/**
 * Thêm hiệu ứng mới, tuân theo quy tắc chống chồng debuff:
 * cùng cardId lên cùng target -> giữ mức cao hơn, bỏ mức thấp hơn.
 */
export function upsertEffect(
  effects: ActiveEffect[],
  next: ActiveEffect
): ActiveEffect[] {
  if (DEBUFF_CARD_IDS.has(next.cardId) && next.target) {
    const existing = effects.find(
      (e) => e.cardId === next.cardId && e.target === next.target
    );
    if (existing) {
      if (existing.level >= next.level) {
        return effects; // giữ mức cao hơn đang có
      }
      return [...effects.filter((e) => e.uid !== existing.uid), next];
    }
  }
  // Với thẻ cùng loại của bản thân (ví dụ Radar, Quét ô, Đánh giá, Theo dõi...), giữ cái mới hơn nếu mức >=
  const selfDup = effects.find(
    (e) => e.cardId === next.cardId && e.owner === next.owner && e.target === next.target
  );
  if (selfDup) {
    return [...effects.filter((e) => e.uid !== selfDup.uid), next];
  }
  return [...effects, next];
}

export function buildCardEffect(
  uid: string,
  cardId: string,
  level: CardLevel,
  owner: PlayerId,
  oppId: PlayerId,
  extraData?: Record<string, unknown>
): ActiveEffect | null {
  const def = getCardDef(cardId);
  const lvl = getCardLevel(cardId, level);

  switch (cardId) {
    case 'time_force':
      return {
        uid,
        cardId,
        level,
        owner,
        target: oppId,
        kind: 'force_move',
        expires: { type: 'next-turn-of', playerId: oppId },
        data: { limitSec: lvl.value },
      };
    case 'sup_radar':
    case 'sup_scan':
    case 'sup_eval':
      return {
        uid,
        cardId,
        level,
        owner,
        target: null,
        kind: def.id,
        expires: { type: 'owner-plies', n: lvl.value },
      };
    case 'sup_plan':
    case 'sup_hint':
    case 'sup_cand':
      return {
        uid,
        cardId,
        level,
        owner,
        target: null,
        kind: def.id,
        expires: { type: 'until-end-turn', playerId: owner },
        data: extraData,
      };
    case 'peek_vault':
      // M1-M3: chụp 1 lần hiển thị đến hết lượt kế (owner-plies = 2 -> hết lượt này + lượt kế, hoặc 1 nếu chỉ lượt này; spec nói "hiển thị đến hết lượt kế tiếp" -> 2 owner-plies). M4: giữ 3 lượt.
      return {
        uid,
        cardId,
        level,
        owner,
        target: oppId,
        kind: 'peek_vault',
        expires: { type: 'owner-plies', n: level === 4 ? 3 : 2 },
        data: extraData,
      };
    case 'peek_track':
    case 'peek_coins':
      return {
        uid,
        cardId,
        level,
        owner,
        target: oppId,
        kind: def.id,
        expires: { type: 'owner-plies', n: lvl.value },
      };
    case 'peek_history':
      return {
        uid,
        cardId,
        level,
        owner,
        target: oppId,
        kind: 'peek_history',
        expires: { type: 'until-end-turn', playerId: owner },
        data: extraData,
      };
    case 'peek_shop':
      return {
        uid,
        cardId,
        level,
        owner,
        target: oppId,
        kind: 'peek_shop',
        expires: { type: 'shops', n: lvl.value },
      };
    case 'q_timecut':
    case 'q_shuffle':
    case 'q_hide':
      return {
        uid,
        cardId,
        level,
        owner,
        target: cardId === 'q_hide' ? owner : oppId,
        kind: def.id,
        expires: { type: 'quizzes', n: 1 },
      };
    case 'q_harder':
      return {
        uid,
        cardId,
        level,
        owner,
        target: oppId,
        kind: 'q_harder',
        expires: { type: 'quizzes', n: level === 4 ? 2 : 1 },
      };
    case 'q_weak':
      if (level === 1) {
        return {
          uid,
          cardId,
          level,
          owner,
          target: oppId,
          kind: 'q_weak_hint',
          expires: { type: 'quizzes', n: 1 },
          data: extraData,
        };
      }
      return {
        uid,
        cardId,
        level,
        owner,
        target: oppId,
        kind: 'q_weak',
        expires: { type: 'quizzes', n: level === 4 ? 2 : 1 },
        data: extraData,
      };
    case 'q_lockreroll':
      return {
        uid,
        cardId,
        level,
        owner,
        target: oppId,
        kind: 'q_lockreroll',
        expires: { type: 'quizzes', n: lvl.value },
      };
    default:
      return null;
  }
}

export function tickEffectsAfterOwnerMove(
  effects: ActiveEffect[],
  moverId: PlayerId
): ActiveEffect[] {
  const next: ActiveEffect[] = [];
  for (const eff of effects) {
    if (eff.expires.type === 'until-end-turn' && eff.expires.playerId === moverId) {
      continue;
    }
    if (eff.expires.type === 'next-turn-of' && eff.expires.playerId === moverId) {
      continue;
    }
    if (eff.expires.type === 'owner-plies' && eff.owner === moverId) {
      const rem = eff.expires.n - 1;
      if (rem > 0) {
        next.push({ ...eff, expires: { type: 'owner-plies', n: rem } });
      }
      continue;
    }
    next.push(eff);
  }
  return next;
}

export function tickEffectsAfterQuiz(effects: ActiveEffect[]): ActiveEffect[] {
  const next: ActiveEffect[] = [];
  for (const eff of effects) {
    if (eff.expires.type === 'quizzes') {
      const rem = eff.expires.n - 1;
      if (rem > 0) {
        next.push({ ...eff, expires: { type: 'quizzes', n: rem } });
      }
      continue;
    }
    next.push(eff);
  }
  return next;
}

export function tickEffectsAfterShop(effects: ActiveEffect[]): ActiveEffect[] {
  const next: ActiveEffect[] = [];
  for (const eff of effects) {
    if (eff.expires.type === 'shops') {
      const rem = eff.expires.n - 1;
      if (rem > 0) {
        next.push({ ...eff, expires: { type: 'shops', n: rem } });
      }
      continue;
    }
    next.push(eff);
  }
  return next;
}
