export type RankTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface RankTierInfo {
  tier: RankTier;
  label: string;
  icon: string;
  color: string;
  minElo: number;
}

export interface RankProfile {
  uid: string;
  name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  bestElo: number;
  gamesPlayed: number;
  ranked: boolean;
  lastMatchId: string;
  updatedAt: number;
}

export interface EloUpdateResult {
  outcome: MatchOutcome;
  oldElo: number;
  newElo: number;
  delta: number;
  oldTier: RankTierInfo;
  newTier: RankTierInfo;
}

export const INITIAL_ELO = 1000;
export const MIN_ELO = 600;
export const MAX_ELO = 3000;
export const ELO_K = 24;
export const RANK_CACHE_KEY = 'cqRankProfile_v1';

const TIERS: RankTierInfo[] = [
  { tier: 'diamond', label: 'Kim Cương', icon: '👑', color: '#a78bfa', minElo: 1600 },
  { tier: 'platinum', label: 'Bạch Kim', icon: '💎', color: '#38bdf8', minElo: 1400 },
  { tier: 'gold', label: 'Vàng', icon: '🥇', color: '#facc15', minElo: 1200 },
  { tier: 'silver', label: 'Bạc', icon: '🥈', color: '#cbd5e1', minElo: 1050 },
  { tier: 'bronze', label: 'Đồng', icon: '🥉', color: '#d97706', minElo: 0 },
];

export function clampElo(elo: number): number {
  if (!Number.isFinite(elo)) return INITIAL_ELO;
  return Math.max(MIN_ELO, Math.min(MAX_ELO, Math.round(elo)));
}

export function normalizePlayerDisplayName(name: string, fallback = 'Người chơi'): string {
  const clean = name.trim().slice(0, 24);
  return clean || fallback;
}

export function getRankTier(elo: number): RankTierInfo {
  const safe = clampElo(elo);
  for (const t of TIERS) {
    if (safe >= t.minElo) return t;
  }
  return TIERS[TIERS.length - 1];
}

export function calcEloUpdate(
  myElo: number,
  oppElo: number,
  outcome: MatchOutcome
): EloUpdateResult {
  const oldElo = clampElo(myElo);
  const safeOpp = clampElo(oppElo);
  const expected = 1 / (1 + Math.pow(10, (safeOpp - oldElo) / 400));
  const actual = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
  let rawDelta = Math.round(ELO_K * (actual - expected));
  // Bảo đảm thắng luôn cộng tối thiểu +1 Elo (trừ khi chạm trần) và thua trừ tối thiểu 1 (trừ khi chạm sàn)
  if (outcome === 'win' && rawDelta <= 0) rawDelta = 1;
  if (outcome === 'loss' && rawDelta >= 0) rawDelta = -1;

  const newElo = clampElo(oldElo + rawDelta);
  const delta = newElo - oldElo;
  return {
    outcome,
    oldElo,
    newElo,
    delta,
    oldTier: getRankTier(oldElo),
    newTier: getRankTier(newElo),
  };
}

export function createDefaultRankProfile(uid: string, name: string): RankProfile {
  return {
    uid,
    name: normalizePlayerDisplayName(name),
    elo: INITIAL_ELO,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    bestElo: INITIAL_ELO,
    gamesPlayed: 0,
    ranked: false,
    lastMatchId: '',
    updatedAt: Date.now(),
  };
}

export function applyMatchOutcomeToProfile(
  profile: RankProfile,
  oppElo: number,
  outcome: MatchOutcome,
  matchId: string,
  nowMs: number = Date.now()
): { next: RankProfile; diff: EloUpdateResult } {
  const diff = calcEloUpdate(profile.elo, oppElo, outcome);
  const next: RankProfile = {
    ...profile,
    elo: diff.newElo,
    wins: profile.wins + (outcome === 'win' ? 1 : 0),
    losses: profile.losses + (outcome === 'loss' ? 1 : 0),
    draws: profile.draws + (outcome === 'draw' ? 1 : 0),
    streak: outcome === 'win' ? profile.streak + 1 : 0,
    bestElo: Math.max(profile.bestElo, diff.newElo),
    gamesPlayed: profile.gamesPlayed + 1,
    ranked: true,
    lastMatchId: matchId,
    updatedAt: nowMs,
  };
  return { next, diff };
}

export function outcomeFromGameOver(
  winner: 'w' | 'b' | 'draw',
  myColor: 'w' | 'b'
): MatchOutcome {
  if (winner === 'draw') return 'draw';
  return winner === myColor ? 'win' : 'loss';
}

export function loadCachedRankProfile(): RankProfile | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(RANK_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<RankProfile>;
    if (!p || typeof p.uid !== 'string' || typeof p.elo !== 'number') return null;
    return {
      uid: p.uid,
      name: normalizePlayerDisplayName(String(p.name ?? 'Người chơi')),
      elo: clampElo(p.elo),
      wins: Math.max(0, Math.floor(Number(p.wins ?? 0))),
      losses: Math.max(0, Math.floor(Number(p.losses ?? 0))),
      draws: Math.max(0, Math.floor(Number(p.draws ?? 0))),
      streak: Math.max(0, Math.floor(Number(p.streak ?? 0))),
      bestElo: clampElo(Number(p.bestElo ?? p.elo)),
      gamesPlayed: Math.max(0, Math.floor(Number(p.gamesPlayed ?? 0))),
      ranked: Boolean(p.ranked),
      lastMatchId: typeof p.lastMatchId === 'string' ? p.lastMatchId : '',
      updatedAt: Number(p.updatedAt ?? Date.now()),
    };
  } catch {
    return null;
  }
}

export function saveCachedRankProfile(profile: RankProfile): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RANK_CACHE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage quota errors
  }
}

export function mergeLocalAndRemoteProfile(
  remote: RankProfile | null,
  local: RankProfile | null,
  uid: string,
  displayName: string
): RankProfile {
  const cleanName = normalizePlayerDisplayName(displayName);
  if (remote) {
    return { ...remote, name: cleanName };
  }
  if (local && local.uid === uid) {
    return { ...local, name: cleanName };
  }
  return createDefaultRankProfile(uid, cleanName);
}
