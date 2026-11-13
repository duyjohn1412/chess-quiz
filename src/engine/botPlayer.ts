import { Chess, PieceSymbol, Square } from 'chess.js';
import { computeRadarSquares, computeStaticMaterialEval } from '../analysis/analyzers';
import { Color, PlayerId } from '../types/game';
import { GameCoordinator } from './gameCoordinator';

export interface BotConfig {
  elo: number;
  searchDepth: number;
  blunderChance: number;
  optimalPickChance: number;
  quizAccuracy: number;
  shieldChance: number;
  cardUseChance: number;
  moveDelayMinMs: number;
  moveDelayMaxMs: number;
  quizDelayMinMs: number;
  quizDelayMaxMs: number;
}

export const BOT_NAMES = [
  'Minh Quân',
  'Hoàng Nam',
  'Tuấn Kiệt',
  'Bảo Long',
  'Thùy Trang',
  'Hương Giang',
  'Quang Huy',
  'Đức Anh',
  'Khánh Linh',
  'Việt Dũng',
  'Thành Đạt',
  'Ngọc Mai',
  'Văn Hùng',
  'Thanh Tùng',
  'Hồng Sơn',
  'Phương Anh',
  'Thái Sơn',
  'Anh Khoa',
  'Thu Hà',
  'Hữu Phước',
];

export function getRandomBotName(rng: () => number = Math.random): string {
  const idx = Math.floor(rng() * BOT_NAMES.length);
  return BOT_NAMES[idx] ?? 'Minh Quân';
}

export function computeBotElo(playerElo: number, rng: () => number = Math.random): number {
  // Bot Elo dao động gần playerElo (-30 đến +20) để đảm bảo điểm Elo tương đồng
  const delta = Math.floor(rng() * 51) - 30;
  return Math.max(600, Math.min(3000, Math.round(playerElo + delta)));
}

/**
 * Tính toán tham số độ khó của Bot theo Elo người chơi.
 * Mục tiêu: Xác suất thắng của bot luôn thấp hơn người chơi 1 chút (Bot ~40%, Người chơi ~60%).
 */
export function computeBotConfig(botElo: number, _playerElo: number): BotConfig {
  const clamped = Math.max(600, Math.min(2400, botElo));
  const t = (clamped - 600) / 1800; // 0.0 -> 1.0

  return {
    elo: clamped,
    searchDepth: Math.max(2, Math.min(6, Math.round(2 + t * 4))),
    // Tỉ lệ mắc lỗi giảm dần theo Elo (24% ở Elo thấp -> 8% ở Elo cao)
    blunderChance: Math.max(0.08, 0.24 - t * 0.16),
    // Tỉ lệ chọn nước đi tối ưu (65% -> 80%)
    optimalPickChance: Math.min(0.80, 0.65 + t * 0.15),
    // Tỉ lệ trả lời đúng Quiz thấp hơn người chơi (42% -> 58%)
    quizAccuracy: Math.max(0.42, Math.min(0.58, 0.42 + t * 0.16)),
    // Phản xạ dùng khiên khi bị tấn công
    shieldChance: Math.max(0.50, Math.min(0.85, 0.50 + t * 0.35)),
    // Tỉ lệ dùng thẻ trong ván
    cardUseChance: Math.max(0.20, Math.min(0.35, 0.20 + t * 0.15)),
    moveDelayMinMs: 1200,
    moveDelayMaxMs: 2600,
    quizDelayMinMs: 3200,
    quizDelayMaxMs: 6500,
  };
}

const PIECE_VAL: Record<PieceSymbol, number> = {
  p: 100,
  n: 310,
  b: 325,
  r: 500,
  q: 950,
  k: 20000,
};

const CENTER_SQUARES = new Set(['d4', 'd5', 'e4', 'e5', 'c4', 'c5', 'f4', 'f5']);

interface ScoredMove {
  from: string;
  to: string;
  promo?: 'q';
  score: number;
}

