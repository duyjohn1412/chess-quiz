import { CFG } from '../config/defaults';
import { Question } from '../types/game';

export interface PickQuestionOptions {
  pool: Question[];
  usedIds: Set<string>;
  topicSeenCounts?: Record<string, number>;
  forcedDifficulty?: 1 | 2 | 3;
  minDifficultyBump?: boolean; // e.g. Dễ -> Vừa
  bumpByOne?: boolean;         // +1 bậc
  forcedTopic?: string;
  baseDifficulty?: 1 | 2 | 3;
  rng?: () => number;
}

export function pickWeightedDifficulty(
  weights: Record<1 | 2 | 3, number> = CFG.difficultyWeights,
  rng: () => number = Math.random
): 1 | 2 | 3 {
  const r = rng();
  const w1 = weights[1];
  const w2 = weights[2];
  if (r < w1) return 1;
  if (r < w1 + w2) return 2;
  return 3;
}

export function pickQuestion(opts: PickQuestionOptions): Question | null {
  const rng = opts.rng ?? Math.random;
  let available = opts.pool.filter((q) => !opts.usedIds.has(q.id));
  if (available.length === 0) {
    // Nếu hết câu mới trong ván thì tái sử dụng pool để không kẹt ván
    available = [...opts.pool];
  }
  if (available.length === 0) return null;

  let targetDiff: 1 | 2 | 3 = opts.baseDifficulty ?? pickWeightedDifficulty(CFG.difficultyWeights, rng);
  if (opts.forcedDifficulty) {
    targetDiff = opts.forcedDifficulty;
  } else if (opts.bumpByOne) {
    targetDiff = Math.min(3, targetDiff + 1) as 1 | 2 | 3;
  } else if (opts.minDifficultyBump && targetDiff === 1) {
    targetDiff = 2;
  }

  // Lọc theo topic nếu có ép chủ đề
  let candidates = available;
  if (opts.forcedTopic) {
    const byTopic = candidates.filter((q) => q.topic === opts.forcedTopic);
    if (byTopic.length > 0) candidates = byTopic;
  }

  // Lọc theo độ khó mục tiêu (fallback về gần nhất nếu hết)
  const byDiff = candidates.filter((q) => q.difficulty === targetDiff);
  if (byDiff.length > 0) {
    candidates = byDiff;
  }

  // Ưu tiên chủ đề ít gặp nhất
  const seen = opts.topicSeenCounts ?? {};
  let minSeen = Infinity;
  for (const q of candidates) {
    const c = seen[q.topic] ?? 0;
    if (c < minSeen) minSeen = c;
  }
  const leastSeen = candidates.filter((q) => (seen[q.topic] ?? 0) === minSeen);
  const chosenPool = leastSeen.length > 0 ? leastSeen : candidates;

  const idx = Math.floor(rng() * chosenPool.length);
  return chosenPool[idx] ?? chosenPool[0] ?? null;
}
