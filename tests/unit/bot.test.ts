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
    // White: Q on h5, B on c4, P on e4, K on e1
    // Black: K on e8, P on e5
    const mateFen = 'r1bqkb1r/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1';
    const moves = evaluateLegalMoves(mateFen, 'w');
    expect(moves[0].from).toBe('h5');
    expect(moves[0].to).toBe('f7');
    expect(moves[0].score).toBeGreaterThanOrEqual(90000);

    const config = computeBotConfig(1000, 1000);
    const picked = pickBotMove(mateFen, 'w', config);
    expect(picked).toEqual({ from: 'h5', to: 'f7', promo: undefined, score: 99999 });
  });

  it('picks valid legal moves consistently across 50 positions', () => {
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
});
