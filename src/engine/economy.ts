import { CFG } from '../config/defaults';

export function getSpeedFactor(elapsedMs: number, totalQuizMs: number): number {
  const safeTotal = Math.max(1000, totalQuizMs);
  const ratio = Math.max(0, elapsedMs) / safeTotal;
  for (const band of CFG.speedFactor) {
    if (ratio <= band.maxRatio) return band.f;
  }
  return 1.0;
}

export function calcQuizCoins(
  difficulty: 1 | 2 | 3,
  elapsedMs: number,
  totalQuizMs: number,
  isCorrect: boolean
): number {
  if (!isCorrect) return 0;
  const base = CFG.baseCoins[difficulty];
  const factor = getSpeedFactor(elapsedMs, totalQuizMs);
  return Math.floor(base * factor);
}
