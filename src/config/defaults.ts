export const CFG = {
  clockSeconds: 300,            // lobby chọn 180 | 300 | 600
  movesPerQuiz: 3,              // mỗi bên đi 3 nước thì kích hoạt quiz
  quizSeconds: 20,
  preQuizSeconds: 10,
  resultSeconds: 3,
  shopSeconds: 20,
  shopItems: 6,
  shopRefreshCost: 5,
  handMax: 3,
  maxCardsPerTypePerGame: 2,    // mỗi người, mỗi loại thẻ (id)
  maxCardsPerTurn: 2,
  harmfulCooldownPlies: 6,      // 6 nước của chính người dùng thẻ
  harmfulPendingSeconds: 2,     // cửa sổ chờ Lá chắn (đã chỉnh theo yêu cầu: 2 giây)
  timeBonusCapRatio: 0.4,       // tổng giờ cộng thêm <= 40% đồng hồ gốc / người
  clockFloorSeconds: 10,        // Trừ giờ không đưa đồng hồ đối thủ xuống dưới mức này
  wrongPenaltySeconds: 5,       // chỉ khi đúng một người đúng
  rerollWindowSeconds: 3,       // 3s đầu quiz được bấm Đổi câu
  reconnectGraceSeconds: 60,
  maxSpectators: 5,
  difficultyWeights: { 1: 0.4, 2: 0.4, 3: 0.2 } as Record<1 | 2 | 3, number>,
  baseCoins: { 1: 10, 2: 15, 3: 20 } as Record<1 | 2 | 3, number>,
  speedFactor: [
    { maxRatio: 1 / 3, f: 2.0 },
    { maxRatio: 2 / 3, f: 1.5 },
    { maxRatio: 1, f: 1.0 },
  ],
  streakBonus: { 2: 5, 3: 10, 5: 20 } as Record<number, number>,
  shopLevelWeights: { 1: 0.45, 2: 0.35, 3: 0.15, 4: 0.05 } as Record<1 | 2 | 3 | 4, number>,
  trailingDiscount: 0.2,
  trailingThreshold: 0.3,
  streak3Discount: 0.2,
  flashMaxPerPlayer: 2,
  flashSeconds: 0.5,
  flashGapSeconds: 3,
} as const;

export const CARD_BASE_PRICE: Record<1 | 2 | 3 | 4, number> = {
  1: 10,
  2: 20,
  3: 45,
  4: 70,
};
