import { CFG } from '../config/defaults';
import { applyDiscount, getCardPrice } from '../cards/pricing';
import { CardDef, CardGroup, CardLevel, CARDS, CARDS_BY_GROUP } from '../cards/registry';
import { ShopItem } from '../types/game';

export interface GenerateShopOptions {
  prevShopGroups: CardGroup[];
  usedCount: Record<string, number>;
  flashUsed: number;
  discount: number;
  rng?: () => number;
}

export function pickShopLevel(rng: () => number = Math.random): CardLevel {
  const r = rng();
  const w1 = CFG.shopLevelWeights[1];
  const w2 = CFG.shopLevelWeights[2];
  const w3 = CFG.shopLevelWeights[3];
  if (r < w1) return 1;
  if (r < w1 + w2) return 2;
  if (r < w1 + w2 + w3) return 3;
  return 4;
}

function isCardEligible(
  card: CardDef,
  usedCount: Record<string, number>,
  flashUsed: number
): boolean {
  if ((usedCount[card.id] ?? 0) >= CFG.maxCardsPerTypePerGame) return false;
  if (card.id === 'q_flash' && flashUsed >= CFG.flashMaxPerPlayer) return false;
  return true;
}

export function generateShopItems(opts: GenerateShopOptions): {
  items: ShopItem[];
  groupsPresent: CardGroup[];
} {
  const rng = opts.rng ?? Math.random;
  const count = CFG.shopItems;
  const eligible = CARDS.filter((c) => isCardEligible(c, opts.usedCount, opts.flashUsed));
  const pool = eligible.length >= count ? eligible : [...CARDS];

  const chosen: CardDef[] = [];
  const chosenIds = new Set<string>();

  // Ràng buộc: mỗi nhóm thiếu ở shop trước phải có mặt ở shop này
  const prevSet = new Set(opts.prevShopGroups);
  const allGroups: CardGroup[] = ['time', 'support', 'peek', 'quiz'];
  const missingGroups = allGroups.filter((g) => !prevSet.has(g));

  for (const g of missingGroups) {
    if (chosen.length >= count) break;
    const groupCards = CARDS_BY_GROUP[g].filter(
      (c) => !chosenIds.has(c.id) && isCardEligible(c, opts.usedCount, opts.flashUsed)
    );
    const fallbackGroup = CARDS_BY_GROUP[g].filter((c) => !chosenIds.has(c.id));
    const source = groupCards.length > 0 ? groupCards : fallbackGroup;
    if (source.length > 0) {
      const pick = source[Math.floor(rng() * source.length)];
      chosen.push(pick);
      chosenIds.add(pick.id);
    }
  }

  // Chọn nốt đến đủ 6 thẻ không trùng
  while (chosen.length < count) {
    const remaining = pool.filter((c) => !chosenIds.has(c.id));
    if (remaining.length === 0) break;
    const pick = remaining[Math.floor(rng() * remaining.length)];
    chosen.push(pick);
    chosenIds.add(pick.id);
  }

  // Gán mức ngẫu nhiên theo trọng số, đảm bảo >= 2 thẻ mức 1-2
  const levels: CardLevel[] = chosen.map(() => pickShopLevel(rng));
  let lowCount = levels.filter((l) => l === 1 || l === 2).length;
  for (let i = 0; i < levels.length && lowCount < 2; i++) {
    if (levels[i] > 2) {
      levels[i] = rng() < 0.6 ? 1 : 2;
      lowCount += 1;
    }
  }

  // Xáo trộn vị trí 6 slot
  const paired = chosen.map((card, i) => ({ card, level: levels[i] }));
  for (let i = paired.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = paired[i];
    paired[i] = paired[j];
    paired[j] = tmp;
  }

  const items: ShopItem[] = paired.map(({ card, level }, slot) => {
    const basePrice = getCardPrice(card.id, level);
    const finalPrice = applyDiscount(basePrice, opts.discount);
    return {
      slot,
      cardId: card.id,
      level,
      basePrice,
      finalPrice,
      bought: false,
    };
  });

  const groupsPresent = Array.from(new Set(paired.map((p) => p.card.group)));
  return { items, groupsPresent };
}
