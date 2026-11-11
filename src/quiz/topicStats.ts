import { TopicStat } from '../types/game';

export function recordTopicAnswer(
  stats: Record<string, TopicStat>,
  topic: string,
  isCorrect: boolean
): Record<string, TopicStat> {
  const prev = stats[topic] ?? { asked: 0, wrong: 0 };
  return {
    ...stats,
    [topic]: {
      asked: prev.asked + 1,
      wrong: prev.wrong + (isCorrect ? 0 : 1),
    },
  };
}

export function getWeakestTopic(
  stats: Record<string, TopicStat>,
  allTopics: string[],
  rng: () => number = Math.random
): string | null {
  let totalAsked = 0;
  for (const s of Object.values(stats)) totalAsked += s.asked;

  // Spec 4.5: cần >= 3 câu đã trả lời trong ván, nếu chưa đủ thì chọn chủ đề ngẫu nhiên
  if (totalAsked < 3) {
    if (allTopics.length === 0) return null;
    return allTopics[Math.floor(rng() * allTopics.length)] ?? allTopics[0];
  }

  let weakestTopic: string | null = null;
  let worstWrong = -1;
  let worstRate = -1;

  for (const [topic, s] of Object.entries(stats)) {
    if (s.asked === 0) continue;
    const rate = s.wrong / s.asked;
    if (s.wrong > worstWrong || (s.wrong === worstWrong && rate > worstRate)) {
      worstWrong = s.wrong;
      worstRate = rate;
      weakestTopic = topic;
    }
  }

  if (weakestTopic && worstWrong > 0) return weakestTopic;
  if (allTopics.length === 0) return null;
  return allTopics[Math.floor(rng() * allTopics.length)] ?? allTopics[0];
}
