import { CFG } from '../config/defaults';

export function computeShopDiscount(
  selfClockMs: number,
  oppClockMs: number,
  hasStreak3Discount: boolean
): number {
  const isTrailing =
    oppClockMs > 0 && selfClockMs < oppClockMs * (1 - CFG.trailingThreshold);
  const trailing = isTrailing ? CFG.trailingDiscount : 0;
  const streak = hasStreak3Discount ? CFG.streak3Discount : 0;
  // Không cộng dồn, lấy mức cao nhất
  return Math.max(trailing, streak);
}
