import { describe, expect, it } from 'vitest';
import { ChessGame } from '../../src/engine/chessGame';
import { GameCoordinator } from '../../src/engine/gameCoordinator';
import { SAMPLE_BANK } from '../../src/quiz/bankLoader';
import {
  applyForceMovePenalty,
  applyTimeBonus,
  applyTimePenalty,
  tickClock,
} from '../../src/engine/clock';
import { calcQuizCoins } from '../../src/engine/economy';
import { advanceMoveCounter } from '../../src/engine/scheduler';
import { updateStreak } from '../../src/engine/streak';

describe('Engine core modules', () => {
  it('clock: giới hạn cộng giờ tối đa 40% đồng hồ gốc', () => {
    const capRes = applyTimeBonus(100_000, 150, 0, 300); // cap = 120s
    expect(capRes.addedMs).toBe(120_000);
    expect(capRes.clockMs).toBe(220_000);
    const second = applyTimeBonus(capRes.clockMs, 20, capRes.bonusTimeGivenMs, 300);
    expect(second.addedMs).toBe(0);
  });

  it('clock: trừ giờ không xuống dưới floor 10s, trừ 1/8 cho Ép đi nhanh, đóng băng', () => {
    const pen = applyTimePenalty(14_000, 10, 10);
    expect(pen.clockMs).toBe(10_000);
    expect(pen.deductedMs).toBe(4_000);

    const forcePen = applyForceMovePenalty(80_000);
    expect(forcePen.deductedMs).toBe(10_000);
    expect(forcePen.clockMs).toBe(70_000);

    const t1 = tickClock(50_000, 3_000, 5_000);
    expect(t1.clockMs).toBe(50_000);
    expect(t1.freezeRemainingMs).toBe(2_000);

    const t2 = tickClock(t1.clockMs, 4_000, t1.freezeRemainingMs);
    expect(t2.clockMs).toBe(48_000);
    expect(t2.freezeRemainingMs).toBe(0);
  });

  it('chessGame: nhập thành, phong cấp, bắt tốt qua đường và hòa vua trần khi hết giờ', () => {
    const g1 = new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(g1.tryMove('e1', 'g1').ok).toBe(true); // nhập thành cánh vua

    const g2 = new ChessGame('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    expect(g2.tryMove('e5', 'd6').ok).toBe(true); // en passant

    const g3 = new ChessGame('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const promo = g3.tryMove('a7', 'a8', 'q');
    expect(promo.ok).toBe(true);

    const bareKing = new ChessGame('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1');
    expect(bareKing.resolveTimeoutWinner('w')).toBe('draw'); // Đen chỉ còn vua trần -> hòa
    expect(bareKing.resolveTimeoutWinner('b')).toBe('w');    // Trắng còn hậu -> Trắng thắng
  });

  it('scheduler: đếm đủ 3 nước mỗi bên mới kích hoạt quiz, bỏ qua nếu hết ván', () => {
    let w = 0;
    let b = 0;
    for (let i = 0; i < 2; i++) {
      const r1 = advanceMoveCounter(w, b, 'w', false);
      expect(r1.triggerQuiz).toBe(false);
      w = r1.whiteSinceQuiz;
      b = r1.blackSinceQuiz;

      const r2 = advanceMoveCounter(w, b, 'b', false);
      expect(r2.triggerQuiz).toBe(false);
      w = r2.whiteSinceQuiz;
      b = r2.blackSinceQuiz;
    }
    const r5 = advanceMoveCounter(w, b, 'w', false);
    expect(r5.triggerQuiz).toBe(false);
    const r6 = advanceMoveCounter(r5.whiteSinceQuiz, r5.blackSinceQuiz, 'b', false);
    expect(r6.triggerQuiz).toBe(true);
    expect(r6.whiteSinceQuiz).toBe(0);
    expect(r6.blackSinceQuiz).toBe(0);

    const mateMove = advanceMoveCounter(3, 2, 'b', true);
    expect(mateMove.triggerQuiz).toBe(false);
  });

  it('economy & streak: tính đúng xu Vừa 4s -> 30 xu và streak 2/3/5', () => {
    expect(calcQuizCoins(2, 4_000, 15_000, true)).toBe(30);
    expect(calcQuizCoins(2, 8_000, 15_000, true)).toBe(22); // 15 * 1.5 = 22.5 -> floor 22
    expect(calcQuizCoins(2, 12_000, 15_000, true)).toBe(15);
    expect(calcQuizCoins(3, 1_000, 15_000, false)).toBe(0);

    let s = updateStreak(0, false, true);
    expect(s.streak).toBe(1);
    s = updateStreak(s.streak, s.streak5Granted, true);
    expect(s.bonusCoins).toBe(5); // streak 2
    s = updateStreak(s.streak, s.streak5Granted, true);
    expect(s.bonusCoins).toBe(10); // streak 3
    expect(s.grantShopDiscount).toBe(true);
    s = updateStreak(s.streak, s.streak5Granted, true);
    expect(s.bonusCoins).toBe(0); // streak 4
    s = updateStreak(s.streak, s.streak5Granted, true);
    expect(s.bonusCoins).toBe(20); // streak 5
    expect(s.grantFreeM2Choice).toBe(true);
    const sReset = updateStreak(s.streak, s.streak5Granted, false);
    expect(sReset.streak).toBe(0);
    expect(sReset.streak5Granted).toBe(false);
  });

  it('admin commands: chỉnh giờ, đóng băng, xu, streak, tặng/xóa thẻ, đi hộ & kết thúc ván', () => {
    let now = 1_000_000;
    const coord = new GameCoordinator({
      clockSeconds: 300,
      bank: SAMPLE_BANK,
      now: () => now,
      rng: () => 0.1, // p1 = w, p2 = b
    });
    coord.startGame({ p1: 'w', p2: 'b' });

    expect(coord.applyAdminCommand({ type: 'ADJUST_CLOCK', target: 'p1', deltaSec: -30 })).toBe(true);
    expect(coord.applyAdminCommand({ type: 'FREEZE_CLOCK', target: 'p2', seconds: 10 })).toBe(true);
    expect(coord.applyAdminCommand({ type: 'ADJUST_COINS', target: 'p1', delta: 75 })).toBe(true);
    expect(coord.applyAdminCommand({ type: 'SET_STREAK', target: 'p1', streak: 4 })).toBe(true);
    expect(coord.applyAdminCommand({ type: 'GIVE_CARD', target: 'p1', cardId: 'q_flash', level: 4 })).toBe(true);

    let snap = coord.getAdminSnapshot();
    expect(snap.p1.clockMs).toBe(270_000);
    expect(snap.p2.freezeRemainingMs).toBe(10_000);
    expect(snap.p1.coins).toBe(75);
    expect(snap.p1.streak).toBe(4);
    expect(snap.p1.hand).toHaveLength(1);

    const cardUid = snap.p1.hand[0].uid;
    expect(coord.applyAdminCommand({ type: 'REMOVE_CARD', target: 'p1', uid: cardUid })).toBe(true);
    expect(coord.getAdminSnapshot().p1.hand).toHaveLength(0);

    expect(coord.applyAdminCommand({ type: 'MAKE_MOVE', from: 'e2', to: 'e4' })).toBe(true);
    expect(coord.getAdminSnapshot().turn).toBe('b');

    expect(coord.applyAdminCommand({ type: 'FORCE_GAME_OVER', winner: 'w', reason: 'resign' })).toBe(true);
    snap = coord.getAdminSnapshot();
    expect(snap.phase).toBe('GAME_OVER');
    expect(snap.gameOver?.winner).toBe('w');
  });
});
