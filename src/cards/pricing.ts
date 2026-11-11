import { CARD_BASE_PRICE } from '../config/defaults';
import { CardLevel, getCardDef } from './registry';

export function calcRawPrice(priceMult: number, level: CardLevel): number {
  const base = CARD_BASE_PRICE[level];
  const rounded = Math.round((base * priceMult) / 5) * 5;
  return level === 1 ? Math.max(10, rounded) : Math.max(5, rounded);
}

export function getCardPrice(cardId: string, level: CardLevel): number {
  const def = getCardDef(cardId);
  return calcRawPrice(def.priceMult, level);
}

export function applyDiscount(price: number, discountRatio: number): number {
  if (discountRatio <= 0) return price;
  const pct = Math.min(95, Math.max(0, Math.round(discountRatio * 100)));
  const scaled = price * (100 - pct);
  return Math.max(5, Math.ceil(scaled / 500) * 5);
}
