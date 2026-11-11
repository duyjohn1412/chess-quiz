import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, browserLocalPersistence, getAuth, setPersistence, signInAnonymously, User } from 'firebase/auth';
import {
  collection,
  doc,
  Firestore,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  descending,
  equal,
  execute,
  field,
  Pipeline,
  PipelineSource,
} from 'firebase/firestore/pipelines';
import {
  FIREBASE_CONFIG,
  FIREBASE_DATABASE_ID,
  FIREBASE_EDITION,
  hasFirebaseConfig,
} from './firebaseConfig';
import {
  applyMatchOutcomeToProfile,
  clampElo,
  createDefaultRankProfile,
  EloUpdateResult,
  MatchOutcome,
  normalizePlayerDisplayName,
  RankProfile,
  saveCachedRankProfile,
} from '../rank/rankSystem';

type FirestoreWithPipeline = Firestore & {
  pipeline(): PipelineSource<Pipeline>;
};

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let cachedServices: FirebaseServices | null = null;
let authInFlight: Promise<User> | null = null;

export function timestampToMs(ts: unknown, fallback: number = Date.now()): number {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: unknown }).toMillis === 'function') {
    return (ts as { toMillis(): number }).toMillis();
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  return fallback;
}

export function getFirebaseServices(): FirebaseServices {
  if (!hasFirebaseConfig()) {
    throw new Error('Thiếu cấu hình máy chủ.');
  }
  if (cachedServices) return cachedServices;

  const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  void setPersistence(auth, browserLocalPersistence).catch(() => {});

  const db =
    FIREBASE_DATABASE_ID && FIREBASE_DATABASE_ID !== '(default)'
      ? getFirestore(app, FIREBASE_DATABASE_ID)
      : getFirestore(app);

  cachedServices = { app, auth, db };
  return cachedServices;
}

export async function ensureAnonymousAuth(): Promise<User> {
  const { auth } = getFirebaseServices();
  if (auth.currentUser) return auth.currentUser;
  if (authInFlight) return authInFlight;

  authInFlight = (async () => {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch {
      // ignore if restricted browser mode; signInAnonymously still works per-session
    }
    const authWithReady = auth as Auth & { authStateReady?: () => Promise<void> };
    if (typeof authWithReady.authStateReady === 'function') {
      await authWithReady.authStateReady();
    }
    if (auth.currentUser) return auth.currentUser;
    const cred = await signInAnonymously(auth);
    return cred.user;
  })();

  try {
    return await authInFlight;
  } finally {
    authInFlight = null;
  }
}

function docToRankProfile(uid: string, data: Record<string, unknown>): RankProfile {
  return {
    uid,
    name: normalizePlayerDisplayName(String(data.name ?? 'Người chơi')),
    elo: clampElo(Number(data.elo ?? 1000)),
    wins: Math.max(0, Math.floor(Number(data.wins ?? 0))),
    losses: Math.max(0, Math.floor(Number(data.losses ?? 0))),
    draws: Math.max(0, Math.floor(Number(data.draws ?? 0))),
    streak: Math.max(0, Math.floor(Number(data.streak ?? 0))),
    bestElo: clampElo(Number(data.bestElo ?? data.elo ?? 1000)),
    gamesPlayed: Math.max(0, Math.floor(Number(data.gamesPlayed ?? 0))),
    ranked: Boolean(data.ranked),
    lastMatchId: typeof data.lastMatchId === 'string' ? data.lastMatchId : '',
    updatedAt: timestampToMs(data.updatedAt),
  };
}

