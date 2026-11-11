import { CFG } from '../config/defaults';

export interface StreakUpdate {
  streak: number;
  streak5Granted: boolean;
  bonusCoins: number;
  grantShopDiscount: boolean;
  grantFreeM2Choice: boolean;
}

export function updateStreak(
  prevStreak: number,
  prevStreak5Granted: boolean,
  isCorrect: boolean
): StreakUpdate {
  if (!isCorrect) {
    return {
      streak: 0,
      streak5Granted: false,
      bonusCoins: 0,
      grantShopDiscount: false,
      grantFreeM2Choice: false,
    };
  }

  const nextStreak = prevStreak + 1;
  const bonusCoins = CFG.streakBonus[nextStreak] ?? 0;
  const grantShopDiscount = nextStreak === 3;
  const grantFreeM2Choice = nextStreak === 5 && !prevStreak5Granted;
  const streak5Granted = prevStreak5Granted || grantFreeM2Choice;

  return {
    streak: nextStreak,
    streak5Granted,
    bonusCoins,
    grantShopDiscount,
    grantFreeM2Choice,
  };
}