export function evaluateLegalMoves(
  fen: string,
  botColor: Color
): ScoredMove[] {
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return [];

  const scored: ScoredMove[] = legalMoves.map((m) => {
    let score = 0;
    const movingPiece = m.piece;
    const capturedPiece = m.captured;

    // 1. Kiểm tra chiếu hết
    const copy = new Chess(fen);
    copy.move(m);
    if (copy.isCheckmate()) {
      return { from: m.from, to: m.to, promo: m.promotion as 'q' | undefined, score: 99999 };
    }

    // 2. Điểm ăn quân (MVV-LVA)
    if (capturedPiece) {
      const victimVal = PIECE_VAL[capturedPiece] ?? 100;
      const moverVal = PIECE_VAL[movingPiece] ?? 100;
      score += victimVal * 1.5 - moverVal * 0.1;
    }

    // 3. Phong cấp Tốt
    if (m.promotion) {
      score += 800;
    }

    // 4. Chiếu Vua đối phương
    if (copy.inCheck()) {
      score += 45;
    }

    // 5. Kiểm soát trung tâm
    if (CENTER_SQUARES.has(m.to)) {
      score += 20;
    }

    // 6. Nhập thành an toàn Vua
    if (m.flags.includes('k') || m.flags.includes('q')) {
      score += 70;
    }

    // 7. Tránh đi quân vào ô bị đối thủ tấn công mà không có bảo vệ
    const attackedSquares = computeRadarSquares(copy.fen(), botColor);
    if (attackedSquares.includes(m.to as Square)) {
      score -= (PIECE_VAL[movingPiece] ?? 100) * 0.8;
    }

    // 8. Đánh giá vật chất sau nước đi
    const postEval = computeStaticMaterialEval(copy.fen()) * (botColor === 'w' ? 100 : -100);
    score += postEval * 0.4;

    return {
      from: m.from,
      to: m.to,
      promo: m.promotion as 'q' | undefined,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function pickBotMove(
  fen: string,
  botColor: Color,
  config: BotConfig,
  rng: () => number = Math.random
): { from: string; to: string; promo?: 'q' } | null {
  const scored = evaluateLegalMoves(fen, botColor);
  if (scored.length === 0) return null;
  if (scored.length === 1) return scored[0];

  // Nếu nước đầu tiên là chiếu hết, luôn chiếu hết
  if (scored[0].score >= 90000) return scored[0];

  const currentEval = computeStaticMaterialEval(fen) * (botColor === 'w' ? 1 : -1);

  // Điều tiết cân bằng động: Nếu bot đang dẫn quá nhiều (> +3 quân tốt),
  // bot chủ động không đánh nước gắt nhất mà chọn nước đứng thứ 2 hoặc 3 để người chơi có cơ hội lật ngược
  if (currentEval > 3.0 && scored.length > 2) {
    const pickIdx = 1 + Math.floor(rng() * Math.min(2, scored.length - 1));
    return scored[pickIdx];
  }

  // Tỉ lệ mắc sai lầm (blunder) theo cấu hình Elo
  const isBlunder = rng() < config.blunderChance;
  if (isBlunder && scored.length > 1) {
    // Chọn nước dưới top 1 (từ vị trí 1 đến 4)
    const maxIdx = Math.min(4, scored.length - 1);
    const pickIdx = 1 + Math.floor(rng() * maxIdx);
    return scored[pickIdx];
  }

  // Chọn nước tối ưu
  const isOptimal = rng() < config.optimalPickChance;
  if (isOptimal || scored.length < 2) {
    return scored[0];
  }

  // Chọn nước tốt thứ 2
  return scored[1];
}

export class BotPlayer {
  readonly botId: PlayerId;
  readonly botName: string;
  readonly botElo: number;
  readonly config: BotConfig;

  private coordinator: GameCoordinator;
  private rng: () => number;
  private destroyed = false;
  private moveTimeout: number | null = null;
  private quizTimeout: number | null = null;
  private preQuizTimeout: number | null = null;
  private shopTimeout: number | null = null;

  constructor(opts: {
    botId: PlayerId;
    botName: string;
    botElo: number;
    playerElo: number;
    coordinator: GameCoordinator;
    rng?: () => number;
  }) {
    this.botId = opts.botId;
    this.botName = opts.botName;
    this.botElo = opts.botElo;
    this.config = computeBotConfig(opts.botElo, opts.playerElo);
    this.coordinator = opts.coordinator;
    this.rng = opts.rng ?? Math.random;
  }

  start(): void {
    this.destroyed = false;
    this.onStateChange();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.moveTimeout !== null) clearTimeout(this.moveTimeout);
    if (this.quizTimeout !== null) clearTimeout(this.quizTimeout);
    if (this.preQuizTimeout !== null) clearTimeout(this.preQuizTimeout);
    if (this.shopTimeout !== null) clearTimeout(this.shopTimeout);
    this.moveTimeout = null;
    this.quizTimeout = null;
    this.preQuizTimeout = null;
    this.shopTimeout = null;
  }

  onStateChange(): void {
    if (this.destroyed) return;
    const snap = this.coordinator.getSnapshot();
    const phase = snap.phase;

    if (phase === 'GAME_OVER') {
      this.destroy();
      return;
    }

    if (phase === 'PLAYING') {
      this.handlePlayingTurn();
    } else if (phase === 'PRE_QUIZ') {
      this.handlePreQuizTurn();
    } else if (phase === 'QUIZ') {
      this.handleQuizTurn();
    } else if (phase === 'SHOP') {
      this.handleShopTurn();
    }
  }

  private handlePlayingTurn(): void {
    const snap = this.coordinator.getSnapshot();
    const botPlayer = this.botId === 'p1' ? snap.p1 : snap.p2;

    // 1. Xử lý phản xạ Khiên khi bị tấn công
    if (snap.pendingHarmful && snap.pendingHarmful.target === this.botId) {
      const shield = botPlayer.hand.find((h) => h.cardId === 'q_shield');
      if (shield && this.rng() < this.config.shieldChance) {
        this.coordinator.handleShield(this.botId, shield.uid);
      }
      return;
    }

    // 2. Kiểm tra xem có phải lượt đi cờ của Bot không
    const isBotTurn = botPlayer.color === snap.turn;
    if (!isBotTurn) {
      if (this.moveTimeout !== null) {
        clearTimeout(this.moveTimeout);
        this.moveTimeout = null;
      }
      return;
    }

    if (this.moveTimeout !== null) return; // Đang đợi thực hiện nước cờ

    // 3. Quyết định dùng thẻ (nếu có thẻ hợp lệ trong tay)
    if (botPlayer.hand.length > 0 && this.rng() < this.config.cardUseChance) {
      const usable = botPlayer.hand.filter((h) => !h.cardId.startsWith('q_'));
      if (usable.length > 0) {
        const card = usable[Math.floor(this.rng() * usable.length)];
        this.coordinator.handleUseCard(this.botId, card.uid);
      }
    }

    // 4. Lên lịch đi cờ với độ trễ tự nhiên (human-like delay)
    const delay =
      snap.forceMove && snap.forceMove.target === this.botId
        ? 800 // Đang bị Ép đi nhanh -> đi sớm hơn
        : this.config.moveDelayMinMs +
          Math.floor(this.rng() * (this.config.moveDelayMaxMs - this.config.moveDelayMinMs));

    this.moveTimeout = window.setTimeout(() => {
      this.moveTimeout = null;
      if (this.destroyed) return;
      const curSnap = this.coordinator.getSnapshot();
      const curBot = this.botId === 'p1' ? curSnap.p1 : curSnap.p2;
      if (curSnap.phase !== 'PLAYING' || curBot.color !== curSnap.turn) return;

      const move = pickBotMove(curSnap.fen, curBot.color, this.config, this.rng);
      if (move) {
        this.coordinator.handleMove(this.botId, move.from, move.to, move.promo);
      }
    }, delay);
  }

  private handlePreQuizTurn(): void {
    if (this.preQuizTimeout !== null) return;
    const snap = this.coordinator.getSnapshot();
    const botPlayer = this.botId === 'p1' ? snap.p1 : snap.p2;

    this.preQuizTimeout = window.setTimeout(() => {
      this.preQuizTimeout = null;
      if (this.destroyed) return;
      if (this.coordinator.getPhase() !== 'PRE_QUIZ') return;

      // Dùng thẻ nhóm 4 trước quiz nếu có
      const g4 = botPlayer.hand.find((h) => h.cardId.startsWith('q_') && h.cardId !== 'q_shield');
      if (g4 && this.rng() < 0.5) {
        this.coordinator.handleUseCard(this.botId, g4.uid);
      }
      this.coordinator.handlePreQuizPass(this.botId);
    }, 1200 + Math.floor(this.rng() * 1000));
  }

  private handleQuizTurn(): void {
    if (this.quizTimeout !== null) return;
    const quizPayload = this.coordinator.getQuizFor(this.botId);
    if (!quizPayload) return;

    const delay =
      this.config.quizDelayMinMs +
      Math.floor(this.rng() * (this.config.quizDelayMaxMs - this.config.quizDelayMinMs));

    this.quizTimeout = window.setTimeout(() => {
      this.quizTimeout = null;
      if (this.destroyed) return;
      if (this.coordinator.getPhase() !== 'QUIZ') return;

      const qp = this.coordinator.getQuizFor(this.botId);
      if (!qp) return;

      const correctIndex = this.coordinator.getCorrectAnswerIndex(this.botId) ?? 0;
      const isCorrect = this.rng() < this.config.quizAccuracy;
      let choice: number;

      if (isCorrect) {
        choice = correctIndex;
      } else {
        // Chọn một đáp án sai
        const wrongChoices = [0, 1, 2, 3].filter(
          (i) => i !== correctIndex && !qp.hiddenIndices.includes(i)
        );
        choice = wrongChoices.length > 0
          ? wrongChoices[Math.floor(this.rng() * wrongChoices.length)]
          : (correctIndex + 1) % 4;
      }

      this.coordinator.handleQuizAnswer(this.botId, qp.qid, choice);
    }, delay);
  }

  private handleShopTurn(): void {
    if (this.shopTimeout !== null) return;

    this.shopTimeout = window.setTimeout(() => {
      this.shopTimeout = null;
      if (this.destroyed) return;
      if (this.coordinator.getPhase() !== 'SHOP') return;

      const snap = this.coordinator.getSnapshot();
      const botPlayer = this.botId === 'p1' ? snap.p1 : snap.p2;

      // 1. Nhận thẻ miễn phí nếu có
      const free = snap.freeM2Choices[this.botId];
      if (free && free.options.length > 0) {
        if (botPlayer.hand.length >= 3) {
          this.coordinator.handleDropCard(this.botId, botPlayer.hand[0].uid);
        }
        this.coordinator.handleChooseFreeM2(this.botId, free.options[0].cardId);
      }

      // 2. Mua thẻ từ shop nếu có đủ xu
      const shop = this.coordinator.getShopFor(this.botId);
      if (shop) {
        const available = shop.items.filter((item) => !item.bought && botPlayer.coins >= item.finalPrice);
        if (available.length > 0 && botPlayer.hand.length < 3) {
          this.coordinator.handleBuyCard(this.botId, available[0].slot);
        }
      }

      // 3. Hoàn tất lượt mua sắm
      this.coordinator.handleShopDone(this.botId);
    }, 1500 + Math.floor(this.rng() * 1200));
  }
}
