import { z } from 'zod';
import rawCards from '../../data/cards.json';

export const CardGroupSchema = z.enum(['time', 'support', 'peek', 'quiz']);
export type CardGroup = z.infer<typeof CardGroupSchema>;

export const CardLevelNumSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type CardLevel = z.infer<typeof CardLevelNumSchema>;

export const CardLevelSchema = z.object({
  level: CardLevelNumSchema,
  value: z.number(),
  desc: z.string().min(1),
});

export const CardDefSchema = z.object({
  id: z.string().min(1),
  group: CardGroupSchema,
  name: z.string().min(1),
  icon: z.string().min(1),
  priceMult: z.number().positive(),
  harmful: z.boolean(),
  levels: z.array(CardLevelSchema).length(4),
});

export const CardsFileSchema = z.object({
  version: z.number().int().positive(),
  basePrice: z.object({
    '1': z.number().positive(),
    '2': z.number().positive(),
    '3': z.number().positive(),
    '4': z.number().positive(),
  }),
  cards: z.array(CardDefSchema).min(1),
});

export type CardDef = z.infer<typeof CardDefSchema>;
export type CardsFile = z.infer<typeof CardsFileSchema>;

export const GROUP_META: Record<CardGroup, { label: string; color: string; icon: string }> = {
  time: { label: 'Thời gian', color: '#f5a524', icon: '⏱' },
  support: { label: 'Hỗ trợ chiến thuật', color: '#3ecf8e', icon: '🧭' },
  peek: { label: 'Xem thẻ đối thủ', color: '#7c5cff', icon: '👁' },
  quiz: { label: 'Tác động câu hỏi', color: '#ff5c7a', icon: '🎯' },
};

const parsed = CardsFileSchema.parse(rawCards);

export const CARDS_DATA: CardsFile = parsed;
export const CARDS: CardDef[] = parsed.cards;

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(
  CARDS.map((c) => [c.id, c])
);

export const CARDS_BY_GROUP: Record<CardGroup, CardDef[]> = {
  time: CARDS.filter((c) => c.group === 'time'),
  support: CARDS.filter((c) => c.group === 'support'),
  peek: CARDS.filter((c) => c.group === 'peek'),
  quiz: CARDS.filter((c) => c.group === 'quiz'),
};

export function getCardDef(cardId: string): CardDef {
  const def = CARD_BY_ID[cardId];
  if (!def) throw new Error(`Không tìm thấy thẻ: ${cardId}`);
  return def;
}

export function getCardLevel(cardId: string, level: CardLevel) {
  const def = getCardDef(cardId);
  const lvl = def.levels.find((l) => l.level === level);
  if (!lvl) throw new Error(`Không tìm thấy mức ${level} của thẻ ${cardId}`);
  return lvl;
}
