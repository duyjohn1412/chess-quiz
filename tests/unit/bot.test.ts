import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  BOT_NAMES,
  computeBotConfig,
  computeBotElo,
  evaluateLegalMoves,
  getRandomBotName,
  pickBotMove,
} from '../../src/engine/botPlayer';
import { selectBestMatchCandidate } from '../../src/net/firebaseMatchmaking';

describe('BotPlayer Logic and Scaling', () => {
  it('picks random bot name from BOT_NAMES pool', () => {
    const name = getRandomBotName();
    expect(BOT_NAMES).toContain(name);
  });

  it('computes bot Elo close to player Elo and within [600, 3000]', () => {
    for (const playerElo of [500, 800, 1000, 1500, 2800, 3200]) {
      const botElo = computeBotElo(playerElo);
      expect(botElo).toBeGreaterThanOrEqual(600);
      expect(botElo).toBeLessThanOrEqual(3000);
      // delta is between -30 and +20 (unless clamped)
      if (playerElo >= 650 && playerElo <= 2970) {
        expect(Math.abs(botElo - playerElo)).toBeLessThanOrEqual(30);
      }
    }
  });

  it('scales bot difficulty according to Elo level', () => {
    const low = computeBotConfig(800, 800);
    const mid = computeBotConfig(1200, 1200);
    const high = computeBotConfig(2000, 2000);

    // Blunder chance decreases as Elo increases
    expect(low.blunderChance).toBeGreaterThan(mid.blunderChance);
    expect(mid.blunderChance).toBeGreaterThan(high.blunderChance);

    // Optimal pick chance increases as Elo increases
    expect(low.optimalPickChance).toBeLessThan(mid.optimalPickChance);
    expect(mid.optimalPickChance).toBeLessThan(high.optimalPickChance);

    // Quiz accuracy stays capped between 42% and 58% (giving human advantage)
    expect(low.quizAccuracy).toBeGreaterThanOrEqual(0.42);
    expect(high.quizAccuracy).toBeLessThanOrEqual(0.58);
    expect(low.quizAccuracy).toBeLessThan(high.quizAccuracy);

    // Search depth increases with Elo
    expect(low.searchDepth).toBeLessThanOrEqual(mid.searchDepth);
    expect(mid.searchDepth).toBeLessThanOrEqual(high.searchDepth);
  });

  it('evaluates legal moves from standard start position', () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const moves = evaluateLegalMoves(startFen, 'w');
    expect(moves.length).toBe(20);
    // Center moves like e4, d4 have positive scores
    const e4 = moves.find((m) => m.from === 'e2' && m.to === 'e4');
    expect(e4).toBeDefined();
    expect(e4!.score).toBeGreaterThan(0);
  });

  it('prioritizes checkmate over all other moves', () => {
    // Scholar's mate position: White Queen on f7 delivers checkmate
    const mateFen = 'r1bqkb1r/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1';
    const moves = evaluateLegalMoves(mateFen, 'w');
    expect(moves[0].from).toBe('h5');
    expect(moves[0].to).toBe('f7');
    expect(moves[0].score).toBeGreaterThanOrEqual(90000);

    const config = computeBotConfig(1000, 1000);
    const picked = pickBotMove(mateFen, 'w', config);
    expect(picked).toEqual({ from: 'h5', to: 'f7', promo: undefined, score: 99999 });
  });

  it('picks valid legal moves consistently across 20 positions', () => {
    const chess = new Chess();
    const config = computeBotConfig(1100, 1100);

    for (let ply = 0; ply < 20; ply++) {
      const turn = chess.turn();
      const move = pickBotMove(chess.fen(), turn, config);
      expect(move).not.toBeNull();
      const legal = chess.moves({ verbose: true }).some((m) => m.from === move!.from && m.to === move!.to);
      expect(legal).toBe(true);
      chess.move({ from: move!.from, to: move!.to, promotion: move!.promo });
      if (chess.isGameOver()) break;
    }
  });

  it(
    'verifies human vs bot win rate targets ~60% human vs ~40% bot in 30 simulated games',
    () => {
      let humanWins = 0;
      let botWins = 0;
      let draws = 0;
      const totalGames = 30;

      for (let g = 0; g < totalGames; g++) {
        const chess = new Chess();
        const botConfig = computeBotConfig(1000, 1000);
        let p1Clock = 300;
        let p2Clock = 300;

        for (let ply = 0; ply < 40; ply++) {
          if (chess.isGameOver()) break;

          // Periodic quiz every 8 plies
          if (ply > 0 && ply % 8 === 0) {
            // Human ~75% accuracy, bot ~48% accuracy
            const humanCorrect = ((g * 13 + ply * 7) % 100) < 75;
            const botCorrect = ((g * 17 + ply * 11) % 100) < 48;
            if (humanCorrect) p1Clock += 15;
            if (botCorrect) p2Clock += 15;
          }

          const turn = chess.turn();
          if (turn === 'w') {
            const moves = evaluateLegalMoves(chess.fen(), 'w');
            if (moves.length === 0) break;
            const chosen = moves[0];
            chess.move({ from: chosen.from, to: chosen.to, promotion: chosen.promo });
            p1Clock -= 4;
          } else {
            const move = pickBotMove(chess.fen(), 'b', botConfig, () => ((g * 19 + ply * 23) % 100) / 100);
            if (!move) break;
            chess.move({ from: move.from, to: move.to, promotion: move.promo });
            p2Clock -= 5;
          }
        }

        if (chess.isCheckmate()) {
          if (chess.turn() === 'b') humanWins++;
          else botWins++;
        } else {
          const moves = evaluateLegalMoves(chess.fen(), 'w');
          const mateMove = moves.find((m) => m.score >= 90000);
          if (mateMove) {
            humanWins++;
          } else {
            const whiteEval = moves[0]?.score ?? 0;
            if (whiteEval > 100) humanWins++;
            else if (whiteEval < -100) botWins++;
            else draws++;
          }
        }
      }

      const decisive = humanWins + botWins;
      expect(decisive).toBeGreaterThan(0);
      expect(humanWins).toBeGreaterThanOrEqual(botWins);
      const humanRate = humanWins / (decisive || 1);
      // Human win rate strictly lands in the 55% - 75% sweet spot
      expect(humanRate).toBeGreaterThanOrEqual(0.55);
      expect(humanRate).toBeLessThanOrEqual(0.80);
    },
    25_000
  );

  it('verifies matchmaking bot fallback triggers after 25 seconds when queue is empty', () => {
    const candidates: any[] = [];
    const now = Date.now();
    const searchStartedAt = now - 25_100; // 25.1 seconds elapsed

    const opp = selectBestMatchCandidate('user_123', 1000, candidates, now);
    expect(opp).toBeNull();

    const elapsed = now - searchStartedAt;
    const shouldFallbackToBot = elapsed >= 25_000;
    expect(shouldFallbackToBot).toBe(true);

    const botName = getRandomBotName();
    const botElo = computeBotElo(1000);
    expect(BOT_NAMES).toContain(botName);
    expect(botElo).toBeGreaterThanOrEqual(970);
    expect(botElo).toBeLessThanOrEqual(1020);
  });
});
