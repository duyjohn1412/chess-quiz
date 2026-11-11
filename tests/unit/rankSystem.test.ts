import { describe, expect, it } from 'vitest';
import {
  applyMatchOutcomeToProfile,
  calcEloUpdate,
  createDefaultRankProfile,
  getRankTier,
  outcomeFromGameOver,
} from '../../src/rank/rankSystem';
import { selectBestMatchCandidate, QuickMatchTicket } from '../../src/net/firebaseMatchmaking';
import {
  generateQuickRoomCode,
  generateRoomCode,
  isQuickRoomCode,
  isValidRoomCode,
} from '../../src/net/roomCode';

describe('Rank system, matchmaking selection & room codes', () => {
  it('phân hạng chính xác theo các mốc Elo', () => {
    expect(getRankTier(900).tier).toBe('bronze');
    expect(getRankTier(1049).tier).toBe('bronze');
    expect(getRankTier(1050).tier).toBe('silver');
    expect(getRankTier(1199).tier).toBe('silver');
    expect(getRankTier(1200).tier).toBe('gold');
    expect(getRankTier(1400).tier).toBe('platinum');
    expect(getRankTier(1600).tier).toBe('diamond');
  });

  it('calcEloUpdate bảo đảm K=24, đồng cân +12/-12 và tôn trọng sàn/trần', () => {
    const winEven = calcEloUpdate(1000, 1000, 'win');
    expect(winEven.delta).toBe(12);
    expect(winEven.newElo).toBe(1012);

    const drawEven = calcEloUpdate(1000, 1000, 'draw');
    expect(drawEven.delta).toBe(0);

    const lossEven = calcEloUpdate(1000, 1000, 'loss');
    expect(lossEven.delta).toBe(-12);
    expect(lossEven.newElo).toBe(988);

    const upset = calcEloUpdate(800, 1600, 'win');
    expect(upset.delta).toBeGreaterThanOrEqual(20);
    expect(upset.delta).toBeLessThanOrEqual(24);

    const stompWin = calcEloUpdate(2000, 800, 'win');
    expect(stompWin.delta).toBeGreaterThanOrEqual(1);

    const floorClamp = calcEloUpdate(600, 1200, 'loss');
    expect(floorClamp.newElo).toBe(600);
  });

  it('applyMatchOutcomeToProfile cập nhật W/L/D, streak, bestElo, ranked & lastMatchId', () => {
    let p = createDefaultRankProfile('u1', 'An');
    expect(p.ranked).toBe(false);
    expect(p.gamesPlayed).toBe(0);

    const r1 = applyMatchOutcomeToProfile(p, 1000, 'win', 'Q1234567', 100);
    p = r1.next;
    expect(p.ranked).toBe(true);
    expect(p.gamesPlayed).toBe(1);
    expect(p.wins).toBe(1);
    expect(p.streak).toBe(1);
    expect(p.elo).toBe(1012);
    expect(p.bestElo).toBe(1012);
    expect(p.lastMatchId).toBe('Q1234567');

    const r2 = applyMatchOutcomeToProfile(p, 1000, 'loss', 'QABCDEFG', 200);
    expect(r2.next.losses).toBe(1);
    expect(r2.next.streak).toBe(0);
    expect(r2.next.bestElo).toBe(1012);
    expect(r2.next.elo).toBeLessThan(1012);

    expect(outcomeFromGameOver('w', 'w')).toBe('win');
    expect(outcomeFromGameOver('b', 'w')).toBe('loss');
    expect(outcomeFromGameOver('draw', 'w')).toBe('draw');
  });

  it('selectBestMatchCandidate lọc stale/self và chọn Elo gần nhất', () => {
    const now = 1_000_000;
    const base: Omit<QuickMatchTicket, 'uid' | 'elo' | 'updatedAtMs'> = {
      name: 'P',
      clockSeconds: 300,
      status: 'WAITING',
      roomCode: '',
      hostUid: '',
      peerUid: '',
      peerName: '',
      peerElo: 0,
      bankId: 'gt1_40',
      createdAtMs: now - 5000,
    };

    const picked = selectBestMatchCandidate(
      'self',
      1050,
      [
        { ...base, uid: 'self', elo: 1050, updatedAtMs: now },
        { ...base, uid: 'stale', elo: 1050, updatedAtMs: now - 30_000 },
        { ...base, uid: 'matched', elo: 1050, updatedAtMs: now, status: 'MATCHED' },
        { ...base, uid: 'far', elo: 1400, updatedAtMs: now },
        { ...base, uid: 'near', elo: 1080, updatedAtMs: now },
      ],
      now
    );

    expect(picked?.uid).toBe('near');
  });

  it('phân biệt mã phòng riêng (6 ký tự) và mã Quick Match (Q + 7 ký tự)', () => {
    const priv = generateRoomCode();
    const quick = generateQuickRoomCode();
    expect(isValidRoomCode(priv)).toBe(true);
    expect(isQuickRoomCode(priv)).toBe(false);
    expect(isQuickRoomCode(quick)).toBe(true);
    expect(isValidRoomCode(quick)).toBe(false);
  });
});