export async function loadOrCreateRankProfile(
  uid: string,
  displayName: string
): Promise<RankProfile> {
  const { db } = getFirebaseServices();
  const cleanName = normalizePlayerDisplayName(displayName);
  const playerRef = doc(db, 'players', uid);
  const snap = await getDoc(playerRef);

  if (!snap.exists()) {
    const initial = createDefaultRankProfile(uid, cleanName);
    await setDoc(playerRef, {
      uid: initial.uid,
      name: initial.name,
      elo: initial.elo,
      wins: initial.wins,
      losses: initial.losses,
      draws: initial.draws,
      streak: initial.streak,
      bestElo: initial.bestElo,
      gamesPlayed: initial.gamesPlayed,
      ranked: false,
      lastMatchId: '',
      updatedAt: serverTimestamp(),
    });
    saveCachedRankProfile(initial);
    return initial;
  }

  const profile = docToRankProfile(uid, snap.data() as Record<string, unknown>);
  if (cleanName && cleanName !== profile.name) {
    profile.name = cleanName;
    try {
      await updateDoc(playerRef, {
        name: cleanName,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // non-fatal rename failure
    }
  }
  saveCachedRankProfile(profile);
  return profile;
}

export async function syncRankDisplayName(uid: string, displayName: string): Promise<void> {
  const cleanName = normalizePlayerDisplayName(displayName);
  const { db } = getFirebaseServices();
  const playerRef = doc(db, 'players', uid);
  try {
    await updateDoc(playerRef, {
      name: cleanName,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // ignore if profile does not exist yet
  }
}

export async function fetchLeaderboard(maxRows: number = 20): Promise<RankProfile[]> {
  const { db } = getFirebaseServices();

  if (FIREBASE_EDITION === 'enterprise') {
    const pipeDb = db as FirestoreWithPipeline;
    if (typeof pipeDb.pipeline === 'function') {
      const p = pipeDb
        .pipeline()
        .collection('players')
        .where(equal(field('ranked'), true))
        .sort(descending(field('elo')))
        .limit(maxRows);
      const snap = await execute(p);
      return snap.results
        .map((r) => {
          const data = r.data() as Record<string, unknown> | undefined;
          if (!data) return null;
          const uid = String(data.uid ?? r.id ?? '');
          return uid ? docToRankProfile(uid, data) : null;
        })
        .filter((x): x is RankProfile => Boolean(x));
    }
  }

  const q = query(
    collection(db, 'players'),
    where('ranked', '==', true),
    orderBy('elo', 'desc'),
    limit(maxRows)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToRankProfile(d.id, d.data() as Record<string, unknown>));
}

export async function commitRankedMatchResult(
  roomCode: string,
  uid: string,
  outcome: MatchOutcome,
  oppElo: number
): Promise<{ profile: RankProfile; diff: EloUpdateResult } | null> {
  const { db } = getFirebaseServices();
  const playerRef = doc(db, 'players', uid);
  const roomRef = doc(db, 'rooms', roomCode);

  const runOnce = async (): Promise<{ profile: RankProfile; diff: EloUpdateResult } | null> => {
    return runTransaction(db, async (tx) => {
      const [pSnap, rSnap] = await Promise.all([tx.get(playerRef), tx.get(roomRef)]);
      if (!rSnap.exists()) return null;
      const room = rSnap.data() as Record<string, unknown>;
      if (room.isRanked !== true || room.phase !== 'GAME_OVER') {
        throw new Error('ROOM_NOT_FINALIZED');
      }
      if (room.hostUid !== uid && room.guestUid !== uid) return null;

      let current: RankProfile;
      if (pSnap.exists()) {
        current = docToRankProfile(uid, pSnap.data() as Record<string, unknown>);
      } else {
        current = createDefaultRankProfile(uid, 'Người chơi');
      }

      if (current.lastMatchId === roomCode) {
        return null; // Đã cộng/trừ Elo cho trận này rồi
      }

      const { next, diff } = applyMatchOutcomeToProfile(current, oppElo, outcome, roomCode);
      if (pSnap.exists()) {
        tx.update(playerRef, {
          elo: next.elo,
          wins: next.wins,
          losses: next.losses,
          draws: next.draws,
          streak: next.streak,
          bestElo: next.bestElo,
          gamesPlayed: next.gamesPlayed,
          ranked: true,
          lastMatchId: roomCode,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(playerRef, {
          uid: next.uid,
          name: next.name,
          elo: next.elo,
          wins: next.wins,
          losses: next.losses,
          draws: next.draws,
          streak: next.streak,
          bestElo: next.bestElo,
          gamesPlayed: next.gamesPlayed,
          ranked: true,
          lastMatchId: roomCode,
          updatedAt: serverTimestamp(),
        });
      }
      saveCachedRankProfile(next);
      return { profile: next, diff };
    });
  };

  const delays = [400, 800, 1200];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await runOnce();
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === 'ROOM_NOT_FINALIZED' &&
        attempt < delays.length
      ) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return null;
    }
  }
  return null;
}
