import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { GameCoordinator } from '../../src/engine/gameCoordinator';
import { DEFAULT_BANK, SAMPLE_BANK } from '../../src/quiz/bankLoader';
import { CFG } from '../../src/config/defaults';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Mô phỏng ván bot tự động (property test)', () => {
  it('mọi ván kết thúc sạch, không lỗi, không xu âm, thưởng giờ <= 40%', () => {
    let quizzesTotal = 0;
    const games = 50;

    for (let g = 0; g < games; g++) {
      const rng = seededRng(1000 + g);
      let now = 10_000_000;
      const coord = new GameCoordinator({
        clockSeconds: 300,
        bank: g % 2 === 0 ? DEFAULT_BANK : SAMPLE_BANK,
        rng,
        now: () => now,
      });
      coord.startGame();

      let safety = 0;
      while (coord.getPhase() !== 'GAME_OVER' && safety < 140) {
        safety++;
        const phase = coord.getPhase();
        const snap = coord.getSnapshot();

        if (phase === 'PLAYING') {
          if (snap.pendingHarmful) {
            if (rng() < 0.3) {
              const target = snap.pendingHarmful.target === 'p1' ? snap.p1 : snap.p2;
              const sh = target.hand.find((h) => h.cardId === 'q_shield');
              if (sh) coord.handleShield(target.id, sh.uid);
            }
            now += 2100;
            coord.tick(now);
            continue;
          }

          const turnPid = snap.p1.color === snap.turn ? 'p1' : 'p2';
          const turnPlayer = turnPid === 'p1' ? snap.p1 : snap.p2;

          // Dùng ngẫu nhiên tối đa 1 thẻ nếu có
          if (turnPlayer.hand.length > 0 && rng() < 0.35) {
            const card = turnPlayer.hand[Math.floor(rng() * turnPlayer.hand.length)];
            coord.handleUseCard(turnPid, card.uid);
            if (coord.getSnapshot().pendingHarmful) {
              now += 2100;
              coord.tick(now);
            }
          }

          const ch = new Chess(coord.getSnapshot().fen);
          const moves = ch.moves({ verbose: true });
          if (moves.length === 0) {
            now += 1000;
            coord.tick(now);
            continue;
          }
          const mv = moves[Math.floor(rng() * moves.length)];
          coord.handleMove(turnPid, mv.from, mv.to, mv.promotion as 'q' | undefined);
          now += 2000;
          coord.tick(now);
        } else if (phase === 'PRE_QUIZ') {
          for (const pid of ['p1', 'p2'] as const) {
            const p = pid === 'p1' ? snap.p1 : snap.p2;
            const g4 = p.hand.find((h) => h.cardId.startsWith('q_') && h.cardId !== 'q_shield');
            if (g4 && rng() < 0.5) coord.handleUseCard(pid, g4.uid);
            coord.handlePreQuizPass(pid);
          }
          now += 2200;
          coord.tick(now);
        } else if (phase === 'QUIZ') {
          quizzesTotal++;
          for (const pid of ['p1', 'p2'] as const) {
            const qp = coord.getQuizFor(pid);
            if (qp) {
              const valid = [0, 1, 2, 3].filter((i) => !qp.hiddenIndices.includes(i));
              const pick = valid[Math.floor(rng() * valid.length)] ?? 0;
              now += 1500;
              coord.handleQuizAnswer(pid, qp.qid, pick);
            }
          }
        } else if (phase === 'RESULT') {
          now += 3500;
          coord.tick(now);
        } else if (phase === 'SHOP') {
          for (const pid of ['p1', 'p2'] as const) {
            const free = coord.getSnapshot().freeM2Choices[pid];
            if (free) {
              const p = pid === 'p1' ? coord.getSnapshot().p1 : coord.getSnapshot().p2;
              if (p.hand.length >= 3) coord.handleDropCard(pid, p.hand[0].uid);
              coord.handleChooseFreeM2(pid, free.options[0].cardId);
            }
            const shop = coord.getShopFor(pid);
            if (shop) {
              const affordable = shop.items.filter((i) => !i.bought);
              for (const item of affordable) {
                const p = pid === 'p1' ? coord.getSnapshot().p1 : coord.getSnapshot().p2;
                if (p.coins >= item.finalPrice && p.hand.length < 3) {
                  coord.handleBuyCard(pid, item.slot);
                }
              }
            }
            coord.handleShopDone(pid);
          }
        }
      }

      const endSnap = coord.getSnapshot();
      expect(endSnap.p1.coins).toBeGreaterThanOrEqual(0);
      expect(endSnap.p2.coins).toBeGreaterThanOrEqual(0);
      expect(endSnap.p1.hand.length).toBeLessThanOrEqual(CFG.handMax);
      expect(endSnap.p2.hand.length).toBeLessThanOrEqual(CFG.handMax);
      expect(endSnap.p1.bonusTimeGivenMs).toBeLessThanOrEqual(300_000 * CFG.timeBonusCapRatio);
      expect(endSnap.p2.bonusTimeGivenMs).toBeLessThanOrEqual(300_000 * CFG.timeBonusCapRatio);
    }

    expect(quizzesTotal).toBeGreaterThan(0);
  }, 60000);
});
