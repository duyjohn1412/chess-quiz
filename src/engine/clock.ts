import { CFG } from '../config/defaults';

export function applyTimeBonus(
  currentClockMs: number,
  addSeconds: number,
  bonusTimeGivenMs: number,
  originalClockSeconds: number
): { clockMs: number; addedMs: number; bonusTimeGivenMs: number } {
  const capMs = Math.round(originalClockSeconds * 1000 * CFG.timeBonusCapRatio);
  const remainingCapMs = Math.max(0, capMs - bonusTimeGivenMs);
  const requestedMs = Math.max(0, Math.round(addSeconds * 1000));
  const addedMs = Math.min(requestedMs, remainingCapMs);
  return {
    clockMs: currentClockMs + addedMs,
    addedMs,
    bonusTimeGivenMs: bonusTimeGivenMs + addedMs,
  };
}

export function applyTimePenalty(
  currentClockMs: number,
  subtractSeconds: number,
  floorSeconds: number = CFG.clockFloorSeconds
): { clockMs: number; deductedMs: number } {
  const floorMs = Math.max(0, Math.round(floorSeconds * 1000));
  const requestedMs = Math.max(0, Math.round(subtractSeconds * 1000));
  if (currentClockMs <= floorMs) {
    return { clockMs: currentClockMs, deductedMs: 0 };
  }
  const nextMs = Math.max(floorMs, currentClockMs - requestedMs);
  return {
    clockMs: nextMs,
    deductedMs: currentClockMs - nextMs,
  };
}

export function applyForceMovePenalty(currentClockMs: number): {
  clockMs: number;
  deductedMs: number;
} {
  // Trừ 1/8 thời gian còn lại, giữ tối thiểu 1s để không tự xử thua ngay lập tức
  const eighth = Math.round(currentClockMs / 8);
  const nextMs = Math.max(1000, currentClockMs - eighth);
  const deductedMs = Math.max(0, currentClockMs - nextMs);
  return { clockMs: nextMs, deductedMs };
}

export function tickClock(
  clockMs: number,
  deltaMs: number,
  freezeRemainingMs: number
): { clockMs: number; freezeRemainingMs: number; timedOut: boolean } {
  if (deltaMs <= 0) {
    return { clockMs, freezeRemainingMs, timedOut: clockMs <= 0 };
  }
  if (freezeRemainingMs > 0) {
    if (deltaMs <= freezeRemainingMs) {
      return {
        clockMs,
        freezeRemainingMs: freezeRemainingMs - deltaMs,
        timedOut: false,
      };
    }
    const leftover = deltaMs - freezeRemainingMs;
    const nextClock = Math.max(0, clockMs - leftover);
    return {
      clockMs: nextClock,
      freezeRemainingMs: 0,
      timedOut: nextClock <= 0,
    };
  }
  const nextClock = Math.max(0, clockMs - deltaMs);
  return {
    clockMs: nextClock,
    freezeRemainingMs: 0,
    timedOut: nextClock <= 0,
  };
}
