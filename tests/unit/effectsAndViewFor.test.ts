import { describe, expect, it } from 'vitest';
import { GameCoordinator } from '../../src/engine/gameCoordinator';
import { SAMPLE_BANK } from '../../src/quiz/bankLoader';
import { computeRadarSquares, computeScanSquares, computeStrategicPlan } from '../../src/analysis/analyzers';

function injectCard(
  coord: GameCoordinator,
  playerId: 'p1' | 'p2',
  cardId: string,
  level: 1 | 2 | 3 | 4
): string {
  const snap = coord.getSnapshot();
  const p = playerId === 'p1' ? snap.p1 : snap.p2;
  const uid = `test_${cardId}_${level}_${Math.random()}`;
  p.hand.push({ uid, cardId, level });
  return uid;
}

describe('Effects, Lá chắn, viewFor & Analyzers', () => {
  it('cửa sổ Lá chắn 2s và phản lại ở mức 4', () => {
    let now = 1_000_000;
    const coord = new GameCoordinator({
      clockSeconds: 300,
      bank: SAMPLE_BANK,
      now: () => now,
      rng: () => 0.1, // p1 = w, p2 = b
    });
    coord.startGame({ p1: 'w', p2: 'b' });

    const minusUid = injectCard(coord, 'p1', 'time_minus', 2); // -10s
    const shieldUid = injectCard(coord, 'p2', 'q_shield', 4); // M4 phản lại

    expect(coord.handleUseCard('p1', minusUid)).toBe(true);
    // Trong 2s pending, viewFor p2 ẩn cardId thành 'hidden'
    const p2View = coord.getViewFor('p2');
    expect(p2View.pendingHarmful?.cardId).toBe('hidden');
    expect(p2View.p1.hand).toBeNull(); // ẩn kho của p1

    // Khán giả cũng không thấy kho hay đáp án
    const specView = coord.getViewFor('spectator');
    expect(specView.p1.hand).toBeNull();
    expect(specView.p1.coins).toBe(0);

    // Dùng Lá chắn M4 trong vòng 2s
    now += 1500;
    expect(coord.handleShield('p2', shieldUid)).toBe(true);
    const after = coord.getSnapshot();
    expect(after.pendingHarmful).toBeNull();
    expect(after.p1.clockMs).toBe(290_000); // bị phản -10s!
    expect(after.p2.clockMs).toBe(300_000);
  });

  it('Ép đi nhanh quá hạn trừ 1/8 thời gian còn lại, hoặc vô hiệu nếu đồng hồ <= X', () => {
    let now = 2_000_000;
    const coord = new GameCoordinator({
      clockSeconds: 300,
      bank: SAMPLE_BANK,
      now: () => now,
    });
    coord.startGame({ p1: 'w', p2: 'b' });

    const forceUid = injectCard(coord, 'p1', 'time_force', 4); // 10s
    expect(coord.handleUseCard('p1', forceUid)).toBe(true);
    now += 2500; // hết cửa sổ 2s Lá chắn
    coord.tick(now);
    expect(coord.getSnapshot().pendingHarmful).toBeNull();

    // p1 đi nước -> tới lượt p2, kích hoạt đếm ngược 10s
    expect(coord.handleMove('p1', 'e2', 'e4')).toBe(true);
    expect(coord.getSnapshot().forceMove?.target).toBe('p2');

    // Cho trôi qua 11s -> p2 quá hạn (p2 tick hết 11s còn 289s -> trừ 1/8 của 289s ≈ 36.125s)
    now += 11_000;
    coord.tick(now);
    const snap = coord.getSnapshot();
    expect(snap.forceMove).toBeNull();
    expect(snap.p2.clockMs).toBeLessThan(260_000);
  });

  it('chơi đủ 3 nước mỗi bên -> PRE_QUIZ -> QUIZ -> RESULT -> SHOP', () => {
    let now = 5_000_000;
    const coord = new GameCoordinator({
      clockSeconds: 300,
      bank: SAMPLE_BANK,
      now: () => now,
    });
    coord.startGame({ p1: 'w', p2: 'b' });

    const moves: ['p1' | 'p2', string, string][] = [
      ['p1', 'e2', 'e4'],
      ['p2', 'e7', 'e5'],
      ['p1', 'g1', 'f3'],
      ['p2', 'b8', 'c6'],
      ['p1', 'f1', 'c4'],
      ['p2', 'g8', 'f6'],
    ];
    for (const [pid, f, t] of moves) {
      expect(coord.handleMove(pid, f, t)).toBe(true);
    }
    expect(coord.getPhase()).toBe('PRE_QUIZ');

    coord.handlePreQuizPass('p1');
    coord.handlePreQuizPass('p2');
    expect(coord.getPhase()).toBe('QUIZ');

    const q1 = coord.getQuizFor('p1')!;
    const q2 = coord.getQuizFor('p2')!;
    expect(q1.qid).toBe(q2.qid);

    coord.handleQuizAnswer('p1', q1.qid, 0);
    coord.handleQuizAnswer('p2', q2.qid, 1);
    expect(coord.getPhase()).toBe('RESULT');

    now += 3500;
    coord.tick(now);
    expect(coord.getPhase()).toBe('SHOP');
    expect(coord.getShopFor('p1')?.items).toHaveLength(6);
  });

  it('Soi kho và Xem xu mở đúng thông tin trong viewFor', () => {
    const coord = new GameCoordinator({ clockSeconds: 300, bank: SAMPLE_BANK });
    coord.startGame({ p1: 'w', p2: 'b' });
    injectCard(coord, 'p2', 'time_plus', 2);
    coord.getSnapshot().p2.coins = 55;

    const vaultUid = injectCard(coord, 'p1', 'peek_vault', 4);
    const coinsUid = injectCard(coord, 'p1', 'peek_coins', 1);

    expect(coord.getViewFor('p1').p2.coins).toBeNull();
    expect(coord.getViewFor('p1').p2.revealedHand).toBeNull();

    coord.handleUseCard('p1', vaultUid);
    coord.handleUseCard('p1', coinsUid);

    const view = coord.getViewFor('p1');
    expect(view.p2.coins).toBe(55);
    expect(view.p2.revealedHand).toEqual([{ name: 'Cộng giờ', level: 2 }]);
  });

  it('Xem lịch sử M1 ẩn timestamp, M4 hiện timestamp và level', () => {
    const coord = new GameCoordinator({ clockSeconds: 300, bank: SAMPLE_BANK });
    coord.startGame({ p1: 'w', p2: 'b' });
    // p1 đi nước -> tới lượt p2
    coord.handleMove('p1', 'e2', 'e4');
    const p2Plus = injectCard(coord, 'p2', 'time_plus', 2);
    coord.handleUseCard('p2', p2Plus);
    coord.handleMove('p2', 'e7', 'e5');

    // p1 dùng peek_history M1
    const hist1 = injectCard(coord, 'p1', 'peek_history', 1);
    coord.handleUseCard('p1', hist1);
    const v1 = coord.getViewFor('p1');
    expect(v1.p2.revealedHistory).toHaveLength(1);
    expect(v1.p2.revealedHistory![0].name).toBe('Cộng giờ');
    expect(v1.p2.revealedHistory![0].atClockMs).toBeUndefined();

    // p1 dùng peek_history M4
    const hist4 = injectCard(coord, 'p1', 'peek_history', 4);
    coord.handleUseCard('p1', hist4);
    const v4 = coord.getViewFor('p1');
    expect(v4.p2.revealedHistory![0].level).toBe(2);
    expect(typeof v4.p2.revealedHistory![0].atClockMs).toBe('number');
  });

  it('analyzers: Radar, Quét ô và Kế hoạch chạy đúng trên thế cờ mẫu', () => {
    // Đen có tốt d5 đang tấn công e4 của Trắng, e4 không có quân bảo vệ
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const radar = computeRadarSquares(fen, 'w');
    expect(radar).toContain('e4');

    const scan = computeScanSquares(fen, 'b');
    expect(scan).toContain('e4');

    const plan = computeStrategicPlan(fen, 'w', 4, true);
    expect(plan.hints.length).toBeGreaterThan(0);
    expect(plan.keySquares.length).toBeGreaterThan(0);
  });
});
